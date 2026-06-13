package tel.lumentech.vpn.vpn

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.LocalSocket
import android.net.LocalSocketAddress
import android.net.NetworkCapabilities
import android.net.ProxyInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Process
import android.system.OsConstants
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.hiddify.core.libbox.CommandServer
import com.hiddify.core.libbox.CommandServerHandler
import com.hiddify.core.libbox.ConnectionOwner
import com.hiddify.core.libbox.InterfaceUpdateListener
import com.hiddify.core.libbox.Libbox
import com.hiddify.core.libbox.LocalDNSTransport
import com.hiddify.core.libbox.NetworkInterfaceIterator
import com.hiddify.core.libbox.OverrideOptions
import com.hiddify.core.libbox.PlatformInterface
import com.hiddify.core.libbox.RoutePrefix
import com.hiddify.core.libbox.StringIterator
import com.hiddify.core.libbox.SystemProxyStatus
import com.hiddify.core.libbox.TunOptions
import com.hiddify.core.libbox.WIFIState
import java.io.ByteArrayInputStream
import java.io.BufferedReader
import java.io.File
import java.io.InputStream
import java.io.InputStreamReader
import java.io.InterruptedIOException
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.InterfaceAddress
import java.net.NetworkInterface
import java.net.Proxy
import java.net.URL
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.TimeUnit
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.amnezia.awg.GoBackend as AmneziaWgNative
import org.amnezia.awg.config.BadConfigException
import org.amnezia.awg.config.Config as AmneziaWgConfig
import org.amnezia.vpn.protocol.ProtocolState
import org.amnezia.vpn.protocol.openvpn.OpenVpn
import org.amnezia.vpn.protocol.openvpn.OpenVpnOverCloak
import org.json.JSONArray
import org.json.JSONObject
import tel.lumentech.vpn.LumenApplication
import tel.lumentech.vpn.MainActivity
import tel.lumentech.vpn.R
import tel.lumentech.vpn.BuildConfig
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.VpnStatus
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.runtime.SingBoxConfigFactory
import tel.lumentech.vpn.runtime.XrayConfigFactory
import tel.lumentech.vpn.runtime.XrayNativeFiles
import tel.lumentech.vpn.runtime.XrayRuntimeConfig
import tel.lumentech.vpn.security.SecretRedactor
import kotlin.coroutines.coroutineContext

open class LumenVpnService : VpnService(), PlatformInterface, CommandServerHandler {
    private data class XrayProbeResult(
        val success: Boolean,
        val lastError: String = "",
    )

    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(serviceJob + Dispatchers.IO)
    private var tunFd: ParcelFileDescriptor? = null
    private val configFactory = SingBoxConfigFactory()
    private val xrayConfigFactory = XrayConfigFactory()
    private var selectedServerId: String? = null
    private var strictProbeStart = false
    private var strictProbeToken: String = ""
    private val startMutex = Mutex()
    private val stopMutex = Mutex()
    private val startGeneration = AtomicLong(0L)
    @Volatile private var activeStartJob: Job? = null
    @Volatile private var mobilePrepared = false
    @Volatile private var coreRunning = false
    @Volatile private var tunnelReady: CompletableDeferred<Unit>? = null
    @Volatile private var commandServer: CommandServer? = null
    @Volatile private var amneziaWgHandle: Int = -1
    @Volatile private var openVpn: OpenVpn? = null
    @Volatile private var openVpnState: MutableStateFlow<ProtocolState>? = null
    @Volatile private var openVpnError: String? = null
    @Volatile private var xrayProcess: java.lang.Process? = null
    @Volatile private var tun2socksProcess: java.lang.Process? = null
    private val commandServerSecret = randomHexSecret()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return when (intent?.action) {
            ACTION_STOP -> {
                val stopToken = intent.getStringExtra(EXTRA_STRICT_PROBE_TOKEN).orEmpty()
                if (stopToken.isNotBlank() && VpnState.strictProbeToken != stopToken) {
                    Service.START_NOT_STICKY
                } else {
                    requestStop()
                    Service.START_NOT_STICKY
                }
            }
            ACTION_START -> {
                selectedServerId = intent?.getStringExtra(EXTRA_SERVER_ID)
                strictProbeStart = intent?.getBooleanExtra(EXTRA_STRICT_PROBE, false) == true
                strictProbeToken = intent?.getStringExtra(EXTRA_STRICT_PROBE_TOKEN).orEmpty().takeIf { strictProbeStart }.orEmpty()
                if (strictProbeStart) {
                    VpnState.strictProbeToken = strictProbeToken
                } else {
                    VpnState.strictProbeToken = ""
                }
                startForegroundCompat(notification("Starting", "Preparing tunnel"))
                activeStartJob = scope.launch { startCore(selectedServerId) }
                Service.START_STICKY
            }
            else -> Service.START_NOT_STICKY
        }
    }

    override fun onDestroy() {
        runBlocking { stopCore(stopService = false) }
        serviceJob.cancel()
        super.onDestroy()
    }

    override fun onRevoke() {
        requestStop(stopService = false)
        super.onRevoke()
    }

    private fun requestStop(stopService: Boolean = true) {
        scope.launch { stopCore(stopService) }
    }

    private fun setVpnStatus(status: VpnStatus, error: String = "") {
        VpnState.status = status
        VpnState.lastError = if (error.isNotBlank()) {
            error
        } else if (status == VpnStatus.Error) {
            VpnState.lastError
        } else {
            ""
        }
        publishStrictProbeStatus(status, error)
    }

    private fun publishStrictProbeStatus(status: VpnStatus, error: String = "") {
        val token = strictProbeToken
        if (!strictProbeStart || token.isBlank()) return
        sendBroadcast(
            Intent(ACTION_STRICT_PROBE_STATE)
                .setPackage(packageName)
                .putExtra(EXTRA_STRICT_PROBE_TOKEN, token)
                .putExtra(EXTRA_STRICT_PROBE_STATUS, status.name)
                .putExtra(EXTRA_STRICT_PROBE_ERROR, SecretRedactor.redact(error))
        )
    }

    private fun clearStrictProbeState() {
        VpnState.strictProbeToken = ""
        strictProbeToken = ""
        strictProbeStart = false
    }

    private suspend fun startCore(serverId: String?) = startMutex.withLock {
        val requestedStrictProbe = strictProbeStart
        val requestedStrictProbeToken = strictProbeToken
        if (mobilePrepared || tunFd != null || coreRunning || commandServer != null) {
            stopCore(stopService = false, invalidateStart = false)
            strictProbeStart = requestedStrictProbe
            strictProbeToken = requestedStrictProbeToken
            if (requestedStrictProbe) VpnState.strictProbeToken = requestedStrictProbeToken
        }
        val generation = startGeneration.incrementAndGet()
        setVpnStatus(VpnStatus.Starting)
        VpnState.event("Starting VPN")
        try {
            if (prepare(this) != null) error("VPN permission is not granted")
            val container = LumenApplication.instance.container
            val id = serverId ?: container.preferences.selectedServerId.first()
            require(!id.isNullOrBlank()) { "No server selected" }
            val profile = container.subscriptions.serverById(id) ?: error("Selected server is missing")
            VpnState.event("Selected ${profile.displayName} ${profile.protocol} ${profile.host}:${profile.port}")
            val runtimeSettings = container.preferences.runtimeSettings.first().let { settings ->
                if (strictProbeStart) {
                    settings.copy(splitMode = "off", splitApps = emptyList())
                } else {
                    settings
                }
            }
            require(runtimeSettings.splitMode != "include" || runtimeSettings.splitApps.isNotEmpty()) {
                "Split tunneling include mode requires at least one selected application"
            }
            when (RuntimeSupport.backend(profile)) {
                RuntimeBackend.XRAY_CORE -> {
                    startXrayCore(profile, runtimeSettings, generation)
                    return@withLock
                }
                RuntimeBackend.AMNEZIAWG -> {
                    startAmneziaWgCore(profile, runtimeSettings, generation)
                    return@withLock
                }
                RuntimeBackend.OPENVPN,
                RuntimeBackend.OPENVPN_CLOAK -> {
                    startOpenVpnCore(profile, runtimeSettings, generation)
                    return@withLock
                }
                RuntimeBackend.OPENVPN_SHADOWSOCKS -> {
                    startOpenVpnShadowsocksCore(profile, runtimeSettings, generation)
                    return@withLock
                }
                else -> Unit
            }
            val config = configFactory.build(profile, runtimeSettings)
            val runtimeSummary = configFactory.summarize(config)
            VpnState.event("Runtime config: $runtimeSummary")
            Log.i(TAG, "Runtime config: $runtimeSummary")
            val baseDir = filesDir.resolve("core").apply { mkdirs() }
            val workDir = noBackupFilesDir.resolve("core-work").apply { mkdirs() }
            workDir.mkdirs()
            val tempDir = cacheDir.resolve("core").apply { mkdirs() }
            val stderrFile = tempDir.resolve("stderr.log")
            stderrFile.delete()
            Libbox.redirectStderr(stderrFile.absolutePath)
            Libbox.setup(
                com.hiddify.core.libbox.SetupOptions().also {
                    it.basePath = baseDir.absolutePath
                    it.workingPath = workDir.absolutePath
                    it.tempPath = tempDir.absolutePath
                    it.commandServerListenPort = freeLoopbackPort()
                    it.commandServerSecret = commandServerSecret
                    it.logMaxLines = 300L
                    it.debug = BuildConfig.DEBUG
                    it.fixAndroidStack = true
                }
            )
            Libbox.checkConfig(config)
            mobilePrepared = true
            val ready = CompletableDeferred<Unit>()
            tunnelReady = ready
            Log.i(TAG, "Starting mobile core for ${profile.protocol} ${profile.host}:${profile.port}")
            ensureStartCurrent(generation)
            val server = Libbox.newCommandServer(this, this)
            commandServer = server
            server.start()
            ensureStartCurrent(generation)
            server.startOrReloadService(
                config,
                OverrideOptions().also {
                    it.autoRedirect = false
                    it.includePackage = StringArray(emptyList())
                    it.excludePackage = StringArray(emptyList())
                }
            )
            ensureStartCurrent(generation)
            withTimeout(TUN_READY_TIMEOUT_MS) { ready.await() }
            ensureStartCurrent(generation)
            coreRunning = true
            setVpnStatus(VpnStatus.Running)
            VpnState.event("VPN connected")
            withContext(Dispatchers.Main) {
                startForegroundCompat(notification("Connected", profile.displayName))
            }
        } catch (e: Throwable) {
            if (e is CancellationException || generation != startGeneration.get()) {
                VpnState.event("VPN start cancelled")
                stopCore(stopService = false, invalidateStart = false)
                return@withLock
            }
            val safeError = safeVpnError(e)
            setVpnStatus(VpnStatus.Error, safeError)
            VpnState.event("VPN error: $safeError")
            Log.e(TAG, "VPN start failed: ${SecretRedactor.redact(e.stackTraceToString())}")
            appendCoreStderrEvent()
            cacheDir.resolve("core").resolve("active.json").takeIf { it.exists() }?.let(::scrubRuntimeFile)
            stopCore(stopService = strictProbeStart, invalidateStart = false)
        }
    }

    private suspend fun startXrayCore(profile: ServerProfile, settings: RuntimeSettings, generation: Long) {
        RuntimeSupport.validationIssue(profile)?.let { error(it) }
        val attempts = listOf(false, true)
        var lastError: Throwable? = null

        for (stripFlow in attempts) {
            ensureStartCurrent(generation)
            cleanupXrayRuntime()
            val config = xrayConfigFactory.build(profile, settings, stripFlow)
            val summary = xrayConfigFactory.summarize(config)
            VpnState.event("Runtime config: $summary")
            Log.i(TAG, "Runtime config: $summary")
            runCatching {
                startXrayProcess(config)
                ensureStartCurrent(generation)
                val profileProbe = probeXraySocks(config.localSocksPort)
                if (!profileProbe.success) error("Xray profile probe failed: ${profileProbe.lastError}")
                setupXrayVpn(config, settings)
                ensureXrayTunnelReady()
                ensureStartCurrent(generation)
                coreRunning = true
                setVpnStatus(VpnStatus.Running)
                VpnState.event("Xray connected")
                withContext(Dispatchers.Main) {
                    startForegroundCompat(notification("Connected", profile.displayName))
                }
                return
            }.onFailure { error ->
                lastError = error
                VpnState.event("Xray attempt failed: ${safeVpnError(error)}")
                cleanupXrayRuntime()
            }
        }

        throw lastError ?: IllegalStateException("Xray runtime failed")
    }

    private fun startXrayProcess(config: XrayRuntimeConfig) {
        XrayNativeFiles.prepareAssets(this)
        val configFile = filesDir.resolve(XRAY_CONFIG_FILE).apply {
            writeText(config.fullJsonConfig)
        }
        val xrayExecutable = XrayNativeFiles.prepareExecutable(this, XRAY_EXECUTABLE_NAME)
        val processBuilder = ProcessBuilder(xrayExecutable.absolutePath, "-config", configFile.absolutePath)
            .directory(filesDir)
            .redirectErrorStream(true)
        processBuilder.environment()["XRAY_LOCATION_ASSET"] = filesDir.absolutePath
        processBuilder.environment()["LD_LIBRARY_PATH"] = applicationInfo.nativeLibraryDir
        val process = processBuilder.start()
        xrayProcess = process
        Thread { readXrayOutput(process) }.start()
    }

    private fun setupXrayVpn(config: XrayRuntimeConfig, settings: RuntimeSettings) {
        closeTun()
        val builder = Builder()
            .setSession(config.remark.ifBlank { "Lumen Xray" })
            .setMtu(XRAY_VPN_MTU)
            .addAddress(XRAY_VPN_ADDRESS, XRAY_VPN_PREFIX_LENGTH)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)
        configureXrayRoutes(builder, config)
        wireGuardDnsServers(settings).forEach { dns ->
            runCatching { builder.addDnsServer(dns) }
        }
        applyXrayPerAppRules(builder, settings)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            builder.setUnderlyingNetworks(null)
        }
        tunFd = builder.establish() ?: error("VPN establish failed")
        VpnState.event("Xray TUN established")
        runTun2socks(config)
    }

    private fun configureXrayRoutes(builder: Builder, config: XrayRuntimeConfig) {
        val address = config.connectedServerAddress
        if (looksLikeIpv4Address(address)) {
            runCatching {
                excludeIp(address).forEach { route ->
                    builder.addRoute(route.substringBefore('/'), route.substringAfter('/').toInt())
                }
            }.onFailure {
                builder.addRoute("0.0.0.0", 0)
            }
        } else {
            builder.addRoute("0.0.0.0", 0)
        }
    }

    private fun applyXrayPerAppRules(builder: Builder, settings: RuntimeSettings) {
        if (strictProbeStart) return
        val apps = settings.splitApps.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        when (settings.splitMode) {
            "include" -> {
                apps.forEach { app -> if (app != packageName) addAllowed(builder, app) }
            }
            "exclude" -> {
                apps.forEach { app -> if (app != packageName) addDisallowed(builder, app) }
                addDisallowed(builder, packageName)
            }
            else -> addDisallowed(builder, packageName)
        }
    }

    private fun runTun2socks(config: XrayRuntimeConfig) {
        val executable = XrayNativeFiles.prepareExecutable(this, TUN2SOCKS_EXECUTABLE_NAME)
        val socketPath = filesDir.resolve(XRAY_SOCKET_PATH).absolutePath
        runCatching { filesDir.resolve(XRAY_SOCKET_PATH).delete() }
        val processBuilder = ProcessBuilder(buildTun2socksCommand(executable.absolutePath, socketPath, config))
            .directory(filesDir)
            .redirectErrorStream(true)
        processBuilder.environment()["LD_LIBRARY_PATH"] = applicationInfo.nativeLibraryDir
        val process = processBuilder.start()
        tun2socksProcess = process
        Thread { readTun2socksOutput(process) }.start()
        sendTunFd(socketPath)
    }

    private fun buildTun2socksCommand(executablePath: String, socketPath: String, config: XrayRuntimeConfig): List<String> {
        val currentAbi = Build.SUPPORTED_ABIS.firstOrNull().orEmpty().lowercase()
        return if (currentAbi.startsWith("x86")) {
            listOf(
                executablePath,
                "--netif-ipaddr",
                "26.26.26.2",
                "--netif-netmask",
                "255.255.255.252",
                "--socks-server-addr",
                "127.0.0.1:${config.localSocksPort}",
                "--tunmtu",
                XRAY_VPN_MTU.toString(),
                "--sock-path",
                XRAY_SOCKET_PATH,
                "--enable-udprelay",
                "--loglevel",
                "info",
            )
        } else {
            listOf(
                executablePath,
                "-sock-path",
                socketPath,
                "-proxy",
                "socks5://127.0.0.1:${config.localSocksPort}",
                "-mtu",
                XRAY_VPN_MTU.toString(),
                "-loglevel",
                "info",
            )
        }
    }

    private fun sendTunFd(socketPath: String) {
        val descriptor = tunFd?.fileDescriptor ?: error("TUN file descriptor is missing")
        var sent = false
        repeat(FD_TRANSFER_MAX_RETRIES) {
            if (sent) return@repeat
            runCatching {
                Thread.sleep(FD_TRANSFER_RETRY_DELAY_MS)
                if (!File(socketPath).exists()) return@runCatching
                LocalSocket().use { socket ->
                    socket.connect(LocalSocketAddress(socketPath, LocalSocketAddress.Namespace.FILESYSTEM))
                    socket.setFileDescriptorsForSend(arrayOf(descriptor))
                    socket.outputStream.write(FD_TRANSFER_MAGIC_BYTE)
                    socket.setFileDescriptorsForSend(null)
                    socket.shutdownOutput()
                }
                sent = true
            }
        }
        if (!sent) error("Failed to pass the VPN interface to tun2socks.")
    }

    private fun ensureXrayTunnelReady() {
        repeat(XRAY_TUN_READY_CHECKS) { attempt ->
            val tun2socks = tun2socksProcess
            val xray = xrayProcess
            if (tun2socks?.isAlive == true && xray?.isAlive == true) {
                if (attempt > 0) VpnState.event("Xray TUN ready")
                return
            }
            if (attempt < XRAY_TUN_READY_CHECKS - 1) Thread.sleep(XRAY_TUN_READY_DELAY_MS)
        }
        error("Xray tunnel process is not running")
    }

    private fun probeXraySocks(port: Int): XrayProbeResult {
        var lastError = "no probe attempt completed"
        repeat(XRAY_PROBE_ATTEMPTS) { attempt ->
            XRAY_PROBE_URLS.forEach { url ->
                val result = runCatching { probeHttpOverSocks(port, URL(url)) }
                if (result.isSuccess) {
                    return XrayProbeResult(success = true)
                }
                lastError = "${URL(url).host}: ${safeVpnError(result.exceptionOrNull() ?: IllegalStateException("probe failed"))}"
                Log.w(TAG, "Xray probe failed for ${URL(url).host}: ${SecretRedactor.redact(lastError)}")
            }
            if (attempt < XRAY_PROBE_ATTEMPTS - 1) Thread.sleep(XRAY_PROBE_RETRY_DELAY_MS)
        }
        return XrayProbeResult(success = false, lastError = lastError)
    }

    private fun probeHttpOverSocks(port: Int, url: URL): Boolean {
        val connection = url.openConnection(
            Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", port)),
        ) as HttpURLConnection
        connection.connectTimeout = XRAY_PROBE_TIMEOUT_MS
        connection.readTimeout = XRAY_PROBE_TIMEOUT_MS
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = true
        connection.useCaches = false
        connection.setRequestProperty("User-Agent", "LumenVPN/1.0")
        return try {
            val status = connection.responseCode
            require(status in 100..499) { "HTTP probe failed code=$status" }
            true
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun probeOpenVpnDataPath(): XrayProbeResult = withContext(Dispatchers.IO) {
        var lastError = "no probe attempt completed"
        repeat(OPENVPN_PROBE_ATTEMPTS) { attempt ->
            if (isSystemVpnValidated()) {
                return@withContext XrayProbeResult(success = true)
            }
            OPENVPN_PROBE_URLS.forEach { url ->
                val target = URL(url)
                val result = runCatching { probeHttpDirect(target, OPENVPN_PROBE_TIMEOUT_MS) }
                if (result.isSuccess) {
                    return@withContext XrayProbeResult(success = true)
                }
                lastError = "${target.host}: ${safeVpnError(result.exceptionOrNull() ?: IllegalStateException("probe failed"))}"
                Log.w(TAG, "OpenVPN data probe failed for ${target.host}: ${SecretRedactor.redact(lastError)}")
            }
            if (attempt < OPENVPN_PROBE_ATTEMPTS - 1) delay(OPENVPN_PROBE_RETRY_DELAY_MS)
        }
        XrayProbeResult(success = false, lastError = lastError)
    }

    private fun isSystemVpnValidated(): Boolean {
        val connectivity = getSystemService(ConnectivityManager::class.java) ?: return false
        return connectivity.allNetworks.any { network ->
            val capabilities = connectivity.getNetworkCapabilities(network) ?: return@any false
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        }
    }

    private fun probeHttpDirect(url: URL, timeoutMs: Int): Boolean {
        val connection = url.openConnection() as HttpURLConnection
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        connection.requestMethod = "GET"
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.setRequestProperty("User-Agent", "LumenVPN/1.0")
        return try {
            val status = connection.responseCode
            require(status in 100..499) { "HTTP probe failed code=$status" }
            true
        } finally {
            connection.disconnect()
        }
    }

    private fun skipSocksAddress(input: InputStream, atyp: Int) {
        val length = when (atyp) {
            0x01 -> 4
            0x03 -> input.read().takeIf { it >= 0 } ?: error("SOCKS domain length missing")
            0x04 -> 16
            else -> error("Unsupported SOCKS address type $atyp")
        }
        input.readExactly(length + 2)
    }

    private fun InputStream.readExactly(length: Int): ByteArray {
        val buffer = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = read(buffer, offset, length - offset)
            if (read < 0) error("Unexpected EOF from SOCKS probe")
            offset += read
        }
        return buffer
    }

    private fun InputStream.readAsciiLine(): String {
        val buffer = StringBuilder()
        while (buffer.length < XRAY_PROBE_STATUS_LINE_LIMIT) {
            val value = read()
            if (value < 0 || value == '\n'.code) break
            if (value != '\r'.code) buffer.append(value.toChar())
        }
        return buffer.toString()
    }

    private fun readXrayOutput(process: java.lang.Process) {
        readRuntimeOutput(process, "Xray")
    }

    private fun readTun2socksOutput(process: java.lang.Process) {
        readRuntimeOutput(process, "tun2socks")
    }

    private fun readRuntimeOutput(process: java.lang.Process, label: String) {
        val tail = ArrayDeque<String>()
        val exitCode = try {
            process.inputStream?.let { input ->
                BufferedReader(InputStreamReader(input)).use { reader ->
                    while (true) {
                        val line = try {
                            reader.readLine()
                        } catch (_: InterruptedIOException) {
                            break
                        } ?: break
                        val safe = SecretRedactor.redact(line)
                        tail.addLast(safe)
                        while (tail.size > 8) tail.removeFirst()
                        Log.i(TAG, "$label: $safe")
                    }
                }
            }
            process.waitFor()
        } catch (_: Throwable) {
            runCatching { process.waitFor() }.getOrDefault(0)
        }
        if (coreRunning && (process == xrayProcess || process == tun2socksProcess)) {
            VpnState.lastError = "$label stopped unexpectedly (exit $exitCode)"
            VpnState.event("$label stopped unexpectedly: ${tail.joinToString(" | ")}")
            requestStop(stopService = false)
        }
    }

    private fun cleanupXrayRuntime() {
        val tun2socks = tun2socksProcess
        tun2socksProcess = null
        runCatching {
            tun2socks?.destroy()
            tun2socks?.waitFor(2, TimeUnit.SECONDS)
            if (tun2socks?.isAlive == true) tun2socks.destroyForcibly()
        }
        val xray = xrayProcess
        xrayProcess = null
        runCatching {
            xray?.destroy()
            xray?.waitFor(2, TimeUnit.SECONDS)
            if (xray?.isAlive == true) xray.destroyForcibly()
        }
        runCatching { filesDir.resolve(XRAY_SOCKET_PATH).delete() }
        closeTun()
    }

    private suspend fun startOpenVpnCore(
        profile: ServerProfile,
        settings: RuntimeSettings,
        generation: Long,
        openVpnBridgePort: Int? = null,
    ) {
        RuntimeSupport.validationIssue(profile)?.let { error(it) }
        val protocol = when (RuntimeSupport.backend(profile)) {
            RuntimeBackend.OPENVPN_CLOAK -> OpenVpnOverCloak()
            else -> OpenVpn()
        }
        val state = MutableStateFlow(ProtocolState.DISCONNECTED)
        openVpnError = null
        protocol.initialize(applicationContext, state) { message ->
            val safe = SecretRedactor.redact(message)
            openVpnError = safe
            VpnState.lastError = safe
            VpnState.event("OpenVPN error: $safe")
            publishStrictProbeStatus(VpnStatus.Error, safe)
            if (VpnState.status == VpnStatus.Running) {
                requestStop(stopService = false)
            }
        }
        openVpn = protocol
        openVpnState = state

        VpnState.event("Starting OpenVPN3 for ${profile.displayName} ${profile.host}:${profile.port}")
        Log.i(TAG, "Starting OpenVPN3 for ${profile.displayName} ${profile.host}:${profile.port}")
        ensureStartCurrent(generation)
        protocol.startVpn(openVpnConfig(profile, settings, openVpnBridgePort), Builder(), ::protect)
        ensureStartCurrent(generation)
        withTimeout(OPENVPN_READY_TIMEOUT_MS) {
            state.first { it == ProtocolState.CONNECTED || openVpnError != null }
        }
        ensureStartCurrent(generation)
        if (state.value != ProtocolState.CONNECTED) {
            error(openVpnError ?: "OpenVPN disconnected before connection completed")
        }
        if (strictProbeStart) {
            delay(OPENVPN_STRICT_PROBE_ROUTE_SETTLE_DELAY_MS)
        } else {
            VpnState.event("OpenVPN data path check")
            delay(OPENVPN_ROUTE_SETTLE_DELAY_MS)
            val dataPathProbe = probeOpenVpnDataPath()
            if (!dataPathProbe.success) {
                error("OpenVPN data path probe failed: ${dataPathProbe.lastError}")
            }
        }
        coreRunning = true
        setVpnStatus(VpnStatus.Running)
        VpnState.event("OpenVPN connected")
        withContext(Dispatchers.Main) {
            startForegroundCompat(notification("Connected", profile.displayName))
        }
    }

    private suspend fun startOpenVpnShadowsocksCore(profile: ServerProfile, settings: RuntimeSettings, generation: Long) {
        RuntimeSupport.validationIssue(profile)?.let { error(it) }
        val openVpnTargetHost = openVpnRemoteHost(profile.rawUri)
        val openVpnTargetPort = openVpnRemotePort(profile.rawUri)
        val bridgePort = freeLoopbackPort()
        val bridgeConfig = xrayConfigFactory.buildOpenVpnShadowsocksBridge(
            profile = profile,
            targetHost = openVpnTargetHost,
            targetPort = openVpnTargetPort,
            localBridgePort = bridgePort,
        )
        VpnState.event("Starting OpenVPN over Shadowsocks bridge")
        Log.i(TAG, "Starting OpenVPN over Shadowsocks bridge for ${profile.displayName}")
        startXrayProcess(bridgeConfig)
        ensureStartCurrent(generation)
        startOpenVpnCore(profile, settings, generation, openVpnBridgePort = bridgePort)
    }

    private suspend fun startAmneziaWgCore(profile: ServerProfile, settings: RuntimeSettings, generation: Long) {
        RuntimeSupport.validationIssue(profile)?.let { error(it) }
        val configText = amneziaWgConfig(profile.rawUri, settings)
        val config = ByteArrayInputStream(configText.toByteArray(Charsets.UTF_8)).use { input ->
            AmneziaWgConfig.parse(input)
        }

        val nativeName = RuntimeSupport.label(profile.protocol)
        VpnState.event("Starting $nativeName native for ${profile.displayName} ${profile.host}:${profile.port}")
        Log.i(TAG, "Starting $nativeName native for ${profile.displayName} ${profile.host}:${profile.port}")
        ensureStartCurrent(generation)
        withContext(Dispatchers.IO) {
            startAmneziaWgNative(config, profile.displayName)
        }
        ensureStartCurrent(generation)
        coreRunning = true
        setVpnStatus(VpnStatus.Running)
        VpnState.event("$nativeName connected")
        withContext(Dispatchers.Main) {
            startForegroundCompat(notification("Connected", profile.displayName))
        }
    }

    private fun startAmneziaWgNative(config: AmneziaWgConfig, sessionName: String) {
        System.loadLibrary("am-go")
        val iface = config.getInterface()
        val builder = Builder().setSession(sessionName.ifBlank { "lumenawg" })
        val resolvedConfig = sanitizeAmneziaWireGuardObfuscation(
            config.toAwgQuickStringResolved(false, false, false, applicationContext)
        )
        Log.d(TAG, "AmneziaWG resolved obfuscation: ${summarizeAmneziaWireGuardObfuscation(resolvedConfig)}")
        val uapiPath = applicationContext.dataDir.absolutePath

        for (excludedApplication in iface.getExcludedApplications()) {
            runCatching { builder.addDisallowedApplication(excludedApplication) }
        }
        for (includedApplication in iface.getIncludedApplications()) {
            runCatching { builder.addAllowedApplication(includedApplication) }
        }
        for (addr in iface.getAddresses()) {
            builder.addAddress(addr.getAddress(), addr.getMask())
        }
        for (dns in iface.getDnsServers()) {
            dns.hostAddress?.let { builder.addDnsServer(it) }
        }
        for (dnsSearchDomain in iface.getDnsSearchDomains()) {
            builder.addSearchDomain(dnsSearchDomain)
        }

        var sawDefaultRoute = false
        for (peer in config.getPeers()) {
            for (addr in peer.getAllowedIps()) {
                if (addr.getMask() == 0) sawDefaultRoute = true
                builder.addRoute(addr.getAddress(), addr.getMask())
            }
        }
        if (!(sawDefaultRoute && config.getPeers().size == 1)) {
            builder.allowFamily(OsConstants.AF_INET)
            builder.allowFamily(OsConstants.AF_INET6)
        }
        builder.setMtu(iface.getMtu().orElse(1280))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            builder.setUnderlyingNetworks(null)
        }
        builder.setBlocking(true)

        val handle = builder.establish().use { tun ->
            requireNotNull(tun) { "AmneziaWG TUN creation failed" }
            Log.d(TAG, "AmneziaWG go backend ${AmneziaWgNative.awgVersion()}")
            AmneziaWgNative.awgTurnOn(AMNEZIAWG_INTERFACE_NAME, tun.detachFd(), resolvedConfig, uapiPath)
        }
        if (handle < 0) {
            error("AmneziaWG tunnel creation error: $handle")
        }
        amneziaWgHandle = handle
        if (!protectAmneziaSocket(AmneziaWgNative.awgGetSocketV4(handle)) ||
            !protectAmneziaSocket(AmneziaWgNative.awgGetSocketV6(handle))
        ) {
            amneziaWgHandle = -1
            runCatching { AmneziaWgNative.awgTurnOff(handle) }
            error("AmneziaWG socket protect failed")
        }
    }

    private fun protectAmneziaSocket(fd: Int): Boolean =
        fd < 0 || protect(fd)

    private fun amneziaWgConfig(rawConfig: String, settings: RuntimeSettings): String {
        val normalized = sanitizeAmneziaWireGuardObfuscation(
            ensureWireGuardDns(
                stripWireGuardIpv6RoutesIfDisabled(
                    ensureWireGuardAllowedIps(normalizeWireGuardAddresses(rawConfig), settings),
                    settings,
                ),
                settings,
            ),
        )
        val apps = settings.splitApps
            .map { it.trim() }
            .filter { it.isNotBlank() && it != packageName }
            .distinct()
        val appRule = when (settings.splitMode) {
            "include" -> "IncludedApplications = ${apps.joinToString(", ")}".takeIf { apps.isNotEmpty() }
            "exclude" -> "ExcludedApplications = ${apps.joinToString(", ")}".takeIf { apps.isNotEmpty() }
            else -> null
        }
        if (appRule == null) return normalized

        val output = mutableListOf<String>()
        var inserted = false
        var inInterface = false
        for (line in normalized.lineSequence()) {
            val trimmed = line.trim()
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                if (inInterface && !inserted) {
                    output += appRule
                    inserted = true
                }
                inInterface = trimmed.equals("[Interface]", ignoreCase = true)
                output += line
                continue
            }
            if (inInterface && (
                    trimmed.startsWith("IncludedApplications", ignoreCase = true) ||
                        trimmed.startsWith("ExcludedApplications", ignoreCase = true)
                )
            ) {
                continue
            }
            output += line
        }
        if (inInterface && !inserted) output += appRule
        return output.joinToString("\n")
    }

    private fun ensureWireGuardAllowedIps(config: String, settings: RuntimeSettings): String {
        val defaultAllowedIps = buildList {
            add("0.0.0.0/0")
            if (settings.ipv6) add("::/0")
        }.joinToString(", ")
        val output = mutableListOf<String>()
        var inPeer = false
        var peerSeen = false
        var allowedIpsSeen = false

        fun insertAllowedIpsIfNeeded() {
            if (peerSeen && inPeer && !allowedIpsSeen) {
                output += "AllowedIPs = $defaultAllowedIps"
                allowedIpsSeen = true
            }
        }

        for (line in config.lineSequence()) {
            val trimmed = line.trim()
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                insertAllowedIpsIfNeeded()
                inPeer = trimmed.equals("[Peer]", ignoreCase = true)
                if (inPeer) {
                    peerSeen = true
                    allowedIpsSeen = false
                }
                output += line
                continue
            }
            if (inPeer && (
                    trimmed.startsWith("AllowedIPs", ignoreCase = true) ||
                        trimmed.startsWith("AllowedIps", ignoreCase = true)
                )
            ) {
                allowedIpsSeen = true
            }
            output += line
        }
        insertAllowedIpsIfNeeded()
        return output.joinToString("\n")
    }

    private fun stripWireGuardIpv6RoutesIfDisabled(config: String, settings: RuntimeSettings): String {
        if (settings.ipv6) return config
        return config.lineSequence().mapNotNull { line ->
            val parts = line.split("=", limit = 2)
            if (parts.size != 2) return@mapNotNull line
            val key = parts[0].trim()
            val value = parts[1].trim()
            when {
                key.equals("Address", ignoreCase = true) ||
                    key.equals("DNS", ignoreCase = true) ||
                    key.equals("AllowedIPs", ignoreCase = true) ||
                    key.equals("AllowedIps", ignoreCase = true) -> {
                    val ipv4Only = value.split(",")
                        .map { it.trim() }
                        .filter { it.isNotBlank() && ":" !in it }
                    when {
                        ipv4Only.isNotEmpty() -> "${line.substringBefore("=")}= ${ipv4Only.joinToString(", ")}"
                        key.equals("AllowedIPs", ignoreCase = true) || key.equals("AllowedIps", ignoreCase = true) ->
                            "${line.substringBefore("=")}= 0.0.0.0/0"
                        else -> null
                    }
                }
                else -> line
            }
        }.joinToString("\n")
    }

    private fun ensureWireGuardDns(config: String, settings: RuntimeSettings): String {
        val fallbackDns = wireGuardDnsServers(settings)
        val output = mutableListOf<String>()
        var inInterface = false
        var interfaceSeen = false
        var dnsSeen = false

        fun insertDnsIfNeeded() {
            if (interfaceSeen && inInterface && !dnsSeen) {
                output += "DNS = ${fallbackDns.joinToString(", ")}"
                dnsSeen = true
            }
        }

        for (line in config.lineSequence()) {
            val trimmed = line.trim()
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                insertDnsIfNeeded()
                inInterface = trimmed.equals("[Interface]", ignoreCase = true)
                if (inInterface) {
                    interfaceSeen = true
                    dnsSeen = false
                }
                output += line
                continue
            }
            if (inInterface && trimmed.startsWith("DNS", ignoreCase = true)) {
                dnsSeen = true
            }
            output += line
        }
        insertDnsIfNeeded()
        return output.joinToString("\n")
    }

    private fun wireGuardDnsServers(settings: RuntimeSettings): List<String> = when (settings.dnsMode) {
        "google" -> listOf("8.8.8.8", "8.8.4.4")
        "quad9" -> listOf("9.9.9.9", "149.112.112.112")
        "custom" -> settings.customDns
            .split(",", "\n", " ")
            .map { it.trim().substringBefore(":") }
            .filter { it.isNotBlank() && looksLikeIpAddress(it) && ":" !in it }
            .distinct()
            .ifEmpty { listOf("1.1.1.1", "1.0.0.1") }
        else -> listOf("1.1.1.1", "1.0.0.1")
    }

    private fun normalizeWireGuardAddresses(config: String): String {
        val interfaceLines = mutableListOf<String>()
        val peerSections = mutableListOf<MutableList<String>>()
        val preamble = mutableListOf<String>()
        val movedInterfaceLines = mutableListOf<String>()
        var section = ""
        var currentPeer: MutableList<String>? = null

        fun targetLines(): MutableList<String> = when (section) {
            "interface" -> interfaceLines
            "peer" -> currentPeer ?: mutableListOf<String>().also {
                currentPeer = it
                peerSections += it
            }
            else -> preamble
        }

        for (rawLine in config.replace("\uFEFF", "").lineSequence()) {
            val line = rawLine.trimEnd()
            val trimmed = line.trim()
            if (trimmed.isBlank()) continue
            if (trimmed.equals("[Interface]", ignoreCase = true)) {
                section = "interface"
                if (interfaceLines.none { it.trim().equals("[Interface]", ignoreCase = true) }) {
                    interfaceLines += "[Interface]"
                }
                continue
            }
            if (trimmed.equals("[Peer]", ignoreCase = true)) {
                section = "peer"
                currentPeer = mutableListOf("[Peer]").also { peerSections += it }
                continue
            }
            if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
                section = ""
                targetLines() += line
                continue
            }
            if (trimmed.matches(Regex("^[A-Za-z0-9]+\\s*=\\s*$"))) continue
            val normalized = normalizeWireGuardLine(line) ?: continue
            val key = normalized.substringBefore("=", "").trim().lowercase()
            if (section == "peer" && key in AMNEZIA_INTERFACE_ONLY_KEYS) {
                movedInterfaceLines += normalized
                continue
            }
            targetLines() += normalized
        }

        if (interfaceLines.none { it.trim().equals("[Interface]", ignoreCase = true) }) {
            interfaceLines.add(0, "[Interface]")
        }
        val existingInterfaceKeys = interfaceLines
            .mapNotNull { it.substringBefore("=", "").trim().lowercase().takeIf(String::isNotBlank) }
            .toMutableSet()
        for (line in movedInterfaceLines) {
            val key = line.substringBefore("=", "").trim().lowercase()
            if (existingInterfaceKeys.add(key)) interfaceLines += line
        }

        return buildList {
            addAll(preamble)
            addAll(interfaceLines)
            peerSections.forEach { peer ->
                add("")
                addAll(peer)
            }
        }.joinToString("\n")
    }

    private fun normalizeWireGuardLine(line: String): String? {
        val parts = line.split("=", limit = 2)
        if (parts.size != 2) return line
        val key = parts[0].trim()
        if (key.isBlank()) return null
        val value = parts[1].trim()
        if (value.isBlank()) return null
        return when {
            key.equals("Address", ignoreCase = true) -> {
                val values = value.split(",").joinToString(", ") { address ->
                    val item = address.trim()
                    when {
                        item.isBlank() || "/" in item -> item
                        ":" in item -> "$item/128"
                        else -> "$item/32"
                    }
                }
                "${line.substringBefore("=")}= $values"
            }
            key.equals("DNS", ignoreCase = true) -> {
                val dns = normalizedDnsServers(value)
                "${line.substringBefore("=")}= ${dns.joinToString(", ")}"
            }
            key.equals("PresharedKey", ignoreCase = true) ||
                key.equals("PreSharedKey", ignoreCase = true) ->
                "PreSharedKey = $value"
            else -> line
        }
    }

    private fun sanitizeAmneziaWireGuardObfuscation(config: String): String {
        val optionValues = mutableMapOf<String, String>()
        for (line in config.lineSequence()) {
            val parts = line.split("=", limit = 2)
            if (parts.size != 2) continue
            val key = parts[0].trim().lowercase()
            if (key in AMNEZIA_POSITIVE_INT_KEYS) optionValues[key] = parts[1].trim()
            if (key in AMNEZIA_MAGIC_HEADER_KEYS) optionValues[key] = parts[1].trim()
        }
        val hasValidJunkCount = hasValidAmneziaJunkCount(optionValues)
        val hasValidHeaderGroup = hasValidAmneziaHeaderGroup(optionValues)
        val usesWireGuardSections = config.lineSequence().any { line ->
            line.trim().equals("[Interface]", ignoreCase = true) || line.trim().equals("[Peer]", ignoreCase = true)
        }
        val junkDefaults = if (usesWireGuardSections) {
            listOf("Jc = 4", "Jmin = 64", "Jmax = 256")
        } else {
            listOf("jc=4", "jmin=64", "jmax=256")
        }
        val headerDefaults = if (usesWireGuardSections) {
            listOf(
                "H1 = ${optionValues["h1"].orDefault("1")}",
                "H2 = ${optionValues["h2"].orDefault("2")}",
                "H3 = ${optionValues["h3"].orDefault("3")}",
                "H4 = ${optionValues["h4"].orDefault("4")}",
            )
        } else {
            listOf(
                "h1=${optionValues["h1"].orDefault("1")}",
                "h2=${optionValues["h2"].orDefault("2")}",
                "h3=${optionValues["h3"].orDefault("3")}",
                "h4=${optionValues["h4"].orDefault("4")}",
            )
        }
        val obfuscationDefaults = buildList {
            if (!hasValidJunkCount) addAll(junkDefaults)
            if (!hasValidHeaderGroup) addAll(headerDefaults)
        }
        val output = mutableListOf<String>()
        var insertedDefaults = obfuscationDefaults.isEmpty()
        for (line in config.lineSequence()) {
            val trimmed = line.trim()
            if (!insertedDefaults) {
                val startsPeer = trimmed.equals("[Peer]", ignoreCase = true) || trimmed.startsWith("public_key=")
                if (startsPeer || (!usesWireGuardSections && output.isEmpty())) {
                    output += obfuscationDefaults
                    insertedDefaults = true
                }
            }
            if (trimmed.equals("[Interface]", ignoreCase = true)) {
                output += line
                continue
            }
            if (trimmed.equals("[Peer]", ignoreCase = true)) {
                if (!insertedDefaults) {
                    output += obfuscationDefaults
                    insertedDefaults = true
                }
                output += line
                continue
            }
            val parts = line.split("=", limit = 2)
            if (parts.size != 2) {
                output += line
                continue
            }
            val key = parts[0].trim().lowercase()
            if (key in AMNEZIA_JUNK_COUNT_KEYS && !hasValidJunkCount) continue
            if (key in AMNEZIA_MAGIC_HEADER_KEYS && !hasValidHeaderGroup) continue
            if (key in AMNEZIA_POSITIVE_INT_KEYS) {
                if (parts[1].trim().toIntOrNull()?.let { it > 0 } != true) continue
            }
            output += line
        }
        if (!insertedDefaults) output += obfuscationDefaults
        return output.joinToString("\n")
    }

    private fun hasValidAmneziaJunkCount(optionValues: Map<String, String>): Boolean {
        val count = optionValues["jc"]?.toIntOrNull() ?: return false
        val min = optionValues["jmin"]?.toIntOrNull() ?: return false
        val max = optionValues["jmax"]?.toIntOrNull() ?: return false
        return count > 0 && min > 0 && max > 0 && min <= max
    }

    private fun hasValidAmneziaHeaderGroup(optionValues: Map<String, String>): Boolean =
        AMNEZIA_MAGIC_HEADER_KEYS.all { key -> optionValues[key]?.isNotBlank() == true }

    private fun String?.orDefault(defaultValue: String): String =
        this?.takeIf { it.isNotBlank() } ?: defaultValue

    private fun summarizeAmneziaWireGuardObfuscation(config: String): String {
        val values = config.lineSequence()
            .mapNotNull { line ->
                val parts = line.split("=", limit = 2)
                if (parts.size != 2) return@mapNotNull null
                val key = parts[0].trim().lowercase()
                if (key !in AMNEZIA_POSITIVE_INT_KEYS && key !in AMNEZIA_HEADER_KEYS) return@mapNotNull null
                "$key=${parts[1].trim()}"
            }
            .toList()
        return values.ifEmpty { listOf("none") }.joinToString(",")
    }

    private fun normalizedDnsServers(value: String): List<String> {
        val parsed = value.split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() && "$" !in it && looksLikeIpAddress(it) }
        return parsed.ifEmpty { listOf("1.1.1.1", "8.8.8.8") }
    }

    private fun looksLikeIpAddress(value: String): Boolean {
        if (value.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$"))) {
            return value.split(".").all { it.toIntOrNull()?.let { octet -> octet in 0..255 } == true }
        }
        return ":" in value && value.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' || it == ':' || it == '.' }
    }

    private fun looksLikeIpv4Address(value: String): Boolean =
        value.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")) &&
            value.split(".").all { it.toIntOrNull()?.let { octet -> octet in 0..255 } == true }

    private fun excludeIp(ip: String): List<String> {
        val parts = ip.split(".").map { it.toLong() }
        val ipValue = (parts[0] shl 24) + (parts[1] shl 16) + (parts[2] shl 8) + parts[3]
        val routes = mutableListOf<String>()
        addRoutesExcluding(routes, ipValue, 0L, 0)
        return routes
    }

    private fun addRoutesExcluding(routes: MutableList<String>, ipValue: Long, base: Long, prefix: Int) {
        if (prefix >= 32) return
        val nextPrefix = prefix + 1
        val split = base + (1L shl (32 - nextPrefix))
        if (ipValue < split) {
            routes += "${longToIp(split)}/$nextPrefix"
            addRoutesExcluding(routes, ipValue, base, nextPrefix)
        } else {
            routes += "${longToIp(base)}/$nextPrefix"
            addRoutesExcluding(routes, ipValue, split, nextPrefix)
        }
    }

    private fun longToIp(ip: Long): String =
        "${(ip shr 24) and 255}.${(ip shr 16) and 255}.${(ip shr 8) and 255}.${ip and 255}"

    private fun safeVpnError(error: Throwable): String = when (error) {
        is BadConfigException -> {
            val section = error.section.name.lowercase()
            val location = error.location.name.lowercase()
            val reason = error.reason.name.lowercase()
            "Invalid VPN config: $section/$location/$reason"
        }
        else -> SecretRedactor.redact(error.message ?: error::class.java.simpleName)
    }

    private fun openVpnConfig(
        profile: ServerProfile,
        settings: RuntimeSettings,
        openVpnBridgePort: Int? = null,
    ): JSONObject =
        JSONObject().apply {
            put("protocol", "openvpn")
            put("hostName", openVpnBridgePort?.let { "127.0.0.1" } ?: profile.host.ifBlank { openVpnRemoteHost(profile.rawUri) })
            put("port", openVpnBridgePort ?: profile.port.takeIf { it in 1..65535 } ?: openVpnRemotePort(profile.rawUri))
            put("description", profile.displayName)
            put(
                "openvpn_config_data",
                JSONObject().apply {
                    put(
                        "config",
                        openVpnBridgePort?.let { openVpnConfigForLocalTcpBridge(profile.rawUri, it) } ?: profile.rawUri,
                    )
                    openVpnUsername(profile).takeIf { it.isNotBlank() }?.let { put("username", it) }
                    openVpnPassword(profile).takeIf { it.isNotBlank() }?.let { put("password", it) }
                },
            )
            if (profile.protocol == ProtocolType.OPENVPN_CLOAK) {
                put("cloak_config_data", JSONObject().put("config", profile.extraJson))
            }
            put("splitTunnelType", 0)
            put("splitTunnelSites", JSONArray())
            put("appSplitTunnelType", appSplitTunnelType(settings.splitMode))
            put("splitTunnelApps", JSONArray().apply {
                settings.splitApps.distinct().forEach { put(it) }
            })
        }

    private fun openVpnUsername(profile: ServerProfile): String =
        profile.extraString("openvpn_username", "openvpn.username").ifBlank { profile.username }

    private fun openVpnPassword(profile: ServerProfile): String =
        profile.extraString("openvpn_password", "openvpn.password").ifBlank {
            if (profile.protocol == ProtocolType.OPENVPN_SHADOWSOCKS) "" else profile.password
        }

    private fun openVpnConfigForLocalTcpBridge(config: String, port: Int): String {
        val output = mutableListOf<String>()
        var replacedRemote = false
        var replacedProto = false
        config.lineSequence().forEach { line ->
            val trimmed = line.trim()
            when {
                trimmed.startsWith("remote ", ignoreCase = true) && !replacedRemote -> {
                    output += "remote 127.0.0.1 $port tcp-client"
                    replacedRemote = true
                }
                trimmed.startsWith("remote ", ignoreCase = true) -> Unit
                trimmed.startsWith("proto ", ignoreCase = true) -> {
                    output += "proto tcp-client"
                    replacedProto = true
                }
                isOpenVpnLocalBridgeProxyDirective(trimmed) -> Unit
                else -> output += line
            }
        }
        if (!replacedRemote) output += "remote 127.0.0.1 $port tcp-client"
        if (!replacedProto) output += "proto tcp-client"
        return output.joinToString("\n").trimEnd() + "\n"
    }

    private fun isOpenVpnLocalBridgeProxyDirective(line: String): Boolean {
        val option = line.substringBefore(' ').lowercase()
        return option in setOf(
            "socks-proxy",
            "http-proxy",
            "http-proxy-option",
            "socks-proxy-retry",
        )
    }

    private fun appSplitTunnelType(mode: String): Int = when (mode) {
        "include" -> 1
        "exclude" -> 2
        else -> 0
    }

    private fun ServerProfile.extraString(vararg names: String): String {
        val extra = runCatching { JSONObject(extraJson) }.getOrNull() ?: return ""
        for (name in names) {
            val parts = name.split(".")
            var current: Any? = extra
            for (part in parts) {
                current = (current as? JSONObject)?.opt(part)
            }
            if (current is String && current.isNotBlank()) return current
        }
        return ""
    }

    private fun openVpnRemoteHost(config: String): String =
        config.lineSequence()
            .map { it.trim() }
            .firstOrNull { it.startsWith("remote ", ignoreCase = true) }
            ?.split(Regex("\\s+"))
            ?.getOrNull(1)
            .orEmpty()

    private fun openVpnRemotePort(config: String): Int =
        config.lineSequence()
            .map { it.trim() }
            .firstOrNull { it.startsWith("remote ", ignoreCase = true) }
            ?.split(Regex("\\s+"))
            ?.getOrNull(2)
            ?.toIntOrNull()
            ?: 0

    private suspend fun stopCore(stopService: Boolean = true, invalidateStart: Boolean = true) = stopMutex.withLock {
        if (invalidateStart) startGeneration.incrementAndGet()
        val currentJob = coroutineContext[Job]
        activeStartJob?.takeIf { it.isActive && it != currentJob }?.cancel(CancellationException("VPN stop requested"))
        activeStartJob = null
        val hasRuntime = mobilePrepared ||
            coreRunning ||
            tunFd != null ||
            amneziaWgHandle >= 0 ||
            openVpn != null ||
            VpnState.status != VpnStatus.Stopped
        if (!hasRuntime) {
            setVpnStatus(VpnStatus.Stopped)
            clearStrictProbeState()
            return@withLock
        }
        setVpnStatus(VpnStatus.Stopping)
        VpnState.event("Stopping VPN")
        tunnelReady?.cancel()
        tunnelReady = null
        val closeMobile = mobilePrepared
        coreRunning = false
        cleanupXrayRuntime()
        closeTun()
        runCatching { AndroidDefaultNetworkMonitor.stopAll() }
        if (closeMobile) {
            closeMobileCore()
        }
        closeAmneziaWg()
        closeOpenVpn()
        mobilePrepared = false
        runCatching { scrubRuntimeFile(cacheDir.resolve("core").resolve("active.json")) }
        runCatching { cacheDir.resolve("core").resolve("stderr.log").delete() }
        setVpnStatus(VpnStatus.Stopped)
        VpnState.event("VPN stopped")
        clearStrictProbeState()
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        if (stopService) stopSelf()
    }

    private fun closeMobileCore() {
        runCatching { commandServer?.closeService() }
            .onFailure { Log.w(TAG, "core service close failed: ${SecretRedactor.redact(it.message)}") }
        // Keep the command server object out of the normal disconnect path. Hiddify's
        // Android lifecycle stops the service first and does not close grpc/subscriber
        // channels during the same native teardown; closing them here can race native
        // status/log callbacks and abort the process on disconnect.
        commandServer = null
    }

    private fun closeTun() {
        runCatching { tunFd?.close() }
            .onFailure { Log.w(TAG, "tun close failed: ${SecretRedactor.redact(it.message)}") }
        tunFd = null
    }

    private fun closeAmneziaWg() {
        val handle = amneziaWgHandle
        amneziaWgHandle = -1
        if (handle < 0) return
        runCatching { AmneziaWgNative.awgTurnOff(handle) }
            .onFailure { Log.w(TAG, "amneziawg close failed: ${SecretRedactor.redact(it.message)}") }
    }

    private fun closeOpenVpn() {
        val protocol = openVpn ?: return
        runCatching { protocol.stopVpn() }
            .onFailure { Log.w(TAG, "openvpn close failed: ${SecretRedactor.redact(it.message)}") }
        openVpn = null
        openVpnState = null
        openVpnError = null
    }

    private fun appendCoreStderrEvent() {
        val stderr = cacheDir.resolve("core").resolve("stderr.log")
        if (!stderr.exists()) return
        val tail = runCatching {
            stderr.readLines().takeLast(12).joinToString("\n")
        }.getOrDefault("")
        if (tail.isNotBlank()) {
            VpnState.event("core stderr:\n$tail")
            Log.e(TAG, "core stderr: ${SecretRedactor.redact(tail)}")
        }
    }

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun openTun(options: TunOptions): Int {
        Log.i(TAG, "openTun mtu=${options.mtu} autoRoute=${options.autoRoute} strictRoute=${options.strictRoute}")
        val builder = Builder()
            .setSession("Lumen VPN")
            .setMtu(options.mtu)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)

        val inet4Address = options.inet4Address
        while (inet4Address.hasNext()) {
            val address = inet4Address.next()
            builder.addAddress(address.address(), address.prefix())
        }
        var hasIpv6Address = false
        val inet6Address = options.inet6Address
        while (inet6Address.hasNext()) {
            val address = inet6Address.next()
            builder.addAddress(address.address(), address.prefix())
            hasIpv6Address = true
        }

        if (options.autoRoute) {
            addDnsServers(builder, options)
            addRoutes(builder, options, hasIpv6Address)
            applyPerAppRules(builder, options)
        }

        if (options.isHTTPProxyEnabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setHttpProxy(ProxyInfo.buildDirectProxy(options.httpProxyServer, options.httpProxyServerPort))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            builder.setUnderlyingNetworks(null)
        }

        val pfd = builder.establish() ?: error("VPN establish failed")
        tunFd = pfd
        VpnState.event("TUN established fd=${pfd.fd}")
        Log.i(TAG, "openTun established fd=${pfd.fd}")
        tunnelReady?.complete(Unit)
        return pfd.fd
    }

    private fun addDnsServers(builder: Builder, options: TunOptions) {
        val runtimeSettings = runCatching {
            runBlocking { LumenApplication.instance.container.preferences.runtimeSettings.first() }
        }.getOrDefault(RuntimeSettings())
        val primary = runCatching { options.dnsServerAddress.value }
            .getOrDefault("")
            .takeIf { it.isNotBlank() && looksLikeIpAddress(it) }
        val servers = listOfNotNull(primary)
            .ifEmpty { wireGuardDnsServers(runtimeSettings) }
            .filter { ":" !in it }
            .distinct()
        servers.forEach { server ->
            runCatching { builder.addDnsServer(server) }
                .onFailure { Log.w(TAG, "dns server rejected: ${SecretRedactor.redact(it.message)}") }
        }
    }

    private fun addRoutes(builder: Builder, options: TunOptions, hasIpv6Address: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val v4 = options.inet4RouteAddress
            if (!v4.hasNext()) builder.addRoute("0.0.0.0", 0)
            while (v4.hasNext()) builder.addRoute(v4.next().toIpPrefix())
            val v6 = options.inet6RouteAddress
            if (hasIpv6Address) {
                if (!v6.hasNext()) builder.addRoute("::", 0)
                while (v6.hasNext()) builder.addRoute(v6.next().toIpPrefix())
            }
            val exclude4 = options.inet4RouteExcludeAddress
            while (exclude4.hasNext()) builder.excludeRoute(exclude4.next().toIpPrefix())
            val exclude6 = options.inet6RouteExcludeAddress
            if (hasIpv6Address) while (exclude6.hasNext()) builder.excludeRoute(exclude6.next().toIpPrefix())
        } else {
            val v4 = options.inet4RouteRange
            while (v4.hasNext()) {
                val route = v4.next()
                builder.addRoute(route.address(), route.prefix())
            }
            val v6 = options.inet6RouteRange
            if (hasIpv6Address) {
                while (v6.hasNext()) {
                    val route = v6.next()
                    builder.addRoute(route.address(), route.prefix())
                }
            }
        }
    }

    private fun applyPerAppRules(builder: Builder, options: TunOptions) {
        if (strictProbeStart) return
        val prefs = LumenApplication.instance.container.preferences
        val settings = runBlocking { prefs.runtimeSettings.first() }
        val apps = settings.splitApps
        when (settings.splitMode) {
            "include" -> {
                require(apps.isNotEmpty()) { "Split tunneling include mode requires selected applications" }
                apps.forEach { packageName ->
                    if (packageName != this.packageName) addAllowed(builder, packageName)
                }
                return
            }
            "exclude" -> {
                apps.forEach { packageName ->
                    if (packageName != this.packageName) addDisallowed(builder, packageName)
                }
                addDisallowed(builder, packageName)
                return
            }
        }

        val include = options.includePackage
        if (include.hasNext()) {
            while (include.hasNext()) addAllowed(builder, include.next())
            return
        }
        val exclude = options.excludePackage
        while (exclude.hasNext()) addDisallowed(builder, exclude.next())
        addDisallowed(builder, packageName)
    }

    private fun addAllowed(builder: Builder, packageName: String) {
        if (packageName == this.packageName) return
        try {
            builder.addAllowedApplication(packageName)
        } catch (_: PackageManager.NameNotFoundException) {
        }
    }

    private fun addDisallowed(builder: Builder, packageName: String) {
        try {
            builder.addDisallowedApplication(packageName)
        } catch (_: PackageManager.NameNotFoundException) {
        }
    }

    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true
    override fun autoDetectInterfaceControl(fd: Int) { protect(fd) }
    override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
    override fun underNetworkExtension(): Boolean = false
    override fun includeAllNetworks(): Boolean = false
    override fun clearDNSCache() = Unit
    override fun localDNSTransport(): LocalDNSTransport? = AndroidLocalDnsTransport

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        runBlocking { AndroidDefaultNetworkMonitor.start(listener) }
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        runBlocking { AndroidDefaultNetworkMonitor.stop(listener) }
    }

    override fun getInterfaces(): NetworkInterfaceIterator {
        val container = LumenApplication.instance.container
        val allNetworks = container.connectivity.allNetworks
        val javaInterfaces = NetworkInterface.getNetworkInterfaces().toList()
        val interfaces = mutableListOf<com.hiddify.core.libbox.NetworkInterface>()
        for (network in allNetworks) {
            val props = container.connectivity.getLinkProperties(network) ?: continue
            val caps = container.connectivity.getNetworkCapabilities(network) ?: continue
            val name = props.interfaceName ?: continue
            val jni = javaInterfaces.firstOrNull { it.name == name } ?: continue
            val item = com.hiddify.core.libbox.NetworkInterface()
            item.name = name
            item.index = jni.index
            item.mtu = runCatching { jni.mtu }.getOrDefault(1500)
            item.type = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
                else -> Libbox.InterfaceTypeOther
            }
            item.dnsServer = StringArray(props.dnsServers.mapNotNull { it.hostAddress })
            item.addresses = StringArray(jni.interfaceAddresses.map { it.toPrefix() })
            item.flags = interfaceFlags(jni, caps)
            item.metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            interfaces.add(item)
        }
        return InterfaceArray(interfaces.iterator())
    }

    override fun findConnectionOwner(
        ipProtocol: Int,
        sourceAddress: String,
        sourcePort: Int,
        destinationAddress: String,
        destinationPort: Int
    ): ConnectionOwner {
        // Per-app VPN is enforced by VpnService.Builder include/exclude rules. Returning
        // an empty owner avoids calling ConnectivityManager from libbox Go threads during
        // teardown, which is not needed for current routing and can abort native shutdown.
        return ConnectionOwner().also { it.userId = Process.INVALID_UID }
    }

    override fun readWIFIState(): WIFIState {
        @Suppress("DEPRECATION")
        val info = LumenApplication.instance.container.wifi.connectionInfo
        val ssid = info?.ssid?.trim('"') ?: ""
        val bssid = info?.bssid ?: ""
        return Libbox.newWIFIState(ssid, bssid)
    }

    @OptIn(ExperimentalEncodingApi::class)
    override fun systemCertificates(): StringIterator {
        val certificates = mutableListOf<String>()
        val keyStore = KeyStore.getInstance("AndroidCAStore")
        keyStore.load(null, null)
        val aliases = keyStore.aliases()
        while (aliases.hasMoreElements()) {
            val cert = keyStore.getCertificate(aliases.nextElement())
            certificates += "-----BEGIN CERTIFICATE-----\n${Base64.encode(cert.encoded)}\n-----END CERTIFICATE-----"
        }
        return StringArray(certificates)
    }

    override fun sendNotification(notification: com.hiddify.core.libbox.Notification) = Unit

    override fun getSystemProxyStatus(): SystemProxyStatus =
        SystemProxyStatus().also {
            it.available = false
            it.enabled = false
        }

    override fun serviceReload() {
        VpnState.event("Core requested service reload")
    }

    override fun serviceStop() {
        VpnState.event("Core requested service stop")
        requestStop()
    }

    override fun setSystemProxyEnabled(enabled: Boolean) {
        VpnState.event("Core requested system proxy=${enabled}")
    }

    override fun writeDebugMessage(message: String) {
        VpnState.event(message)
    }

    private fun notification(title: String, text: String): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, LumenApplication.VPN_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Lumen VPN: $title")
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private fun RoutePrefix.toIpPrefix(): android.net.IpPrefix = android.net.IpPrefix(InetAddress.getByName(address()), prefix())

    private fun InterfaceAddress.toPrefix(): String =
        if (address is Inet6Address) "${Inet6Address.getByAddress(address.address).hostAddress}/$networkPrefixLength"
        else "${address.hostAddress}/$networkPrefixLength"

    private fun interfaceFlags(networkInterface: NetworkInterface, caps: NetworkCapabilities): Int {
        var flags = 0
        if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
            flags = flags or OsConstants.IFF_UP or OsConstants.IFF_RUNNING
        }
        if (networkInterface.isLoopback) flags = flags or OsConstants.IFF_LOOPBACK
        if (networkInterface.isPointToPoint) flags = flags or OsConstants.IFF_POINTOPOINT
        if (networkInterface.supportsMulticast()) flags = flags or OsConstants.IFF_MULTICAST
        return flags
    }

    private fun scrubRuntimeFile(file: File) {
        if (!file.exists()) return
        runCatching { file.writeText("{}") }
        runCatching { file.delete() }
    }

    private fun ensureStartCurrent(generation: Long) {
        if (generation != startGeneration.get()) throw CancellationException("VPN start superseded")
    }

    private fun freeLoopbackPort(): Int =
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }

    private fun randomHexSecret(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString(separator = "") { "%02x".format(it) }
    }

    private class InterfaceArray(private val iterator: Iterator<com.hiddify.core.libbox.NetworkInterface>) : NetworkInterfaceIterator {
        override fun hasNext(): Boolean = iterator.hasNext()
        override fun next(): com.hiddify.core.libbox.NetworkInterface = iterator.next()
    }

    private class StringArray(private val values: List<String>) : StringIterator {
        private val iterator = values.iterator()
        override fun hasNext(): Boolean = iterator.hasNext()
        override fun next(): String = iterator.next()
        override fun len(): Int = values.size
    }

    companion object {
        private const val TAG = "LumenVpnService"
        private const val NOTIFICATION_ID = 1001
        private const val AMNEZIAWG_INTERFACE_NAME = "lumenawg"
        private const val TUN_READY_TIMEOUT_MS = 15000L
        private const val OPENVPN_READY_TIMEOUT_MS = 30000L
        private const val OPENVPN_ROUTE_SETTLE_DELAY_MS = 4500L
        private const val OPENVPN_STRICT_PROBE_ROUTE_SETTLE_DELAY_MS = 1800L
        private const val OPENVPN_PROBE_ATTEMPTS = 4
        private const val OPENVPN_PROBE_TIMEOUT_MS = 3500
        private const val OPENVPN_PROBE_RETRY_DELAY_MS = 600L
        private const val XRAY_CONFIG_FILE = "xray-config.json"
        private const val XRAY_EXECUTABLE_NAME = "libxray.so"
        private const val TUN2SOCKS_EXECUTABLE_NAME = "libtun2socks.so"
        private const val XRAY_SOCKET_PATH = "lumen_xray_sock_path"
        private const val XRAY_VPN_MTU = 1500
        private const val XRAY_VPN_ADDRESS = "26.26.26.1"
        private const val XRAY_VPN_PREFIX_LENGTH = 30
        private const val FD_TRANSFER_MAX_RETRIES = 24
        private const val FD_TRANSFER_RETRY_DELAY_MS = 750L
        private const val FD_TRANSFER_MAGIC_BYTE = 32
        private const val XRAY_PROBE_ATTEMPTS = 3
        private const val XRAY_PROBE_TIMEOUT_MS = 3500
        private const val XRAY_PROBE_RETRY_DELAY_MS = 600L
        private const val XRAY_PROBE_STATUS_LINE_LIMIT = 256
        private const val XRAY_TUN_READY_CHECKS = 5
        private const val XRAY_TUN_READY_DELAY_MS = 300L
        private val XRAY_PROBE_URLS = listOf(
            "https://connectivitycheck.gstatic.com/generate_204",
            "https://www.gstatic.com/generate_204",
        )
        private val OPENVPN_PROBE_URLS = listOf(
            "https://connectivitycheck.gstatic.com/generate_204",
            "https://www.gstatic.com/generate_204",
        )
        private val AMNEZIA_INTERFACE_ONLY_KEYS = setOf(
            "jc",
            "jmin",
            "jmax",
            "s1",
            "s2",
            "s3",
            "s4",
            "h1",
            "h2",
            "h3",
            "h4",
            "i1",
            "i2",
            "i3",
            "i4",
            "i5",
            "junkpacketcount",
            "junkpacketminsize",
            "junkpacketmaxsize",
            "initpacketjunksize",
            "responsepacketjunksize",
            "cookiereplypacketjunksize",
            "transportpacketjunksize",
            "initpacketmagicheader",
            "responsepacketmagicheader",
            "underloadpacketmagicheader",
            "transportpacketmagicheader",
            "specialjunk1",
            "specialjunk2",
            "specialjunk3",
            "specialjunk4",
            "specialjunk5",
        )
        private val AMNEZIA_JUNK_COUNT_KEYS = setOf("jc", "jmin", "jmax")
        private val AMNEZIA_POSITIVE_INT_KEYS = setOf(
            "jc",
            "jmin",
            "jmax",
            "s1",
            "s2",
            "s3",
            "s4",
            "junkpacketcount",
            "junkpacketminsize",
            "junkpacketmaxsize",
            "initpacketjunksize",
            "responsepacketjunksize",
            "cookiereplypacketjunksize",
            "transportpacketjunksize",
        )
        private val AMNEZIA_HEADER_KEYS = setOf(
            "h1",
            "h2",
            "h3",
            "h4",
            "i1",
            "i2",
            "i3",
            "i4",
            "i5",
            "initpacketmagicheader",
            "responsepacketmagicheader",
            "underloadpacketmagicheader",
            "transportpacketmagicheader",
            "specialjunk1",
            "specialjunk2",
            "specialjunk3",
            "specialjunk4",
            "specialjunk5",
        )
        private val AMNEZIA_MAGIC_HEADER_KEYS = setOf("h1", "h2", "h3", "h4")
        const val ACTION_START = "tel.lumentech.vpn.START"
        const val ACTION_STOP = "tel.lumentech.vpn.STOP"
        const val ACTION_STRICT_PROBE_STATE = "tel.lumentech.vpn.STRICT_PROBE_STATE"
        const val EXTRA_SERVER_ID = "server_id"
        const val EXTRA_STRICT_PROBE = "strict_probe"
        const val EXTRA_STRICT_PROBE_TOKEN = "strict_probe_token"
        const val EXTRA_STRICT_PROBE_STATUS = "strict_probe_status"
        const val EXTRA_STRICT_PROBE_ERROR = "strict_probe_error"

        fun start(
            context: Context,
            serverId: String,
            strictProbe: Boolean = false,
            strictProbeToken: String = "",
        ) {
            val intent = Intent(context, LumenVpnService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_SERVER_ID, serverId)
                .putExtra(EXTRA_STRICT_PROBE, strictProbe)
                .putExtra(EXTRA_STRICT_PROBE_TOKEN, strictProbeToken)
            ContextCompat.startForegroundService(context, intent)
        }

        fun startStrictProbeInProcess(
            context: Context,
            serverId: String,
            strictProbeToken: String,
            serviceClass: Class<out LumenVpnService>,
        ) {
            val intent = Intent(context, serviceClass)
                .setAction(ACTION_START)
                .putExtra(EXTRA_SERVER_ID, serverId)
                .putExtra(EXTRA_STRICT_PROBE, true)
                .putExtra(EXTRA_STRICT_PROBE_TOKEN, strictProbeToken)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, LumenVpnService::class.java).setAction(ACTION_STOP))
        }

        fun stopStrictProbe(context: Context, strictProbeToken: String) {
            context.startService(
                Intent(context, LumenVpnService::class.java)
                    .setAction(ACTION_STOP)
                    .putExtra(EXTRA_STRICT_PROBE_TOKEN, strictProbeToken)
            )
        }

        fun stopStrictProbeInProcess(
            context: Context,
            strictProbeToken: String,
            serviceClass: Class<out LumenVpnService>,
        ) {
            context.startService(
                Intent(context, serviceClass)
                    .setAction(ACTION_STOP)
                    .putExtra(EXTRA_STRICT_PROBE_TOKEN, strictProbeToken)
            )
        }
    }
}

object VpnState {
    @Volatile var status: VpnStatus = VpnStatus.Stopped
    @Volatile var lastError: String = ""
    @Volatile var strictProbeToken: String = ""
    private val lock = Any()
    private val eventBuffer = ArrayDeque<String>()

    fun event(message: String?) {
        val safe = SecretRedactor.redact(message).ifBlank { return }
        synchronized(lock) {
            eventBuffer.addLast("${System.currentTimeMillis()} $safe")
            while (eventBuffer.size > 80) eventBuffer.removeFirst()
        }
    }

    fun events(): List<String> = synchronized(lock) { eventBuffer.toList() }
}
