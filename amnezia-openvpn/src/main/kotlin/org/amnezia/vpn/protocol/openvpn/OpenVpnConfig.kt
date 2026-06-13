package org.amnezia.vpn.protocol.openvpn

import org.amnezia.vpn.protocol.ProtocolConfig
import org.amnezia.vpn.util.net.parseInetAddress

private const val OPENVPN_DEFAULT_MTU = 1500

class OpenVpnConfig private constructor(
    protocolConfigBuilder: ProtocolConfig.Builder
) : ProtocolConfig(protocolConfigBuilder) {

    class Builder : ProtocolConfig.Builder(false) {
        override var mtu: Int = OPENVPN_DEFAULT_MTU

        fun addFallbackDnsIfMissing() = apply {
            if (hasDnsServers()) return@apply
            addDnsServer(parseInetAddress("1.1.1.1"))
            addDnsServer(parseInetAddress("8.8.8.8"))
        }

        override fun build(): OpenVpnConfig = configBuild().run { OpenVpnConfig(this@Builder) }
    }

    companion object {
        inline fun build(block: Builder.() -> Unit): OpenVpnConfig = Builder().apply(block).build()
    }
}
