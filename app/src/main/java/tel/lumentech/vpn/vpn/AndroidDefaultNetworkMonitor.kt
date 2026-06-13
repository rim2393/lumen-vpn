package tel.lumentech.vpn.vpn

import android.annotation.TargetApi
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.hiddify.core.libbox.InterfaceUpdateListener
import java.net.NetworkInterface
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.ObsoleteCoroutinesApi
import kotlinx.coroutines.channels.SendChannel
import kotlinx.coroutines.channels.actor
import kotlinx.coroutines.runBlocking
import tel.lumentech.vpn.LumenApplication

object AndroidDefaultNetworkMonitor {
    private sealed class Message {
        data class Start(val key: Any, val listener: (Network?) -> Unit) : Message()
        data class Stop(val key: Any) : Message()
        data class Put(val network: Network) : Message()
        data class Update(val network: Network) : Message()
        data class Lost(val network: Network) : Message()
        data object StopAll : Message()

        class Get : Message() {
            val response = CompletableDeferred<Network>()
        }
    }

    @OptIn(DelicateCoroutinesApi::class, ObsoleteCoroutinesApi::class)
    private val actor: SendChannel<Message> = GlobalScope.actor<Message>(Dispatchers.Unconfined) {
        val listeners = mutableMapOf<Any, (Network?) -> Unit>()
        var network: Network? = null
        var registered = false
        val pending = mutableListOf<Message.Get>()

        suspend fun registerIfNeeded() {
            if (registered) return
            registered = register()
        }

        fun unregisterIfNeeded() {
            if (!registered) return
            runCatching { LumenApplication.instance.container.connectivity.unregisterNetworkCallback(callback) }
            registered = false
        }

        for (message in channel) {
            when (message) {
                is Message.Start -> {
                    registerIfNeeded()
                    listeners[message.key] = message.listener
                    val active = network ?: currentNetworkOrNull()
                    if (active != null) {
                        network = active
                        message.listener(active)
                    }
                }
                is Message.Get -> {
                    val active = network ?: currentNetworkOrNull()
                    if (active != null) {
                        network = active
                        message.response.complete(active)
                    } else {
                        pending += message
                    }
                }
                is Message.Stop -> {
                    listeners.remove(message.key)
                    if (listeners.isEmpty()) {
                        network = null
                        pending.forEach { it.response.completeExceptionally(IllegalStateException("missing default network")) }
                        pending.clear()
                        unregisterIfNeeded()
                    }
                }
                is Message.StopAll -> {
                    listeners.values.forEach { it(null) }
                    listeners.clear()
                    network = null
                    pending.forEach { it.response.completeExceptionally(IllegalStateException("missing default network")) }
                    pending.clear()
                    unregisterIfNeeded()
                }
                is Message.Put -> {
                    network = message.network
                    pending.forEach { it.response.complete(message.network) }
                    pending.clear()
                    listeners.values.forEach { it(message.network) }
                }
                is Message.Update -> {
                    if (network == message.network) listeners.values.forEach { it(message.network) }
                }
                is Message.Lost -> {
                    if (network == message.network) {
                        network = null
                        listeners.values.forEach { it(null) }
                    }
                }
            }
        }
    }

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = runBlocking { actor.send(Message.Put(network)) }
        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) =
            runBlocking { actor.send(Message.Update(network)) }

        override fun onLost(network: Network) = runBlocking { actor.send(Message.Lost(network)) }
    }

    private val request = NetworkRequest.Builder()
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_RESTRICTED)
        .build()

    private val handler = Handler(Looper.getMainLooper())

    suspend fun start(listener: InterfaceUpdateListener) {
        actor.send(Message.Start(listener) { network -> updateListener(listener, network) })
    }

    suspend fun stop(listener: InterfaceUpdateListener) {
        actor.send(Message.Stop(listener))
    }

    suspend fun stopAll() {
        actor.send(Message.StopAll)
    }

    suspend fun require(): Network {
        currentNetworkOrNull()?.let { return it }
        return Message.Get().run {
            actor.send(this)
            response.await()
        }
    }

    private fun updateListener(listener: InterfaceUpdateListener, network: Network?) {
        if (network == null) {
            listener.updateDefaultInterface("", -1, false, false)
            return
        }
        val connectivity = LumenApplication.instance.container.connectivity
        val interfaceName = connectivity.getLinkProperties(network)?.interfaceName
        if (interfaceName.isNullOrBlank()) {
            listener.updateDefaultInterface("", -1, false, false)
            return
        }
        val index = runCatching { NetworkInterface.getByName(interfaceName).index }.getOrDefault(-1)
        listener.updateDefaultInterface(interfaceName, index, false, false)
    }

    private fun currentNetworkOrNull(): Network? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            LumenApplication.instance.container.connectivity.activeNetwork
        } else {
            null
        }

    private fun register(): Boolean {
        val connectivity = LumenApplication.instance.container.connectivity
        return runCatching {
            when (Build.VERSION.SDK_INT) {
                in 31..Int.MAX_VALUE -> registerBestMatch(connectivity)
                in 28 until 31 -> registerRequest(connectivity)
                in 26 until 28 -> registerDefaultWithHandler(connectivity)
                in 24 until 26 -> registerDefault(connectivity)
                else -> connectivity.requestNetwork(request, callback)
            }
        }.recoverCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                connectivity.registerDefaultNetworkCallback(callback)
            } else {
                connectivity.requestNetwork(request, callback)
            }
        }.isSuccess
    }

    @TargetApi(31)
    private fun registerBestMatch(connectivity: ConnectivityManager) {
        connectivity.registerBestMatchingNetworkCallback(request, callback, handler)
    }

    @TargetApi(28)
    private fun registerRequest(connectivity: ConnectivityManager) {
        connectivity.requestNetwork(request, callback, handler)
    }

    @TargetApi(26)
    private fun registerDefaultWithHandler(connectivity: ConnectivityManager) {
        connectivity.registerDefaultNetworkCallback(callback, handler)
    }

    @TargetApi(24)
    private fun registerDefault(connectivity: ConnectivityManager) {
        connectivity.registerDefaultNetworkCallback(callback)
    }
}
