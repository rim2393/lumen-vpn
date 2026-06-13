package tel.lumentech.vpn.model

import kotlinx.serialization.Serializable

enum class ProtocolType {
    VLESS,
    VMESS,
    TROJAN,
    SHADOWSOCKS,
    SOCKS,
    HTTP_PROXY,
    HYSTERIA,
    HYSTERIA2,
    TUIC,
    NAIVE,
    WIREGUARD,
    AMNEZIA_WG,
    OPENVPN,
    OPENVPN_CLOAK,
    OPENVPN_SHADOWSOCKS,
    XRAY,
    IPSEC,
    SING_BOX,
    CLASH,
    UNKNOWN
}

enum class VpnStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Error
}

enum class RuntimeBackend {
    SING_BOX,
    XRAY_CORE,
    AMNEZIAWG,
    OPENVPN,
    OPENVPN_CLOAK,
    OPENVPN_SHADOWSOCKS,
    ANDROID_IKEV2,
    UNSUPPORTED
}

@Serializable
data class ServerProfile(
    val id: String,
    val subscriptionId: String,
    val displayName: String,
    val protocol: ProtocolType,
    val rawUri: String,
    val host: String = "",
    val port: Int = 0,
    val username: String = "",
    val password: String = "",
    val uuid: String = "",
    val method: String = "",
    val transport: String = "",
    val security: String = "",
    val sni: String = "",
    val publicKey: String = "",
    val shortId: String = "",
    val path: String = "",
    val serviceName: String = "",
    val extraJson: String = "{}",
)

@Serializable
data class SubscriptionProfile(
    val id: String,
    val name: String,
    val source: String,
    val servers: List<ServerProfile>,
    val updatedAt: Long = System.currentTimeMillis(),
)

data class ImportResult(
    val subscription: SubscriptionProfile,
    val warnings: List<String> = emptyList(),
)
