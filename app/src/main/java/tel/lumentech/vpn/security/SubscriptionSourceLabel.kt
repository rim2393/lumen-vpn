package tel.lumentech.vpn.security

import java.net.URI

object SubscriptionSourceLabel {
    fun safeLabel(source: String): String {
        val value = source.trim()
        if (value.isBlank()) return "manual"
        val lower = value.lowercase()
        if (lower in setOf("manual", "clipboard", "file", "qr")) return lower
        if ("://" !in value) return value.take(36)
        return runCatching {
            val uri = URI(value)
            val scheme = uri.scheme.orEmpty().ifBlank { "source" }
            val host = uri.host.orEmpty()
            when {
                scheme in setOf("vless", "vmess", "trojan", "ss", "socks", "socks5", "hysteria", "hysteria2", "hy2", "tuic", "naive", "wireguard", "vpn") ->
                    "$scheme profile"
                host.isNotBlank() -> "$scheme://$host"
                else -> "$scheme source"
            }
        }.getOrElse {
            lower.substringBefore("://").takeIf { it.isNotBlank() }?.let { "$it source" } ?: "subscription"
        }
    }
}
