package tel.lumentech.vpn.data

import kotlinx.serialization.Serializable

interface ProfileFieldCodec {
    fun encrypt(value: String): String
    fun decrypt(value: String): String
}

object PlainProfileFieldCodec : ProfileFieldCodec {
    override fun encrypt(value: String): String = value
    override fun decrypt(value: String): String = value
}

@Serializable
data class RuntimeSettings(
    val splitMode: String = "exclude",
    val splitApps: List<String> = emptyList(),
    val dnsMode: String = "cloudflare",
    val customDns: String = "",
    val bypassPrivateNetworks: Boolean = true,
    val strictRoute: Boolean = false,
    val ipv6: Boolean = false,
    val sniff: Boolean = true,
    val systemProxy: Boolean = false,
    val finalOutbound: String = "proxy",
    val directDomains: List<String> = emptyList(),
    val proxyDomains: List<String> = emptyList(),
    val blockDomains: List<String> = emptyList(),
    val directIps: List<String> = emptyList(),
    val proxyIps: List<String> = emptyList(),
    val blockIps: List<String> = emptyList(),
    val ruleSetUrls: List<String> = emptyList(),
)
