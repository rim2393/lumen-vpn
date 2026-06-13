package tel.lumentech.vpn.runtime

import android.content.Context
import android.util.Log
import java.io.BufferedReader
import java.io.File
import java.io.InputStream
import java.io.InputStreamReader
import java.io.InterruptedIOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.VpnStatus
import tel.lumentech.vpn.security.SecretRedactor
import tel.lumentech.vpn.vpn.VpnState

class XrayUrlTester(
    private val context: Context,
    private val configFactory: XrayConfigFactory = XrayConfigFactory(),
) {
    private val lock = Mutex()

    suspend fun testGoogle(
        profile: ServerProfile,
        settings: RuntimeSettings,
        attempts: Int = DEFAULT_ATTEMPTS,
        timeoutMs: Int = DEFAULT_TIMEOUT_MS,
    ): Long? = withContext(Dispatchers.IO) {
        if (attempts <= 0 || timeoutMs <= 0) return@withContext null
        if (RuntimeSupport.backend(profile) != RuntimeBackend.XRAY_CORE) return@withContext null
        if (VpnState.status !in setOf(VpnStatus.Stopped, VpnStatus.Error)) return@withContext null

        lock.withLock {
            testGoogleLocked(profile, settings, attempts, timeoutMs)
        }
    }

    suspend fun testGoogleBatch(
        profiles: List<ServerProfile>,
        settings: RuntimeSettings,
        attempts: Int = 1,
        timeoutMs: Int = DEFAULT_TIMEOUT_MS,
    ): Map<String, Long?> = withContext(Dispatchers.IO) {
        if (profiles.isEmpty()) return@withContext emptyMap()
        val ids = profiles.map { it.id }
        if (attempts <= 0 || timeoutMs <= 0) return@withContext ids.associateWith { null }
        if (profiles.any { RuntimeSupport.backend(it) != RuntimeBackend.XRAY_CORE }) return@withContext ids.associateWith { null }
        if (VpnState.status !in setOf(VpnStatus.Stopped, VpnStatus.Error)) return@withContext ids.associateWith { null }

        lock.withLock {
            testGoogleBatchLocked(profiles, settings, attempts, timeoutMs)
        }
    }

    private fun testGoogleLocked(
        profile: ServerProfile,
        settings: RuntimeSettings,
        attempts: Int,
        timeoutMs: Int,
    ): Long? {
        val workDir = context.cacheDir.resolve("xray-latency").apply { mkdirs() }
        val socksPort = freeLoopbackPort()
        val httpPort = freeLoopbackPort()
        val apiPort = freeLoopbackPort()
        val config = runCatching {
            configFactory.build(
                profile = profile,
                settings = settings,
                localSocksPort = socksPort,
                localHttpPort = httpPort,
                localApiPort = apiPort,
            )
        }.onFailure {
            Log.w(TAG, "xray latency config failed: ${SecretRedactor.redact(it.message)}")
        }.getOrNull() ?: return null
        val configFile = workDir.resolve("config-${System.nanoTime()}.json")
        var process: Process? = null
        return try {
            XrayNativeFiles.prepareAssets(context)
            configFile.writeText(config.fullJsonConfig)
            val executable = XrayNativeFiles.prepareExecutable(context, XRAY_EXECUTABLE_NAME)
            process = ProcessBuilder(executable.absolutePath, "-config", configFile.absolutePath)
                .directory(context.filesDir)
                .redirectErrorStream(true)
                .also { builder ->
                    builder.environment()["XRAY_LOCATION_ASSET"] = context.filesDir.absolutePath
                    builder.environment()["LD_LIBRARY_PATH"] = context.applicationInfo.nativeLibraryDir
                }
                .start()
            drainRuntimeOutput(process)
            waitForLoopbackPort(httpPort, CORE_BOOT_TIMEOUT_MS)

            val targets = URL_TEST_TARGETS.map(::URL)
            var result: Long? = null
            repeat(attempts) { attempt ->
                if (result == null) {
                    val target = targets[attempt % targets.size]
                    result = runCatching { testHttpOverProxy(config.localHttpPort, target, timeoutMs, Proxy.Type.HTTP) }
                        .onFailure { Log.w(TAG, "xray http ping failed: ${it::class.java.simpleName}") }
                        .getOrNull()
                        ?: runCatching { testHttpOverProxy(config.localSocksPort, target, timeoutMs, Proxy.Type.SOCKS) }
                            .onFailure { Log.w(TAG, "xray socks ping failed: ${it::class.java.simpleName}") }
                            .getOrNull()
                }
                if (result == null && attempt < attempts - 1) Thread.sleep(RETRY_DELAY_MS)
            }
            result
        } finally {
            runCatching { process?.destroy() }
            runCatching {
                if (process?.isAlive == true) process.destroyForcibly()
            }
            runCatching { configFile.writeText("{}") }
            runCatching { configFile.delete() }
        }
    }

    private suspend fun testGoogleBatchLocked(
        profiles: List<ServerProfile>,
        settings: RuntimeSettings,
        attempts: Int,
        timeoutMs: Int,
    ): Map<String, Long?> {
        val workDir = context.cacheDir.resolve("xray-latency").apply { mkdirs() }
        val httpPortsByServerId = profiles.associate { it.id to freeLoopbackPort() }
        val socksPortsByServerId = profiles.associate { it.id to freeLoopbackPort() }
        val config = runCatching {
            configFactory.buildLatencyTestBatch(
                profiles = profiles,
                settings = settings,
                httpPortsByServerId = httpPortsByServerId,
                socksPortsByServerId = socksPortsByServerId,
            )
        }.onFailure {
            Log.w(TAG, "xray latency batch config failed: ${SecretRedactor.redact(it.message)}")
        }.getOrNull() ?: return profiles.associate { it.id to null }

        val configFile = workDir.resolve("batch-config-${System.nanoTime()}.json")
        var process: Process? = null
        return try {
            XrayNativeFiles.prepareAssets(context)
            configFile.writeText(config.fullJsonConfig)
            val executable = XrayNativeFiles.prepareExecutable(context, XRAY_EXECUTABLE_NAME)
            process = ProcessBuilder(executable.absolutePath, "-config", configFile.absolutePath)
                .directory(context.filesDir)
                .redirectErrorStream(true)
                .also { builder ->
                    builder.environment()["XRAY_LOCATION_ASSET"] = context.filesDir.absolutePath
                    builder.environment()["LD_LIBRARY_PATH"] = context.applicationInfo.nativeLibraryDir
                }
                .start()
            drainRuntimeOutput(process)
            val firstPort = config.httpPortsByServerId.values.firstOrNull()
            if (firstPort == null || !waitForLoopbackPort(firstPort, CORE_BOOT_TIMEOUT_MS)) {
                return profiles.associate { it.id to null }
            }
            testBatchViaLocalProxies(config, attempts, timeoutMs)
        } finally {
            runCatching { process?.destroy() }
            runCatching {
                if (process?.isAlive == true) process.destroyForcibly()
            }
            runCatching { configFile.writeText("{}") }
            runCatching { configFile.delete() }
        }
    }

    private suspend fun testBatchViaLocalProxies(
        config: XrayLatencyBatchConfig,
        attempts: Int,
        timeoutMs: Int,
    ): Map<String, Long?> = coroutineScope {
        config.httpPortsByServerId.keys.map { serverId ->
            async(Dispatchers.IO) {
                val latency = testThroughLocalPorts(
                    httpPort = config.httpPortsByServerId.getValue(serverId),
                    socksPort = config.socksPortsByServerId.getValue(serverId),
                    attempts = attempts,
                    timeoutMs = timeoutMs,
                )
                serverId to latency
            }
        }.awaitAll().toMap()
    }

    private fun testThroughLocalPorts(httpPort: Int, socksPort: Int, attempts: Int, timeoutMs: Int): Long? {
        val targets = URL_TEST_TARGETS.map(::URL)
        var result: Long? = null
        repeat(attempts) { attempt ->
            if (result == null) {
                val target = targets[attempt % targets.size]
                result = runCatching { testHttpOverProxy(httpPort, target, timeoutMs, Proxy.Type.HTTP) }
                    .onFailure { Log.w(TAG, "xray batch http ping failed: ${it::class.java.simpleName}") }
                    .getOrNull()
                    ?: runCatching { testHttpOverProxy(socksPort, target, timeoutMs, Proxy.Type.SOCKS) }
                        .onFailure { Log.w(TAG, "xray batch socks ping failed: ${it::class.java.simpleName}") }
                        .getOrNull()
            }
            if (result == null && attempt < attempts - 1) Thread.sleep(RETRY_DELAY_MS)
        }
        return result
    }

    private fun freeLoopbackPort(): Int =
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { it.localPort }

    private fun waitForLoopbackPort(port: Int, timeoutMs: Long): Boolean {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            runCatching {
                Socket().use { socket ->
                    socket.connect(InetSocketAddress("127.0.0.1", port), LOOPBACK_CONNECT_TIMEOUT_MS)
                }
            }.onSuccess { return true }
            Thread.sleep(LOOPBACK_POLL_DELAY_MS)
        }
        Log.w(TAG, "xray local proxy port did not open")
        return false
    }

    private fun testHttpOverProxy(port: Int, url: URL, timeoutMs: Int, proxyType: Proxy.Type): Long {
        val client = OkHttpClient.Builder()
            .proxy(Proxy(proxyType, InetSocketAddress("127.0.0.1", port)))
            .connectTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .callTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .build()
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "LumenPing/1.0")
            .get()
            .build()
        val started = System.nanoTime()
        try {
            val status = client.newCall(request).execute().use { it.code }
            require(status in 100..499) { "HTTP probe failed code=$status" }
            return ((System.nanoTime() - started) / 1_000_000).coerceAtLeast(1)
        } finally {
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
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
        while (buffer.length < STATUS_LINE_LIMIT) {
            val value = read()
            if (value < 0 || value == '\n'.code) break
            if (value != '\r'.code) buffer.append(value.toChar())
        }
        return buffer.toString()
    }

    private fun drainRuntimeOutput(process: Process) {
        Thread {
            try {
                BufferedReader(InputStreamReader(process.inputStream)).use { reader ->
                    while (true) {
                        val line = try {
                            reader.readLine()
                        } catch (_: InterruptedIOException) {
                            break
                        } ?: break
                        val safe = SecretRedactor.redact(line)
                        if (safe.contains("error", ignoreCase = true) ||
                            safe.contains("failed", ignoreCase = true) ||
                            safe.contains("panic", ignoreCase = true)
                        ) {
                            Log.w(TAG, safe)
                        }
                    }
                }
            } catch (_: Throwable) {
                Unit
            }
        }.start()
    }

    private companion object {
        const val TAG = "XrayUrlTester"
        const val XRAY_EXECUTABLE_NAME = "libxray.so"
        val URL_TEST_TARGETS = listOf(
            "https://www.gstatic.com/generate_204",
            "https://connectivitycheck.gstatic.com/generate_204",
            "https://redirector.googlevideo.com/generate_204",
            "http://connectivitycheck.gstatic.com/generate_204",
            "http://www.gstatic.com/generate_204",
        )
        const val DEFAULT_ATTEMPTS = 5
        const val DEFAULT_TIMEOUT_MS = 2500
        const val RETRY_DELAY_MS = 350L
        const val CORE_BOOT_TIMEOUT_MS = 2_500L
        const val LOOPBACK_CONNECT_TIMEOUT_MS = 150
        const val LOOPBACK_POLL_DELAY_MS = 100L
        const val STATUS_LINE_LIMIT = 256
    }
}
