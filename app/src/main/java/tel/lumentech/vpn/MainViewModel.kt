package tel.lumentech.vpn

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.net.VpnService
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import tel.lumentech.vpn.auth.CabinetUser
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.SubscriptionProfile
import tel.lumentech.vpn.model.VpnStatus
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.runtime.NodeUrlTester
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.runtime.StrictVpnUrlTester
import tel.lumentech.vpn.runtime.XrayUrlTester
import tel.lumentech.vpn.security.SecretRedactor
import tel.lumentech.vpn.update.AppUpdateState
import tel.lumentech.vpn.update.AppUpdateStatus
import tel.lumentech.vpn.vpn.AndroidIkev2PlatformVpn
import tel.lumentech.vpn.vpn.LumenVpnService
import tel.lumentech.vpn.vpn.VpnState

data class UiState(
    val authenticated: Boolean = true,
    val user: CabinetUser? = null,
    val profileError: String = "",
    val subscriptions: List<SubscriptionProfile> = emptyList(),
    val servers: List<ServerProfile> = emptyList(),
    val selectedServerId: String? = null,
    val detailsServerId: String? = null,
    val vpnStatus: VpnStatus = VpnStatus.Stopped,
    val lastError: String = "",
    val busy: Boolean = false,
    val message: String = "",
    val runtimeSettings: RuntimeSettings = RuntimeSettings(),
    val installedApps: List<InstalledApp> = emptyList(),
    val serverLatencies: Map<String, Long> = emptyMap(),
    val checkingLatencyIds: Set<String> = emptySet(),
    val latencyRunning: Boolean = false,
    val latencyCompleted: Int = 0,
    val latencyTotal: Int = 0,
    val networkCheck: String = "",
    val coreEvents: List<String> = emptyList(),
    val hwid: String = "",
    val updateState: AppUpdateState = AppUpdateState(),
)

data class InstalledApp(
    val label: String,
    val packageName: String,
)

private data class LatencyEndpoint(
    val host: String,
    val port: Int,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val container = (app as LumenApplication).container
    private val http = OkHttpClient.Builder().build()
    private val strictVpnUrlTester = StrictVpnUrlTester(app.applicationContext)
    private val xrayUrlTester = XrayUrlTester(app.applicationContext)
    private val nodeUrlTester = NodeUrlTester(app.applicationContext)
    private val transient = MutableStateFlow(UiState())
    private var pingRunJob: Job? = null
    private var pingGeneration = 0L

    val state: StateFlow<UiState> = combine(
        transient,
        container.subscriptions.servers,
        container.preferences.selectedServerId,
        container.preferences.runtimeSettings,
        container.subscriptions.subscriptions,
    ) { current, servers, selected, settings, subscriptions ->
        current.copy(
            servers = servers,
            selectedServerId = selected,
            runtimeSettings = settings,
            subscriptions = subscriptions,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState())

    init {
        viewModelScope.launch {
            transient.value = transient.value.copy(
                authenticated = true,
                user = null,
                profileError = "",
                hwid = container.deviceIdentity.hwid(),
            )
            container.subscriptions.rewriteServerMetadataAtRest()
        }
        checkForUpdate(silent = true)
        viewModelScope.launch {
            while (true) {
                transient.value = transient.value.copy(
                    vpnStatus = VpnState.status,
                    lastError = VpnState.lastError,
                    coreEvents = VpnState.events(),
                )
                delay(750)
            }
        }
    }

    fun importText(source: String, content: String, name: String = "Manual import") = launchBusy {
        val result = container.subscriptions.importManual(source, content, name)
        val first = result.subscription.servers.firstOrNull()
        if (first != null) container.preferences.setSelectedServer(first.id)
        val connectable = result.subscription.servers.count(RuntimeSupport::isConnectable)
        val importedOnly = result.subscription.servers.size - connectable
        transient.value = transient.value.copy(
            message = importSummary(result.subscription.servers.size, connectable, importedOnly)
        )
    }

    fun importFromQr(content: String) {
        importText("qr", content, "QR import")
    }

    fun importFromClipboard(context: Context) {
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val text = manager.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
        importText("clipboard", text, "Clipboard")
    }

    fun copyDiagnostics(context: Context) {
        val snapshot = state.value
        val selected = snapshot.selectedServer()
        val text = buildString {
            appendLine("mode=local")
            appendLine("servers=${snapshot.servers.size}")
            appendLine("subscriptions=${snapshot.subscriptions.size}")
            appendLine("hwid=<redacted>")
            if (selected != null) {
                appendLine("selectedName=${SecretRedactor.redact(selected.displayName)}")
                appendLine("selectedProtocol=${RuntimeSupport.label(selected.protocol)}")
                appendLine("selectedEndpoint=${SecretRedactor.redact("${selected.host}:${selected.port}")}")
                appendLine("selectedConnectable=${RuntimeSupport.isConnectable(selected)}")
            } else {
                appendLine("selected=none")
            }
            appendLine("splitMode=${snapshot.runtimeSettings.splitMode}")
            appendLine("splitApps=${snapshot.runtimeSettings.splitApps.size}")
            appendLine("language=${snapshot.runtimeSettings.language}")
            appendLine("dnsMode=${snapshot.runtimeSettings.dnsMode}")
            appendLine("bypassPrivateNetworks=${snapshot.runtimeSettings.bypassPrivateNetworks}")
            appendLine("strictRoute=${snapshot.runtimeSettings.strictRoute}")
            appendLine("ipv6=${snapshot.runtimeSettings.ipv6}")
            appendLine("sniff=${snapshot.runtimeSettings.sniff}")
            appendLine("status=${VpnState.status}")
            appendLine("error=${SecretRedactor.redact(VpnState.lastError)}")
            appendLine("message=${SecretRedactor.redact(snapshot.message)}")
            appendLine("networkCheck=${SecretRedactor.redact(snapshot.networkCheck)}")
            snapshot.coreEvents.takeLast(20).forEach { appendLine("event=${SecretRedactor.redact(it)}") }
        }
        val manager = context.getSystemService(ClipboardManager::class.java)
        manager.setPrimaryClip(ClipData.newPlainText("Lumen diagnostics", text))
        transient.value = transient.value.copy(message = "Диагностика скопирована")
    }

    fun copyHwid(context: Context) {
        val hwid = state.value.hwid.ifBlank { container.deviceIdentity.hwid() }
        val manager = context.getSystemService(ClipboardManager::class.java)
        manager.setPrimaryClip(ClipData.newPlainText("Lumen HWID", hwid))
        transient.value = transient.value.copy(hwid = hwid, message = "HWID copied")
    }

    fun importFromUri(context: Context, uri: Uri) = launchBusy {
        val content = context.contentResolver.openInputStream(uri)?.use { input ->
            BufferedReader(InputStreamReader(input)).readText()
        }.orEmpty()
        val result = container.subscriptions.importManual(uri.toString(), content, uri.lastPathSegment ?: "File import")
        val first = result.subscription.servers.firstOrNull()
        if (first != null) container.preferences.setSelectedServer(first.id)
        val connectable = result.subscription.servers.count(RuntimeSupport::isConnectable)
        val importedOnly = result.subscription.servers.size - connectable
        transient.value = transient.value.copy(message = importSummary(result.subscription.servers.size, connectable, importedOnly))
    }

    fun setMessage(message: String) {
        transient.value = transient.value.copy(message = message)
    }

    fun selectServer(id: String) = viewModelScope.launch {
        container.preferences.setSelectedServer(id)
        state.value.servers.firstOrNull { it.id == id }?.let { server ->
            transient.value = transient.value.copy(
                message = if (RuntimeSupport.isConnectable(server)) {
                    "Выбран ${server.displayName}"
                } else {
                    RuntimeSupport.unsupportedRuntimeMessage(server.protocol)
                }
            )
        }
    }

    fun showServerDetails(id: String?) {
        transient.value = transient.value.copy(detailsServerId = id)
    }

    fun refreshSubscription(id: String) = launchBusy {
        val result = container.subscriptions.refreshSubscription(id)
        val first = result.subscription.servers.firstOrNull()
        if (first != null) container.preferences.setSelectedServer(first.id)
        transient.value = transient.value.copy(message = "Подписка обновлена: ${result.subscription.servers.size}")
    }

    fun deleteSubscription(id: String) = launchBusy {
        container.subscriptions.deleteSubscription(id)
        transient.value = transient.value.copy(message = "Подписка удалена")
    }

    fun deleteServer(id: String) = launchBusy {
        container.subscriptions.deleteServer(id)
        transient.value = transient.value.copy(detailsServerId = null, message = "Профиль удален")
    }

    fun duplicateServer(id: String) = launchBusy {
        val copy = container.subscriptions.duplicateServer(id)
        container.preferences.setSelectedServer(copy.id)
        transient.value = transient.value.copy(detailsServerId = copy.id, message = "Профиль скопирован")
    }

    fun exportServer(context: Context, id: String) = launchBusy {
        val server = state.value.servers.firstOrNull { it.id == id }
            ?: container.subscriptions.serverById(id)
            ?: error("Server not found")
        val manager = context.getSystemService(ClipboardManager::class.java)
        manager.setPrimaryClip(ClipData.newPlainText("Lumen profile", SecretRedactor.redact(server.rawUri.ifBlank { server.extraJson })))
        transient.value = transient.value.copy(message = "Профиль скопирован без секретов")
    }

    fun pingServers() {
        val servers = state.value.servers
        if (servers.isEmpty()) return
        val ids = servers.map { it.id }.toSet()
        val queuedServers = servers.filter(RuntimeSupport::isConnectable)
        val generation = nextPingGeneration()
        val previousJob = pingRunJob
        previousJob?.cancel()
        transient.update { current -> current.copy(
            serverLatencies = current.serverLatencies - ids,
            checkingLatencyIds = queuedServers.map { it.id }.toSet(),
            latencyRunning = true,
            latencyCompleted = 0,
            latencyTotal = queuedServers.size,
            message = "Ping started: 0/${queuedServers.size}",
        ) }
        pingRunJob = viewModelScope.launch {
            previousJob?.cancelAndJoin()
            val completed = AtomicInteger(0)
            try {
                val skipped = servers.filterNot(RuntimeSupport::isConnectable)
                if (skipped.isNotEmpty() && generation == pingGeneration) {
                    transient.update { current ->
                        current.copy(serverLatencies = current.serverLatencies + skipped.associate { it.id to LatencyStatus.NA })
                    }
                }
                val proxyServers = queuedServers.filterNot { it.requiresStrictVpnPing() }
                val strictServers = queuedServers.filter { it.requiresStrictVpnPing() }
                val singBoxBatchServers = proxyServers.filter { RuntimeSupport.backend(it) == RuntimeBackend.SING_BOX }
                val xrayBatchServers = proxyServers.filter { RuntimeSupport.backend(it) == RuntimeBackend.XRAY_CORE }
                val singleProxyServers = proxyServers - singBoxBatchServers.toSet() - xrayBatchServers.toSet()
                coroutineScope {
                    val semaphore = Semaphore(PROXY_PING_CONCURRENCY)
                    val singBoxBatchJob = if (singBoxBatchServers.isNotEmpty()) {
                        launch {
                            val results = nodeUrlTester.testGoogleBatch(
                                profiles = singBoxBatchServers,
                                settings = state.value.runtimeSettings,
                                timeoutMs = PROXY_BATCH_LATENCY_TIMEOUT_MS,
                            )
                            singBoxBatchServers.forEach { server ->
                                publishBatchLatency(
                                    server = server,
                                    latency = results[server.id],
                                    generation = generation,
                                    completed = completed.incrementAndGet(),
                                    total = queuedServers.size,
                                )
                            }
                        }
                    } else {
                        null
                    }
                    val xrayBatchJob = if (xrayBatchServers.isNotEmpty()) {
                        launch {
                            val results = xrayUrlTester.testGoogleBatch(
                                profiles = xrayBatchServers,
                                settings = state.value.runtimeSettings,
                                attempts = BULK_LATENCY_ATTEMPTS,
                                timeoutMs = LATENCY_HTTP_TIMEOUT_MS.toInt(),
                            )
                            xrayBatchServers.forEach { server ->
                                publishBatchLatency(
                                    server = server,
                                    latency = results[server.id],
                                    generation = generation,
                                    completed = completed.incrementAndGet(),
                                    total = queuedServers.size,
                                )
                            }
                        }
                    } else {
                        null
                    }
                    singleProxyServers.map { server ->
                        launch {
                            semaphore.withPermit {
                                if (generation != pingGeneration) return@withPermit
                                val latency = measureServerLatencySafely(
                                    server = server,
                                    attempts = BULK_LATENCY_ATTEMPTS,
                                    overallTimeoutMs = PROXY_BULK_LATENCY_TIMEOUT_MS,
                                    strictStartTimeoutMs = STRICT_BULK_START_TIMEOUT_MS,
                                )
                                publishBatchLatency(server, latency, generation, completed.incrementAndGet(), queuedServers.size)
                            }
                        }
                    }.plus(listOfNotNull(singBoxBatchJob, xrayBatchJob)).joinAll()
                }
                for (server in strictServers) {
                    if (generation != pingGeneration) break
                    val latency = measureServerLatencySafely(
                        server = server,
                        attempts = BULK_LATENCY_ATTEMPTS,
                        overallTimeoutMs = STRICT_BULK_LATENCY_TIMEOUT_MS,
                        strictStartTimeoutMs = STRICT_BULK_START_TIMEOUT_MS,
                    )
                    publishBatchLatency(server, latency, generation, completed.incrementAndGet(), queuedServers.size)
                    delay(LATENCY_NEXT_SERVER_DELAY_MS)
                }
            } finally {
                if (generation == pingGeneration) {
                    transient.update { current ->
                        current.copy(
                            checkingLatencyIds = emptySet(),
                            latencyRunning = false,
                            latencyCompleted = completed.get(),
                            latencyTotal = queuedServers.size,
                            message = "Ping complete: ${completed.get()}/${queuedServers.size}",
                        )
                    }
                }
            }
        }
    }

    fun pingServer(id: String) {
        val server = state.value.servers.firstOrNull { it.id == id } ?: return
        val generation = nextPingGeneration()
        val previousJob = pingRunJob
        previousJob?.cancel()
        pingRunJob = viewModelScope.launch {
            previousJob?.cancelAndJoin()
            pingServerNow(
                server = server,
                generation = generation,
                markChecking = true,
                attempts = LATENCY_ATTEMPTS,
                exclusiveChecking = true,
            )
        }
    }

    private fun publishBatchLatency(
        server: ServerProfile,
        latency: Long?,
        generation: Long,
        completed: Int,
        total: Int,
    ) {
        if (generation != pingGeneration) return
        transient.update { current ->
            current.copy(
                serverLatencies = current.serverLatencies + (server.id to (latency ?: LatencyStatus.NA)),
                checkingLatencyIds = current.checkingLatencyIds - server.id,
                latencyCompleted = completed,
                message = if (latency != null) {
                    "Ping $completed/$total: ${server.displayName} ${latency} ms"
                } else {
                    "Ping $completed/$total: ${server.displayName} N/A"
                },
            )
        }
    }

    private fun nextPingGeneration(): Long {
        pingGeneration += 1
        return pingGeneration
    }

    private suspend fun pingServerNow(
        server: ServerProfile,
        generation: Long,
        markChecking: Boolean,
        attempts: Int,
        exclusiveChecking: Boolean,
    ) {
        val id = server.id
        if (!RuntimeSupport.isConnectable(server)) {
            transient.update { current ->
                current.copy(
                    serverLatencies = current.serverLatencies + (id to LatencyStatus.NA),
                    checkingLatencyIds = current.checkingLatencyIds - id,
                    latencyRunning = false,
                    latencyCompleted = 0,
                    latencyTotal = 1,
                    message = "Ping ${server.displayName}: N/A",
                )
            }
            return
        }
        if (markChecking) {
            transient.update { current -> current.copy(
                checkingLatencyIds = if (exclusiveChecking) setOf(id) else current.checkingLatencyIds + id,
                serverLatencies = current.serverLatencies - id,
                latencyRunning = true,
                latencyCompleted = 0,
                latencyTotal = 1,
                message = "Ping started",
            ) }
        }
        try {
            val latency = measureServerLatencySafely(
                server = server,
                attempts = attempts,
                overallTimeoutMs = if (server.requiresStrictVpnPing()) STRICT_SINGLE_LATENCY_TIMEOUT_MS else PROXY_SINGLE_LATENCY_TIMEOUT_MS,
                strictStartTimeoutMs = STRICT_SINGLE_START_TIMEOUT_MS,
            )
            if (generation != pingGeneration) return
            transient.update { current ->
                current.copy(
                    serverLatencies = current.serverLatencies + (id to (latency ?: LatencyStatus.NA)),
                    checkingLatencyIds = current.checkingLatencyIds - id,
                    latencyRunning = false,
                    latencyCompleted = 1,
                    latencyTotal = 1,
                    message = if (latency != null) {
                        "Ping ${server.displayName}: ${latency} ms"
                    } else {
                        "Ping ${server.displayName}: N/A"
                    },
                )
            }
        } finally {
            if (generation == pingGeneration) {
                transient.update { current ->
                    current.copy(
                        checkingLatencyIds = current.checkingLatencyIds - id,
                        latencyRunning = false,
                    )
                }
            }
        }
    }

    private suspend fun measureServerLatencySafely(
        server: ServerProfile,
        attempts: Int,
        overallTimeoutMs: Long,
        strictStartTimeoutMs: Long,
    ): Long? =
        try {
            withTimeoutOrNull(overallTimeoutMs) {
                measureThroughNodeLatency(server, attempts, strictStartTimeoutMs)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            null
        }

    private suspend fun measureThroughNodeLatency(
        server: ServerProfile,
        attempts: Int,
        strictStartTimeoutMs: Long,
    ): Long? =
        when (RuntimeSupport.backend(server)) {
            RuntimeBackend.XRAY_CORE -> {
                withContext(Dispatchers.IO) {
                    runCatching {
                        xrayUrlTester.testGoogle(
                            profile = server,
                            settings = state.value.runtimeSettings,
                            attempts = attempts,
                            timeoutMs = LATENCY_HTTP_TIMEOUT_MS.toInt(),
                        )
                    }.getOrNull()
                }
            }
            RuntimeBackend.SING_BOX -> {
                withContext(Dispatchers.IO) {
                    runCatching {
                        nodeUrlTester.testGoogle(
                            profile = server,
                            settings = state.value.runtimeSettings,
                            attempts = attempts,
                            timeoutMs = LATENCY_HTTP_TIMEOUT_MS,
                        )
                    }.getOrNull()
                }
            }
            RuntimeBackend.AMNEZIAWG,
            RuntimeBackend.OPENVPN,
            RuntimeBackend.OPENVPN_CLOAK -> {
                withContext(Dispatchers.IO) {
                    runCatching {
                        strictVpnUrlTester.testGoogle(
                            profile = server,
                            attempts = attempts,
                            timeoutMs = LATENCY_HTTP_TIMEOUT_MS,
                            startTimeoutMs = strictStartTimeoutMs,
                            stopTimeoutMs = STRICT_STOP_TIMEOUT_MS,
                            routeSettleDelayMs = STRICT_ROUTE_SETTLE_DELAY_MS,
                        )
                    }.getOrNull()
                }
            }
            RuntimeBackend.OPENVPN_SHADOWSOCKS,
            RuntimeBackend.ANDROID_IKEV2,
            RuntimeBackend.UNSUPPORTED -> {
                null
            }
        }

    fun pingServersOld() = launchBusy {
        val currentServers = state.value.servers
        val results = withContext(Dispatchers.IO) {
            currentServers.associate { server ->
                server.id to endpointPing(server)
            }
        }
        transient.value = transient.value.copy(serverLatencies = results, message = "Ping завершен")
    }

    fun runNetworkCheck() = launchBusy {
        val body = withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("https://cloudflare-dns.com/dns-query")
                .header("Accept", "application/dns-json")
                .get()
                .build()
            val dnsOk = runCatching { http.newCall(request).execute().use { it.isSuccessful } }.getOrDefault(false)
            val ipText = runCatching {
                http.newCall(Request.Builder().url("https://api.ipify.org").get().build()).execute().use { response ->
                    if (!response.isSuccessful) "HTTP ${response.code}" else response.body.string().trim()
                }
            }.getOrElse { "IP check failed: ${it.message}" }
            "externalIp=$ipText dnsOverHttps=$dnsOk vpnStatus=${VpnState.status}"
        }
        transient.value = transient.value.copy(networkCheck = body, message = body)
    }

    fun checkForUpdate(silent: Boolean = false) {
        viewModelScope.launch {
            val previousMessage = transient.value.message
            transient.value = transient.value.copy(
                updateState = transient.value.updateState.copy(
                    status = AppUpdateStatus.Checking,
                    error = "",
                    permissionRequired = false,
                ),
                message = if (silent) previousMessage else "",
            )
            runCatching { container.updates.check() }
                .onSuccess { update ->
                    val next = if (update == null) {
                        AppUpdateState(
                            status = AppUpdateStatus.UpToDate,
                            lastCheckedAt = System.currentTimeMillis(),
                        )
                    } else {
                        AppUpdateState(
                            status = AppUpdateStatus.Available,
                            available = update,
                            totalBytes = update.sizeBytes,
                            lastCheckedAt = System.currentTimeMillis(),
                        )
                    }
                    transient.value = transient.value.copy(
                        updateState = next,
                        message = when {
                            silent -> previousMessage
                            update == null -> "Update check complete: latest version installed"
                            else -> "Update available: ${update.versionName}"
                        },
                    )
                }
                .onFailure { throwable ->
                    val error = SecretRedactor.redact(throwable.message ?: "Update check failed")
                    transient.value = if (silent) {
                        transient.value.copy(updateState = AppUpdateState(), message = previousMessage)
                    } else {
                        transient.value.copy(
                            updateState = AppUpdateState(
                                status = AppUpdateStatus.Error,
                                error = error,
                                lastCheckedAt = System.currentTimeMillis(),
                            ),
                            message = error,
                        )
                    }
                }
        }
    }

    fun downloadUpdate(context: Context) {
        val update = state.value.updateState.available ?: return
        viewModelScope.launch {
            if (!container.updates.canRequestPackageInstalls()) {
                transient.value = transient.value.copy(
                    updateState = transient.value.updateState.copy(
                        status = AppUpdateStatus.Available,
                        permissionRequired = true,
                        error = "Allow APK installation for Lumen, then start update again",
                    )
                )
                context.startActivity(container.updates.installPermissionIntent())
                return@launch
            }
            transient.value = transient.value.copy(
                updateState = transient.value.updateState.copy(
                    status = AppUpdateStatus.Downloading,
                    available = update,
                    downloaded = null,
                    downloadedBytes = 0,
                    totalBytes = update.sizeBytes,
                    error = "",
                    permissionRequired = false,
                ),
                message = "",
            )
            runCatching {
                container.updates.download(update) { downloaded, total ->
                    transient.value = transient.value.copy(
                        updateState = transient.value.updateState.copy(
                            status = AppUpdateStatus.Downloading,
                            downloadedBytes = downloaded,
                            totalBytes = total,
                        )
                    )
                }
            }.onSuccess { downloaded ->
                transient.value = transient.value.copy(
                    updateState = transient.value.updateState.copy(
                        status = AppUpdateStatus.Downloaded,
                        downloaded = downloaded,
                        downloadedBytes = downloaded.sizeBytes,
                        totalBytes = downloaded.sizeBytes,
                        error = "",
                    ),
                    message = "Update downloaded: ${downloaded.versionName}",
                )
                installDownloadedUpdate(context)
            }.onFailure { throwable ->
                val error = SecretRedactor.redact(throwable.message ?: "Update download failed")
                transient.value = transient.value.copy(
                    updateState = transient.value.updateState.copy(
                        status = AppUpdateStatus.Error,
                        error = error,
                    ),
                    message = error,
                )
            }
        }
    }

    fun installDownloadedUpdate(context: Context) {
        val downloaded = state.value.updateState.downloaded ?: return
        if (!container.updates.canRequestPackageInstalls()) {
            transient.value = transient.value.copy(
                updateState = transient.value.updateState.copy(
                    permissionRequired = true,
                    error = "Allow APK installation for Lumen",
                )
            )
            context.startActivity(container.updates.installPermissionIntent())
            return
        }
        runCatching {
            transient.value = transient.value.copy(
                updateState = transient.value.updateState.copy(status = AppUpdateStatus.Installing, error = "")
            )
            context.startActivity(container.updates.installIntent(downloaded))
        }.onFailure { throwable ->
            val error = SecretRedactor.redact(throwable.message ?: "Update install failed")
            transient.value = transient.value.copy(
                updateState = transient.value.updateState.copy(status = AppUpdateStatus.Error, error = error),
                message = error,
            )
        }
    }

    fun openInstallPermissionSettings(context: Context) {
        context.startActivity(container.updates.installPermissionIntent())
    }

    fun updateRuntimeSettings(settings: RuntimeSettings) = viewModelScope.launch {
        container.preferences.setRuntimeSettings(settings)
    }

    fun toggleSplitApp(packageName: String, enabled: Boolean) {
        val current = state.value.runtimeSettings
        val apps = if (enabled) {
            (current.splitApps + packageName).distinct().sorted()
        } else {
            current.splitApps.filterNot { it == packageName }
        }
        updateRuntimeSettings(current.copy(splitApps = apps))
    }

    fun loadInstalledApps(context: Context) {
        viewModelScope.launch {
            val apps = withContext(Dispatchers.IO) {
                val pm = context.packageManager
                val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                pm.queryIntentActivities(launcherIntent, 0)
                    .asSequence()
                    .mapNotNull { it.activityInfo?.applicationInfo }
                    .plus(state.value.runtimeSettings.splitApps.asSequence().map { packageName ->
                        runCatching {
                            pm.getApplicationInfo(packageName, 0)
                        }.getOrDefault(
                            ApplicationInfo().apply {
                                this.packageName = packageName
                            }
                        )
                    })
                    .map { appInfo ->
                        val packageName = appInfo.packageName
                        InstalledApp(
                            label = runCatching { appInfo.loadLabel(pm).toString().trim() }
                                .getOrDefault(packageName)
                                .ifBlank { packageName },
                            packageName = packageName,
                        )
                    }
                    .filter { it.packageName.isNotBlank() }
                    .distinctBy { it.packageName }
                    .sortedWith { left, right ->
                        left.label.compareTo(right.label, ignoreCase = true)
                            .takeIf { it != 0 }
                            ?: left.packageName.compareTo(right.packageName, ignoreCase = true)
                    }
                    .toList()
            }
            transient.value = transient.value.copy(installedApps = apps)
        }
    }

    fun connect(context: Context, onNeedPermission: (Intent) -> Unit) {
        val snapshot = state.value
        when (VpnState.status) {
            VpnStatus.Starting, VpnStatus.Stopping -> {
                transient.value = transient.value.copy(message = "VPN state is changing")
                return
            }
            VpnStatus.Running -> return
            else -> Unit
        }
        val selected = snapshot.selectedServer()
        if (selected == null) {
            transient.value = transient.value.copy(message = "Сначала импортируйте подписку")
            return
        }
        if (!RuntimeSupport.isConnectable(selected)) {
            transient.value = transient.value.copy(message = RuntimeSupport.unsupportedRuntimeMessage(selected.protocol))
            return
        }
        if (snapshot.runtimeSettings.splitMode == "include" && snapshot.runtimeSettings.splitApps.isEmpty()) {
            transient.value = transient.value.copy(message = "В режиме VPN только для выбранных приложений нужно выбрать хотя бы одно приложение")
            return
        }
        if (snapshot.runtimeSettings.dnsMode == "custom" && snapshot.runtimeSettings.customDns.isBlank()) {
            transient.value = transient.value.copy(message = "Укажите custom DNS или выберите готового провайдера")
            return
        }
        if (snapshot.selectedServerId.isNullOrBlank()) {
            viewModelScope.launch { container.preferences.setSelectedServer(selected.id) }
        }
        if (RuntimeSupport.backend(selected) == RuntimeBackend.ANDROID_IKEV2) {
            transient.value = transient.value.copy(vpnStatus = VpnStatus.Starting, message = "")
            viewModelScope.launch {
                runCatching {
                    withContext(Dispatchers.IO) {
                        AndroidIkev2PlatformVpn.provisionOrStart(context, selected)
                    }
                }.onSuccess { consent ->
                    if (consent != null) {
                        onNeedPermission(consent)
                    } else {
                        VpnState.lastError = ""
                        transient.value = transient.value.copy(vpnStatus = VpnStatus.Running, message = "")
                    }
                }.onFailure { throwable ->
                    val safeMessage = SecretRedactor.redact(throwable.message ?: throwable.javaClass.simpleName)
                    VpnState.status = VpnStatus.Error
                    VpnState.lastError = safeMessage
                    VpnState.event("Android IKEv2 error: $safeMessage")
                    transient.value = transient.value.copy(vpnStatus = VpnStatus.Error, message = safeMessage)
                }
            }
            return
        }
        val permission = VpnService.prepare(context)
        if (permission != null) {
            onNeedPermission(permission)
            return
        }
        transient.value = transient.value.copy(vpnStatus = VpnStatus.Starting, message = "")
        LumenVpnService.start(context, selected.id)
    }

    fun disconnect(context: Context) {
        when (VpnState.status) {
            VpnStatus.Stopped, VpnStatus.Stopping -> return
            else -> Unit
        }
        transient.value = transient.value.copy(vpnStatus = VpnStatus.Stopping, message = "")
        if (state.value.selectedServer()?.let { RuntimeSupport.backend(it) } == RuntimeBackend.ANDROID_IKEV2) {
            AndroidIkev2PlatformVpn.stop(context)
            transient.value = transient.value.copy(vpnStatus = VpnStatus.Stopped, message = "")
            return
        }
        LumenVpnService.stop(context)
    }

    private fun launchBusy(block: suspend () -> Unit) {
        viewModelScope.launch {
            transient.value = transient.value.copy(busy = true, message = "")
            runCatching { block() }
                .onFailure {
                    val safeMessage = SecretRedactor.redact(it.message ?: it.javaClass.simpleName)
                    if (BuildConfig.DEBUG) {
                        Log.w(TAG, "User action failed: $safeMessage", it)
                    }
                    transient.value = transient.value.copy(message = safeMessage)
                }
            transient.value = transient.value.copy(busy = false)
        }
    }

    private fun UiState.selectedServer(): ServerProfile? =
        servers.firstOrNull { it.id == selectedServerId } ?: servers.firstOrNull()

    private fun endpointPing(server: ServerProfile): Long {
        val endpoint = server.latencyEndpoint() ?: return LatencyStatus.OFFLINE
        val host = endpoint.host
        val port = endpoint.port
        val samples = buildList {
            repeat(LATENCY_ATTEMPTS) {
                val value = if (server.usesUdpLatencyProbe()) {
                    icmpPing(host) ?: tcpPing(host, port).takeIf { it > 0 }
                } else {
                    tcpPing(host, port).takeIf { it > 0 } ?: icmpPing(host)
                }
                if (value != null && value > 0) add(value)
            }
        }
        return samples.minOrNull() ?: LatencyStatus.OFFLINE
    }

    private fun ServerProfile.latencyEndpoint(): LatencyEndpoint? {
        val parsed = listOfNotNull(
            extraJson.jsonLatencyEndpoint(),
            rawUri.wireGuardLatencyEndpoint(),
            rawUri.openVpnLatencyEndpoint(),
        )
        val direct = LatencyEndpoint(host, port).takeIf { it.isUsable() }
        return (parsed + listOfNotNull(direct))
            .firstOrNull { it.isUsable() && !it.host.isLoopbackHost() }
            ?: (parsed + listOfNotNull(direct)).firstOrNull { it.isUsable() }
    }

    private fun tcpPing(host: String, port: Int): Long {
        if (host.isBlank() || port !in 1..65535) return LatencyStatus.OFFLINE
        val start = System.nanoTime()
        return runCatching {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), 2_500)
            }
            ((System.nanoTime() - start) / 1_000_000).coerceAtLeast(1)
        }.getOrDefault(LatencyStatus.OFFLINE)
    }

    private fun icmpPing(host: String): Long? = runCatching {
        val start = System.nanoTime()
        val process = ProcessBuilder("/system/bin/ping", "-c", "1", "-W", "2", host)
            .redirectErrorStream(true)
            .start()
        if (!process.waitFor(2_500, TimeUnit.MILLISECONDS)) {
            process.destroyForcibly()
            return@runCatching null
        }
        val output = process.inputStream.bufferedReader().use { it.readText() }
        if (process.exitValue() != 0) return@runCatching null
        pingTimeRegex.find(output)
            ?.groupValues
            ?.getOrNull(1)
            ?.toDoubleOrNull()
            ?.let { kotlin.math.round(it).toLong().coerceAtLeast(1) }
            ?: ((System.nanoTime() - start) / 1_000_000).coerceAtLeast(1)
    }.getOrNull()

    private fun ServerProfile.usesUdpLatencyProbe(): Boolean = when (protocol) {
        ProtocolType.WIREGUARD,
        ProtocolType.AMNEZIA_WG,
        ProtocolType.HYSTERIA,
        ProtocolType.HYSTERIA2,
        ProtocolType.TUIC,
        ProtocolType.IPSEC -> true
        ProtocolType.OPENVPN -> rawUri.contains("proto udp", ignoreCase = true) ||
            !rawUri.contains("proto tcp", ignoreCase = true)
        ProtocolType.OPENVPN_CLOAK,
        ProtocolType.OPENVPN_SHADOWSOCKS -> false
        ProtocolType.VLESS,
        ProtocolType.VMESS,
        ProtocolType.XRAY -> transport.equals("quic", ignoreCase = true)
        else -> false
    }

    private fun ServerProfile.requiresStrictVpnPing(): Boolean = when (RuntimeSupport.backend(this)) {
        RuntimeBackend.AMNEZIAWG,
        RuntimeBackend.OPENVPN,
        RuntimeBackend.OPENVPN_CLOAK -> true
        RuntimeBackend.XRAY_CORE,
        RuntimeBackend.SING_BOX,
        RuntimeBackend.OPENVPN_SHADOWSOCKS,
        RuntimeBackend.ANDROID_IKEV2,
        RuntimeBackend.UNSUPPORTED -> false
    }

    private companion object {
        private const val TAG = "LumenViewModel"
        private const val LATENCY_ATTEMPTS = 5
        private const val BULK_LATENCY_ATTEMPTS = 1
        private const val PROXY_PING_CONCURRENCY = 4
        private const val PROXY_BATCH_LATENCY_TIMEOUT_MS = 18_000L
        private const val PROXY_BULK_LATENCY_TIMEOUT_MS = 8_000L
        private const val PROXY_SINGLE_LATENCY_TIMEOUT_MS = 15_000L
        private const val STRICT_BULK_LATENCY_TIMEOUT_MS = 25_000L
        private const val STRICT_SINGLE_LATENCY_TIMEOUT_MS = 45_000L
        private const val STRICT_BULK_START_TIMEOUT_MS = 18_000L
        private const val STRICT_SINGLE_START_TIMEOUT_MS = 34_000L
        private const val STRICT_STOP_TIMEOUT_MS = 6_000L
        private const val STRICT_ROUTE_SETTLE_DELAY_MS = 550L
        private const val LATENCY_HTTP_TIMEOUT_MS = 2_500L
        private const val LATENCY_NEXT_SERVER_DELAY_MS = 120L
        val pingTimeRegex = Regex("time[=<]([0-9.]+)")
        private val wireGuardEndpointRegex = Regex("""(?im)^\s*Endpoint\s*=\s*([^\s#]+)""")
        private val openVpnRemoteRegex = Regex("""(?im)^\s*remote\s+([^\s#]+)\s+(\d{1,5})""")

        private fun LatencyEndpoint.isUsable(): Boolean =
            host.isNotBlank() && port in 1..65535

        private fun String.isLoopbackHost(): Boolean =
            equals("localhost", ignoreCase = true) ||
                startsWith("127.") ||
                equals("::1")

        private fun String.jsonLatencyEndpoint(): LatencyEndpoint? = runCatching {
            if (isBlank() || trim().firstOrNull() != '{') return@runCatching null
            val json = JSONObject(this)
            val host = json.firstString("RemoteHost", "remoteHost", "remote_host", "host", "server", "address")
            val port = json.firstInt("RemotePort", "remotePort", "remote_port", "port", "serverPort")
            if (host.isBlank() || port !in 1..65535) null else LatencyEndpoint(host, port)
        }.getOrNull()

        private fun String.wireGuardLatencyEndpoint(): LatencyEndpoint? =
            wireGuardEndpointRegex.find(this)
                ?.groupValues
                ?.getOrNull(1)
                ?.parseLatencyEndpoint()

        private fun String.openVpnLatencyEndpoint(): LatencyEndpoint? {
            val match = openVpnRemoteRegex.find(this) ?: return null
            val host = match.groupValues.getOrNull(1).orEmpty()
            val port = match.groupValues.getOrNull(2)?.toIntOrNull() ?: return null
            return LatencyEndpoint(host, port).takeIf { it.isUsable() }
        }

        private fun String.parseLatencyEndpoint(): LatencyEndpoint? {
            val value = trim()
            val bracketEnd = value.indexOf(']')
            if (value.startsWith("[") && bracketEnd > 0) {
                val host = value.substring(1, bracketEnd)
                val port = value.substring(bracketEnd + 1).removePrefix(":").toIntOrNull() ?: return null
                return LatencyEndpoint(host, port).takeIf { it.isUsable() }
            }
            val portSeparator = value.lastIndexOf(':')
            if (portSeparator <= 0) return null
            val host = value.substring(0, portSeparator)
            val port = value.substring(portSeparator + 1).toIntOrNull() ?: return null
            return LatencyEndpoint(host, port).takeIf { it.isUsable() }
        }

        private fun JSONObject.firstString(vararg names: String): String {
            for (name in names) {
                val value = optString(name, "")
                if (value.isNotBlank()) return value
            }
            return ""
        }

        private fun JSONObject.firstInt(vararg names: String): Int {
            for (name in names) {
                val raw = opt(name) ?: continue
                val value = when (raw) {
                    is Number -> raw.toInt()
                    else -> raw.toString().toIntOrNull()
                }
                if (value != null) return value
            }
            return 0
        }
    }

    private fun importSummary(total: Int, connectable: Int, importedOnly: Int): String = when {
        total == 0 -> "Импорт выполнен, но серверы не найдены"
        importedOnly == 0 -> "Импортировано серверов: $total"
        connectable == 0 -> "Импортировано серверов: $total, но для подключения нужен недостающий runtime-core"
        else -> "Импортировано серверов: $total; к подключению: $connectable; нужен core: $importedOnly"
    }
}
