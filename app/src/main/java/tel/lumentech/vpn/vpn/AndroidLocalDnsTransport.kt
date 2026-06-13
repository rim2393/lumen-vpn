package tel.lumentech.vpn.vpn

import android.net.DnsResolver
import android.os.Build
import android.os.CancellationSignal
import android.system.ErrnoException
import androidx.annotation.RequiresApi
import com.hiddify.core.libbox.ExchangeContext
import com.hiddify.core.libbox.LocalDNSTransport
import java.net.InetAddress
import java.net.UnknownHostException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asExecutor
import kotlinx.coroutines.runBlocking

object AndroidLocalDnsTransport : LocalDNSTransport {
    private const val RCODE_NXDOMAIN = 3

    override fun raw(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    @RequiresApi(Build.VERSION_CODES.Q)
    override fun exchange(ctx: ExchangeContext, message: ByteArray) {
        runBlocking {
            val defaultNetwork = AndroidDefaultNetworkMonitor.require()
            suspendCoroutine { continuation ->
                val signal = CancellationSignal()
                ctx.onCancel(signal::cancel)
                val callback = object : DnsResolver.Callback<ByteArray> {
                    override fun onAnswer(answer: ByteArray, rcode: Int) {
                        if (rcode == 0) {
                            ctx.rawSuccess(answer)
                        } else {
                            ctx.errorCode(rcode)
                        }
                        continuation.resume(Unit)
                    }

                    override fun onError(error: DnsResolver.DnsException) {
                        when (val cause = error.cause) {
                            is ErrnoException -> {
                                ctx.errnoCode(cause.errno)
                                continuation.resume(Unit)
                                return
                            }
                        }
                        continuation.resumeWithException(error)
                    }
                }
                DnsResolver.getInstance().rawQuery(
                    defaultNetwork,
                    message,
                    DnsResolver.FLAG_NO_RETRY,
                    Dispatchers.IO.asExecutor(),
                    signal,
                    callback,
                )
            }
        }
    }

    override fun lookup(ctx: ExchangeContext, network: String, domain: String) {
        runBlocking {
            val defaultNetwork = AndroidDefaultNetworkMonitor.require()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                suspendCoroutine { continuation ->
                    val signal = CancellationSignal()
                    ctx.onCancel(signal::cancel)
                    val callback = object : DnsResolver.Callback<Collection<InetAddress>> {
                        override fun onAnswer(answer: Collection<InetAddress>, rcode: Int) {
                            if (rcode == 0) {
                                ctx.success(answer.mapNotNull { it.hostAddress }.joinToString("\n"))
                            } else {
                                ctx.errorCode(rcode)
                            }
                            continuation.resume(Unit)
                        }

                        override fun onError(error: DnsResolver.DnsException) {
                            when (val cause = error.cause) {
                                is ErrnoException -> {
                                    ctx.errnoCode(cause.errno)
                                    continuation.resume(Unit)
                                    return
                                }
                            }
                            continuation.resumeWithException(error)
                        }
                    }
                    val queryType = when {
                        network.endsWith("4") -> DnsResolver.TYPE_A
                        network.endsWith("6") -> DnsResolver.TYPE_AAAA
                        else -> null
                    }
                    if (queryType != null) {
                        DnsResolver.getInstance().query(
                            defaultNetwork,
                            domain,
                            queryType,
                            DnsResolver.FLAG_NO_RETRY,
                            Dispatchers.IO.asExecutor(),
                            signal,
                            callback,
                        )
                    } else {
                        DnsResolver.getInstance().query(
                            defaultNetwork,
                            domain,
                            DnsResolver.FLAG_NO_RETRY,
                            Dispatchers.IO.asExecutor(),
                            signal,
                            callback,
                        )
                    }
                }
            } else {
                val answer = try {
                    defaultNetwork.getAllByName(domain)
                } catch (_: UnknownHostException) {
                    ctx.errorCode(RCODE_NXDOMAIN)
                    return@runBlocking
                }
                ctx.success(answer.mapNotNull { it.hostAddress }.joinToString("\n"))
            }
        }
    }
}
