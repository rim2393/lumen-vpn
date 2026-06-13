package org.amnezia.vpn.protocol.openvpn

import android.net.VpnService.Builder
import android.util.Log as AndroidLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import net.openvpn.ovpn3.ClientAPI_Config
import net.openvpn.ovpn3.ClientAPI_ProvideCreds
import org.amnezia.vpn.protocol.BadConfigException
import org.amnezia.vpn.protocol.Protocol
import org.amnezia.vpn.protocol.ProtocolState.DISCONNECTED
import org.amnezia.vpn.protocol.Statistics
import org.amnezia.vpn.protocol.VpnStartException
import org.amnezia.vpn.util.LibraryLoader.loadSharedLibrary
import org.amnezia.vpn.util.net.InetNetwork
import org.amnezia.vpn.util.net.getLocalNetworks
import org.amnezia.vpn.util.net.parseInetAddress
import org.json.JSONObject
import java.net.InetAddress

open class OpenVpn : Protocol() {

    private var openVpnClient: OpenVpnClient? = null
    private lateinit var scope: CoroutineScope

    override val statistics: Statistics
        get() {
            openVpnClient?.let { client ->
                val stats = client.transport_stats()
                return Statistics.build {
                    setRxBytes(stats.bytesIn)
                    setTxBytes(stats.bytesOut)
                }
            }
            return Statistics.EMPTY_STATISTICS
        }

    override fun internalInit() {
        if (!isInitialized) {
            loadSharedLibrary(context, "ovpn3")
            loadSharedLibrary(context, "ovpnutil")
        }
        if (this::scope.isInitialized) {
            scope.cancel()
        }
        scope = CoroutineScope(Dispatchers.IO)
    }

    override suspend fun startVpn(config: JSONObject, vpnBuilder: Builder, protect: (Int) -> Boolean) {
        val configBuilder = OpenVpnConfig.Builder()

        openVpnClient = OpenVpnClient(
            configBuilder = configBuilder,
            state = state,
            getLocalNetworks = { ipv6 -> getLocalNetworks(context, ipv6) },
            establish = makeEstablish(vpnBuilder),
            protect = protect,
            onError = onError
        )

        try {
            openVpnClient?.let { client ->
                val openVpnConfig = parseConfig(config)
                val evalConfig = client.eval_config(openVpnConfig)
                if (evalConfig.error) {
                    throw BadConfigException("OpenVPN config parse error: ${evalConfig.message}")
                }
                provideCredentials(client, config)

                remoteRouteExclusions(config).forEach(configBuilder::excludeRoute)

                configPluggableTransport(configBuilder, config)
                configBuilder.configSplitTunneling(config)
                configBuilder.configAppSplitTunneling(config)

                scope.launch {
                    val status = client.connect()
                    if (status.error) {
                        state.value = DISCONNECTED
                        onError("OpenVpn connect() error: ${status.status}: ${status.message}")
                    }
                }
            }
        } catch (e: Exception) {
            openVpnClient = null
            throw e
        }
    }

    override fun stopVpn() {
        openVpnClient?.stop()
        openVpnClient = null
    }

    override fun reconnectVpn(vpnBuilder: Builder, protect: (Int) -> Boolean) {
        openVpnClient?.let {
            it.establish = makeEstablish(vpnBuilder)
            it.reconnect(0)
        }
    }

    protected open fun parseConfig(config: JSONObject): ClientAPI_Config {
        val rawConfig = config.getJSONObject("openvpn_config_data").getString("config")
        val openVpnConfig = ClientAPI_Config()
        openVpnConfig.content = rawConfig
        openVpnConfig.disableClientCert = !rawConfig.hasClientCertificateMaterial()
        return openVpnConfig
    }

    private fun provideCredentials(client: OpenVpnClient, config: JSONObject) {
        val configData = config.optJSONObject("openvpn_config_data") ?: return
        val username = configData.optString("username").takeIf { it.isNotBlank() } ?: return
        val password = configData.optString("password").takeIf { it.isNotBlank() } ?: return
        val credentials = ClientAPI_ProvideCreds().apply {
            setUsername(username)
            setPassword(password)
            setCachePassword(false)
        }
        val status = client.provide_creds(credentials)
        if (status.error) {
            throw BadConfigException("OpenVPN credentials error: ${status.status}: ${status.message}")
        }
    }

    private fun String.hasClientCertificateMaterial(): Boolean {
        val normalized = lineSequence().map { it.trim().lowercase() }.toList()
        return normalized.any { it == "<cert>" || it.startsWith("cert ") } &&
            normalized.any { it == "<key>" || it.startsWith("key ") }
    }

    protected open fun remoteRouteExclusions(config: JSONObject): List<InetNetwork> = emptyList()

    protected open fun configPluggableTransport(configBuilder: OpenVpnConfig.Builder, config: JSONObject) {}

    private fun makeEstablish(vpnBuilder: Builder): (OpenVpnConfig.Builder) -> Int = { configBuilder ->
        try {
            runBlocking(Dispatchers.Main.immediate) {
                configBuilder.addFallbackDnsIfMissing()
                val openVpnConfig = configBuilder.build()
                buildVpnInterface(openVpnConfig, vpnBuilder)

                vpnBuilder.establish().use { tunFd ->
                    if (tunFd == null) {
                        throw VpnStartException("Create VPN interface: permission not granted or revoked")
                    }
                    return@runBlocking tunFd.detachFd()
                }
            }
        } catch (throwable: Throwable) {
            AndroidLog.e("OpenVpnEstablish", "Create VPN interface failed", throwable)
            throw throwable
        }
    }

    protected fun parseInetAddressOrNull(value: String): InetAddress? =
        runCatching { parseInetAddress(value) }.getOrNull()
}
