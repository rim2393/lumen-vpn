package tel.lumentech.vpn.runtime

import android.content.Context
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Process
import android.system.OsConstants
import android.util.Base64
import android.util.Log
import com.hiddify.core.libbox.CommandServer
import com.hiddify.core.libbox.CommandServerHandler
import com.hiddify.core.libbox.CommandClientHandler
import com.hiddify.core.libbox.CommandClientOptions
import com.hiddify.core.libbox.ConnectionOwner
import com.hiddify.core.libbox.ConnectionEvents
import com.hiddify.core.libbox.InterfaceUpdateListener
import com.hiddify.core.libbox.Libbox
import com.hiddify.core.libbox.LocalDNSTransport
import com.hiddify.core.libbox.LogIterator
import com.hiddify.core.libbox.NetworkInterfaceIterator
import com.hiddify.core.libbox.OverrideOptions
import com.hiddify.core.libbox.OutboundGroupIterator
import com.hiddify.core.libbox.PlatformInterface
import com.hiddify.core.libbox.StatusMessage
import com.hiddify.core.libbox.StringIterator
import com.hiddify.core.libbox.SystemProxyStatus
import com.hiddify.core.libbox.TunOptions
import com.hiddify.core.libbox.WIFIState
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.InterfaceAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.URL
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tel.lumentech.vpn.LumenApplication
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.VpnStatus
import tel.lumentech.vpn.security.SecretRedactor
import tel.lumentech.vpn.vpn.AndroidLocalDnsTransport
import tel.lumentech.vpn.vpn.VpnState
import com.hiddify.core.libbox.NetworkInterface as BoxNetworkInterface
import java.net.NetworkInterface as JavaNetworkInterface

class NodeUrlTester(
    private val context: Context,
    private val configFactory: SingBoxConfigFactory = SingBoxConfigFactory(),
) {
    private val lock = Mutex()
    private var commandServer: CommandServer? = null
    private var setupComplete = false
    private val commandPort: Int by lazy { freeLoopbackPort() }
    private val commandSecret: String by lazy { randomHexSecret() }

    suspend fun testGoogle(
        profile: ServerProfile,
        settings: RuntimeSettings,
        attempts: Int = DEFAULT_ATTEMPTS,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    ): Long? = withContext(Dispatchers.IO) {
        if (attempts <= 0 || timeoutMs <= 0) return@withContext null
        if (!profile.supportsTemporaryUrlTest()) return@withContext null
        if (VpnState.status !in setOf(VpnStatus.Stopped, VpnStatus.Error)) return@withContext null
        lock.withLock {
            val proxyPort = freeLoopbackPort()
            val platform = LatencyPlatform(context.applicationContext)
            var serviceStarted = false
            try {
                runCatching {
                    val config = configFactory.buildLatencyTestProxy(profile, settings, proxyPort)
                    if (VpnState.status !in setOf(VpnStatus.Stopped, VpnStatus.Error)) return@runCatching null
                    ensureLibbox(platform)
                    Libbox.checkConfig(config)
                    val server = commandServer ?: return@runCatching null
                    server.startOrReloadService(
                        config,
                        OverrideOptions().also {
                            it.autoRedirect = false
                            it.includePackage = StringArray(emptyList())
                            it.excludePackage = StringArray(emptyList())
                        }
                    )
                    serviceStarted = true
                    var result: Long? = nativeUrlTest(timeoutMs)
                    repeat(attempts) { attempt ->
                        if (result == null) result = testOnce(proxyPort, URL_TEST_TARGETS[attempt % URL_TEST_TARGETS.size], timeoutMs)
                        if (result == null && attempt < attempts - 1) Thread.sleep(RETRY_DELAY_MS)
                    }
                    result
                }.getOrNull()
            } finally {
                if (serviceStarted) {
                    runCatching { commandServer?.closeService() }
                }
            }
        }
    }

    suspend fun testGoogleBatch(
        profiles: List<ServerProfile>,
        settings: RuntimeSettings,
        timeoutMs: Long,
    ): Map<String, Long?> = withContext(Dispatchers.IO) {
        if (profiles.isEmpty()) return@withContext emptyMap()
        val ids = profiles.map { it.id }
        if (timeoutMs <= 0) return@withContext ids.associateWith { null }
        if (profiles.any { !it.supportsTemporaryUrlTest() }) return@withContext ids.associateWith { null }
        if (VpnState.status !in setOf(VpnStatus.Stopped, VpnStatus.Error)) return@withContext ids.associateWith { null }
        lock.withLock {
            val listenPortsByServerId = profiles.associate { it.id to freeLoopbackPort() }
            val platform = LatencyPlatform(context.applicationContext)
            var serviceStarted = false
            try {
                val batch = configFactory.buildLatencyTestBatch(profiles, settings, listenPortsByServerId)
                if (VpnState.status !in setOf(VpnStatus.Stopped, VpnStatus.Error)) return@withLock ids.associateWith { null }
                ensureLibbox(platform)
                Libbox.checkConfig(batch.config)
                val server = commandServer ?: return@withLock ids.associateWith { null }
                server.startOrReloadService(
                    batch.config,
                    OverrideOptions().also {
                        it.autoRedirect = false
                        it.includePackage = StringArray(emptyList())
                        it.excludePackage = StringArray(emptyList())
                    }
                )
                serviceStarted = true
                testBatchViaLocalProxies(batch.listenPortsByServerId, timeoutMs)
            } catch (error: Throwable) {
                Log.w(TAG, "latency batch failed: ${SecretRedactor.redact(error.message)}")
                ids.associateWith { null }
            } finally {
                if (serviceStarted) {
                    runCatching { commandServer?.closeService() }
                }
            }
        }
    }

    private suspend fun testBatchViaLocalProxies(
        listenPortsByServerId: Map<String, Int>,
        timeoutMs: Long,
    ): Map<String, Long?> = coroutineScope {
        listenPortsByServerId.map { (serverId, port) ->
            async(Dispatchers.IO) {
                val latency = URL_TEST_TARGETS.firstNotNullOfOrNull { target ->
                    testOnce(port, target, timeoutMs)
                }
                serverId to latency
            }
        }.awaitAll().toMap()
    }

    private fun nativeUrlTest(timeoutMs: Long): Long? {
        val handler = LatencyCommandClientHandler()
        val client = Libbox.newCommandClient(
            handler,
            CommandClientOptions().also {
                it.addCommand(Libbox.CommandGroup)
                it.statusInterval = 1_000_000_000L
            }
        )
        return try {
            var connected = false
            repeat(COMMAND_CLIENT_CONNECT_ATTEMPTS) { attempt ->
                if (!connected) {
                    runCatching {
                        if (attempt > 0) Thread.sleep(COMMAND_CLIENT_RETRY_DELAY_MS)
                        client.connect()
                        connected = true
                    }
                }
            }
            if (!connected) return null
            runCatching { client.urlTest(LATENCY_URL_TEST_TAG) }.getOrElse { return null }
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
            while (System.nanoTime() < deadline) {
                val delay = handler.delay.get()
                if (delay in 1 until URL_TEST_TIMEOUT_DELAY) return delay.toLong()
                Thread.sleep(URL_TEST_POLL_DELAY_MS)
            }
            null
        } catch (_: Throwable) {
            null
        } finally {
            runCatching { client.disconnect() }
        }
    }

    private fun nativeUrlTestBatch(tagsByServerId: Map<String, String>, timeoutMs: Long): Map<String, Long?> {
        val handler = LatencyCommandClientHandler(tagsByServerId.values.toSet())
        val client = Libbox.newCommandClient(
            handler,
            CommandClientOptions().also {
                it.addCommand(Libbox.CommandGroup)
                it.statusInterval = 1_000_000_000L
            }
        )
        return try {
            var connected = false
            repeat(COMMAND_CLIENT_CONNECT_ATTEMPTS) { attempt ->
                if (!connected) {
                    runCatching {
                        if (attempt > 0) Thread.sleep(COMMAND_CLIENT_RETRY_DELAY_MS)
                        client.connect()
                        connected = true
                    }
                }
            }
            if (!connected) return tagsByServerId.keys.associateWith { null }
            runCatching { client.urlTest(LATENCY_URL_TEST_TAG) }.getOrElse {
                Log.w(TAG, "latency batch urltest failed: ${SecretRedactor.redact(it.message)}")
                return tagsByServerId.keys.associateWith { null }
            }
            val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
            while (System.nanoTime() < deadline) {
                if (tagsByServerId.values.all { handler.delayFor(it) != null }) break
                Thread.sleep(URL_TEST_POLL_DELAY_MS)
            }
            tagsByServerId.mapValues { (_, tag) -> handler.delayFor(tag)?.toLong() }
        } catch (error: Throwable) {
            Log.w(TAG, "latency batch poll failed: ${SecretRedactor.redact(error.message)}")
            tagsByServerId.keys.associateWith { null }
        } finally {
            runCatching { client.disconnect() }
        }
    }

    private fun ensureLibbox(platform: LatencyPlatform) {
        if (!setupComplete) {
            Libbox.setup(
                com.hiddify.core.libbox.SetupOptions().also {
                    it.basePath = context.filesDir.resolve("latency-core").apply { mkdirs() }.absolutePath
                    it.workingPath = context.noBackupFilesDir.resolve("latency-core-work").apply { mkdirs() }.absolutePath
                    it.tempPath = context.cacheDir.resolve("latency-core").apply { mkdirs() }.absolutePath
                    it.commandServerListenPort = commandPort
                    it.commandServerSecret = commandSecret
                    it.logMaxLines = 40L
                    it.debug = false
                    it.fixAndroidStack = true
                }
            )
            setupComplete = true
        }
        if (commandServer == null) {
            commandServer = Libbox.newCommandServer(platform, platform).also { it.start() }
        }
    }

    private fun testOnce(proxyPort: Int, target: URL, timeoutMs: Long): Long? {
        val client = OkHttpClient.Builder()
            .proxy(Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", proxyPort)))
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .build()
        val start = System.nanoTime()
        return try {
            val request = Request.Builder()
                .url(target)
                .header("User-Agent", "LumenPing/1.0")
                .get()
                .build()
            client.newCall(request).execute().use { response ->
                if (response.code in 100..499) {
                    ((System.nanoTime() - start) / 1_000_000).coerceAtLeast(1)
                } else {
                    null
                }
            }
        } catch (_: Throwable) {
            null
        } finally {
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
        }
    }

    private fun freeLoopbackPort(): Int =
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }

    private fun randomHexSecret(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString(separator = "") { "%02x".format(it) }
    }

    private fun ServerProfile.supportsTemporaryUrlTest(): Boolean = protocol in setOf(
        ProtocolType.VLESS,
        ProtocolType.VMESS,
        ProtocolType.TROJAN,
        ProtocolType.SHADOWSOCKS,
        ProtocolType.SOCKS,
        ProtocolType.HYSTERIA,
        ProtocolType.HYSTERIA2,
        ProtocolType.TUIC,
        ProtocolType.NAIVE,
        ProtocolType.WIREGUARD,
        ProtocolType.XRAY,
        ProtocolType.SING_BOX,
    )

    private class LatencyPlatform(private val context: Context) : PlatformInterface, CommandServerHandler {
        override fun openTun(options: TunOptions): Int =
            error("Latency URL-test does not open a TUN interface")

        override fun usePlatformAutoDetectInterfaceControl(): Boolean = false
        override fun autoDetectInterfaceControl(fd: Int) = Unit
        override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
        override fun underNetworkExtension(): Boolean = false
        override fun includeAllNetworks(): Boolean = false
        override fun clearDNSCache() = Unit
        override fun localDNSTransport(): LocalDNSTransport? = AndroidLocalDnsTransport
        override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) = Unit
        override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) = Unit

        override fun getInterfaces(): NetworkInterfaceIterator {
            val container = LumenApplication.instance.container
            val javaInterfaces = JavaNetworkInterface.getNetworkInterfaces().toList()
            val interfaces = mutableListOf<BoxNetworkInterface>()
            for (network in container.connectivity.allNetworks) {
                val props = container.connectivity.getLinkProperties(network) ?: continue
                val caps = container.connectivity.getNetworkCapabilities(network) ?: continue
                val name = props.interfaceName ?: continue
                val jni = javaInterfaces.firstOrNull { it.name == name } ?: continue
                val item = BoxNetworkInterface()
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
            destinationPort: Int,
        ): ConnectionOwner =
            ConnectionOwner().also { it.userId = Process.INVALID_UID }

        override fun readWIFIState(): WIFIState {
            @Suppress("DEPRECATION")
            val info = LumenApplication.instance.container.wifi.connectionInfo
            val ssid = info?.ssid?.trim('"') ?: ""
            val bssid = info?.bssid ?: ""
            return Libbox.newWIFIState(ssid, bssid)
        }

        override fun systemCertificates(): StringIterator {
            val certificates = mutableListOf<String>()
            val keyStore = KeyStore.getInstance("AndroidCAStore")
            keyStore.load(null, null)
            val aliases = keyStore.aliases()
            while (aliases.hasMoreElements()) {
                val cert = keyStore.getCertificate(aliases.nextElement())
                certificates += "-----BEGIN CERTIFICATE-----\n" +
                    Base64.encodeToString(cert.encoded, Base64.NO_WRAP) +
                    "\n-----END CERTIFICATE-----"
            }
            return StringArray(certificates)
        }

        override fun sendNotification(notification: com.hiddify.core.libbox.Notification) = Unit

        override fun getSystemProxyStatus(): SystemProxyStatus =
            SystemProxyStatus().also {
                it.available = false
                it.enabled = false
            }

        override fun serviceReload() = Unit
        override fun serviceStop() = Unit
        override fun setSystemProxyEnabled(enabled: Boolean) = Unit
        override fun writeDebugMessage(message: String) = Unit

        private fun InterfaceAddress.toPrefix(): String =
            if (address is Inet6Address) "${Inet6Address.getByAddress(address.address).hostAddress}/$networkPrefixLength"
            else "${address.hostAddress}/$networkPrefixLength"

        private fun interfaceFlags(networkInterface: JavaNetworkInterface, caps: NetworkCapabilities): Int {
            var flags = 0
            if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                flags = flags or OsConstants.IFF_UP or OsConstants.IFF_RUNNING
            }
            if (networkInterface.isLoopback) flags = flags or OsConstants.IFF_LOOPBACK
            if (networkInterface.isPointToPoint) flags = flags or OsConstants.IFF_POINTOPOINT
            if (networkInterface.supportsMulticast()) flags = flags or OsConstants.IFF_MULTICAST
            return flags
        }
    }

    private class InterfaceArray(private val iterator: Iterator<BoxNetworkInterface>) : NetworkInterfaceIterator {
        override fun hasNext(): Boolean = iterator.hasNext()
        override fun next(): BoxNetworkInterface = iterator.next()
    }

    private class LatencyCommandClientHandler(
        private val targetTags: Set<String> = setOf("proxy"),
    ) : CommandClientHandler {
        val delay = AtomicInteger(0)
        private val delaysByTag = ConcurrentHashMap<String, Int>()

        override fun writeGroups(message: OutboundGroupIterator) {
            while (message.hasNext()) {
                val group = message.next()
                if (group.tag != LATENCY_URL_TEST_TAG) continue
                val items = group.items
                while (items.hasNext()) {
                    val item = items.next()
                    if (item.tag == "proxy") delay.set(item.urlTestDelay)
                    if (item.tag in targetTags && item.urlTestDelay in 1 until URL_TEST_TIMEOUT_DELAY) {
                        delaysByTag[item.tag] = item.urlTestDelay
                    }
                }
            }
        }

        fun delayFor(tag: String): Int? = delaysByTag[tag]

        override fun clearLogs() = Unit
        override fun connected() = Unit
        override fun disconnected(message: String) = Unit
        override fun initializeClashMode(modeList: StringIterator, currentMode: String) = Unit
        override fun setDefaultLogLevel(level: Int) = Unit
        override fun updateClashMode(newMode: String) = Unit
        override fun writeConnectionEvents(message: ConnectionEvents) = Unit
        override fun writeLogs(messageList: LogIterator) = Unit
        override fun writeStatus(message: StatusMessage) = Unit
    }

    private class StringArray(private val values: List<String>) : StringIterator {
        private val iterator = values.iterator()
        override fun hasNext(): Boolean = iterator.hasNext()
        override fun next(): String = iterator.next()
        override fun len(): Int = values.size
    }

    private companion object {
        private const val TAG = "NodeUrlTester"
        private const val DEFAULT_ATTEMPTS = 5
        private const val DEFAULT_TIMEOUT_MS = 2_500L
        private const val RETRY_DELAY_MS = 350L
        private const val LATENCY_URL_TEST_TAG = "latency-urltest"
        private const val COMMAND_CLIENT_CONNECT_ATTEMPTS = 8
        private const val COMMAND_CLIENT_RETRY_DELAY_MS = 120L
        private const val URL_TEST_POLL_DELAY_MS = 100L
        private const val URL_TEST_TIMEOUT_DELAY = 65_000
        private val URL_TEST_TARGETS = listOf(
            URL("https://www.gstatic.com/generate_204"),
            URL("https://redirector.googlevideo.com/generate_204"),
            URL("http://connectivitycheck.gstatic.com/generate_204"),
            URL("http://www.gstatic.com/generate_204"),
        )
    }
}
