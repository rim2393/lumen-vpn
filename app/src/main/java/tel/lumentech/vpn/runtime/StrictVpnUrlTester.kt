package tel.lumentech.vpn.runtime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.VpnService
import android.os.Build
import android.util.Log
import java.io.Closeable
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.VpnStatus
import tel.lumentech.vpn.vpn.LumenVpnAwgProbeService
import tel.lumentech.vpn.vpn.LumenVpnBoxProbeService
import tel.lumentech.vpn.vpn.LumenVpnService
import tel.lumentech.vpn.vpn.LumenVpnOpenVpnProbeService
import tel.lumentech.vpn.vpn.VpnState

class StrictVpnUrlTester(private val context: Context) {
    private val lock = Mutex()

    suspend fun testGoogle(
        profile: ServerProfile,
        attempts: Int = DEFAULT_ATTEMPTS,
        timeoutMs: Long = DEFAULT_TIMEOUT_MS,
        startTimeoutMs: Long = START_TIMEOUT_MS,
        stopTimeoutMs: Long = STOP_TIMEOUT_MS,
        routeSettleDelayMs: Long = ROUTE_SETTLE_DELAY_MS,
    ): Long? =
        withContext(Dispatchers.IO) {
            if (!profile.supportsStrictProbe()) return@withContext null
            if (VpnService.prepare(context) != null) return@withContext null
            lock.withLock {
                if (VpnState.status !in setOf(VpnStatus.Stopped, VpnStatus.Error)) return@withLock null
                val token = UUID.randomUUID().toString()
                val probeService = profile.probeServiceClass()
                val useProbeProcess = probeService != null
                val probeState = if (useProbeProcess) StrictProbeStateMonitor(context, token).also { it.register() } else null
                try {
                    if (probeService != null) {
                        LumenVpnService.startStrictProbeInProcess(context, profile.id, token, probeService)
                        if (probeState?.awaitStatus(VpnStatus.Running, startTimeoutMs) != true) {
                            return@withLock null
                        }
                    } else {
                        LumenVpnService.start(context, profile.id, strictProbe = true, strictProbeToken = token)
                        if (!awaitStatus(VpnStatus.Running, startTimeoutMs)) return@withLock null
                    }
                    delay(routeSettleDelayMs)
                    val samples = buildList {
                        repeat(attempts.coerceAtLeast(1)) {
                            testGoogleOnce(timeoutMs)?.let { add(it) }
                            if (it < attempts - 1) delay(URL_TEST_RETRY_DELAY_MS)
                        }
                    }
                    samples.minOrNull()
                } finally {
                    if (probeService != null) {
                        LumenVpnService.stopStrictProbeInProcess(context, token, probeService)
                        val stopped = probeState?.awaitStatus(VpnStatus.Stopped, stopTimeoutMs) == true
                        if (!stopped) {
                            Log.w(TAG, "strict probe stop timeout for ${probeService.simpleName}")
                            context.stopService(Intent(context, probeService))
                        }
                        probeState?.close()
                    } else if (VpnState.strictProbeToken == token) {
                        LumenVpnService.stopStrictProbe(context, token)
                        awaitStatus(VpnStatus.Stopped, stopTimeoutMs)
                    }
                }
            }
        }

    private suspend fun awaitStatus(target: VpnStatus, timeoutMs: Long): Boolean {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            when {
                VpnState.status == target -> return true
                target == VpnStatus.Running && VpnState.status == VpnStatus.Error -> return false
            }
            delay(STATUS_POLL_MS)
        }
        return VpnState.status == target
    }

    private fun testGoogleOnce(timeoutMs: Long): Long? {
        val client = OkHttpClient.Builder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .followRedirects(false)
            .build()
        return try {
            URL_TEST_TARGETS.firstNotNullOfOrNull { target ->
                val started = System.nanoTime()
                runCatching {
                    val request = Request.Builder()
                        .url(target)
                        .cacheControl(CacheControl.FORCE_NETWORK)
                        .header("User-Agent", "LumenStrictPing/1.0")
                        .get()
                        .build()
                    client.newCall(request).execute().use { response ->
                        if (response.code in 100..499) {
                            ((System.nanoTime() - started) / 1_000_000).coerceAtLeast(1)
                        } else {
                            null
                        }
                    }
                }.onFailure { error ->
                    Log.w(TAG, "strict ping ${target.host} failed: ${error::class.java.simpleName}")
                }.getOrNull()
            }
        } finally {
            client.connectionPool.evictAll()
            client.dispatcher.executorService.shutdown()
        }
    }

    private fun ServerProfile.supportsStrictProbe(): Boolean =
        RuntimeSupport.isConnectable(this)

    private fun ServerProfile.probeServiceClass(): Class<out LumenVpnService>? =
        when (RuntimeSupport.backend(this)) {
            RuntimeBackend.AMNEZIAWG -> LumenVpnAwgProbeService::class.java
            RuntimeBackend.OPENVPN_CLOAK,
            RuntimeBackend.OPENVPN_SHADOWSOCKS -> LumenVpnOpenVpnProbeService::class.java
            RuntimeBackend.SING_BOX -> LumenVpnBoxProbeService::class.java
            else -> null
        }

    private class StrictProbeStateMonitor(
        context: Context,
        private val token: String,
    ) : Closeable {
        private val appContext = context.applicationContext
        private val statuses = Channel<VpnStatus>(Channel.UNLIMITED)
        private val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != LumenVpnService.ACTION_STRICT_PROBE_STATE) return
                if (intent.getStringExtra(LumenVpnService.EXTRA_STRICT_PROBE_TOKEN) != token) return
                val status = intent.getStringExtra(LumenVpnService.EXTRA_STRICT_PROBE_STATUS)
                    ?.let { runCatching { VpnStatus.valueOf(it) }.getOrNull() }
                    ?: return
                statuses.trySend(status)
            }
        }

        fun register() {
            val filter = IntentFilter(LumenVpnService.ACTION_STRICT_PROBE_STATE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                @Suppress("DEPRECATION")
                appContext.registerReceiver(receiver, filter)
            }
        }

        suspend fun awaitStatus(target: VpnStatus, timeoutMs: Long): Boolean =
            withTimeoutOrNull(timeoutMs) {
                var matched = false
                while (!matched) {
                    val status = statuses.receiveCatching().getOrNull() ?: return@withTimeoutOrNull false
                    when {
                        status == target -> matched = true
                        target == VpnStatus.Running && status == VpnStatus.Error -> return@withTimeoutOrNull false
                    }
                }
                matched
            } ?: false

        override fun close() {
            runCatching { appContext.unregisterReceiver(receiver) }
            statuses.close()
        }
    }

    private companion object {
        private const val DEFAULT_ATTEMPTS = 3
        private const val DEFAULT_TIMEOUT_MS = 2_500L
        private const val START_TIMEOUT_MS = 32_000L
        private const val STOP_TIMEOUT_MS = 8_000L
        private const val ROUTE_SETTLE_DELAY_MS = 750L
        private const val URL_TEST_RETRY_DELAY_MS = 250L
        private const val STATUS_POLL_MS = 150L
        private const val TAG = "StrictVpnUrlTester"
        private val URL_TEST_TARGETS = listOf(
            URL("https://www.gstatic.com/generate_204"),
            URL("https://connectivitycheck.gstatic.com/generate_204"),
        )
    }
}
