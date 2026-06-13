package tel.lumentech.vpn.subscription

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Base64

object LumenDeepLink {
    private val importHosts = setOf("import", "sub", "subscription", "s")
    private val appLinkHosts = setOf("cabinet.lumentech.tel", "lumentech.tel")
    private val appLinkPaths = listOf("/app/import", "/vpn/import", "/import")
    private val externalImportSchemes = setOf(
        "hiddify",
        "v2ray",
        "v2rayn",
        "v2rayng",
        "clash",
        "clashmeta",
        "mihomo",
        "stash",
        "sing-box",
        "nekobox",
        "nekoray",
        "karing",
        "happ",
        "vpn",
        "mless",
        "vless",
        "vmess",
        "trojan",
        "ss",
        "socks",
        "socks4",
        "socks4a",
        "socks5",
        "hysteria",
        "hysteria2",
        "hy2",
        "tuic",
        "naive",
        "naiveproxy",
        "wireguard",
        "ikev2",
        "ipsec"
    )

    fun parse(raw: String): ImportPayload? {
        val trimmed = raw.trim()
        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase().orEmpty()
        val host = uri.host?.lowercase().orEmpty()
        val supported = when (scheme) {
            "lumen" -> host in importHosts
            "https" -> host in appLinkHosts && appLinkPaths.any { uri.path.orEmpty().startsWith(it) }
            in externalImportSchemes -> true
            else -> false
        }
        if (!supported) return null
        val query = uri.queryValues()

        if (scheme in externalImportSchemes) {
            return ImportPayload(
                source = trimmed,
                content = trimmed,
                name = query.firstValue("name", "title", "label")
                    ?: uri.rawFragment?.urlDecode()?.takeIf { it.isNotBlank() }
                    ?: defaultNameForExternalScheme(scheme),
            )
        }

        val name = query.firstValue("name", "title", "label")
            ?: uri.rawFragment?.urlDecode()?.takeIf { it.isNotBlank() }
            ?: "Lumen subscription"

        val content = query.firstValue("url", "uri", "link", "sub", "subscription", "config")
            ?: query.inlineData()
            ?: uri.pathPayload(host)
            ?: return null

        return ImportPayload(
            source = trimmed,
            content = content,
            name = name,
        )
    }

    private fun Map<String, String>.inlineData(): String? {
        val encoded = firstValue("data", "payload", "inline", "text") ?: return null
        val encoding = firstValue("encoding", "enc")?.lowercase().orEmpty()
        return when (encoding) {
            "plain", "raw", "url" -> encoded
            "base64" -> encoded.base64Decode()
            else -> encoded.base64UrlDecode() ?: encoded.base64Decode() ?: encoded
        }
    }

    private fun URI.pathPayload(host: String): String? {
        val raw = rawPath
            ?.trimStart('/')
            ?.takeIf { it.isNotBlank() }
            ?: return null
        if (scheme?.lowercase() == "lumen" && host == "import" && raw.equals("v1", ignoreCase = true)) {
            return null
        }
        val decoded = raw.urlDecode()
        if (decoded.contains("://") || decoded.startsWith("{") || decoded.startsWith("[") || decoded.contains("\n")) {
            return decoded
        }
        return decoded.base64UrlDecode() ?: decoded.base64Decode() ?: decoded
    }

    private fun URI.queryValues(): Map<String, String> {
        val query = rawQuery ?: return emptyMap()
        return query.split("&")
            .filter { it.isNotBlank() }
            .mapNotNull { pair ->
                val key = pair.substringBefore("=").urlDecode()
                val value = pair.substringAfter("=", "").urlDecode()
                key.takeIf { it.isNotBlank() }?.let { it.lowercase() to value }
            }
            .toMap()
    }

    private fun Map<String, String>.firstValue(vararg keys: String): String? =
        keys.firstNotNullOfOrNull { key -> get(key.lowercase())?.takeIf { it.isNotBlank() } }

    private fun String.urlDecode(): String =
        runCatching {
            URLDecoder.decode(replace("+", "%2B"), StandardCharsets.UTF_8.name())
        }.getOrDefault(this)

    private fun String.base64UrlDecode(): String? =
        runCatching {
            val bytes = Base64.getUrlDecoder().decode(padBase64())
            String(bytes, StandardCharsets.UTF_8).takeIf { it.isNotBlank() }
        }.getOrNull()

    private fun String.base64Decode(): String? =
        runCatching {
            val bytes = Base64.getDecoder().decode(padBase64())
            String(bytes, StandardCharsets.UTF_8).takeIf { it.isNotBlank() }
        }.getOrNull()

    private fun String.padBase64(): String {
        val remainder = length % 4
        return if (remainder == 0) this else this + "=".repeat(4 - remainder)
    }

    private fun defaultNameForExternalScheme(scheme: String): String =
        when (scheme) {
            "hiddify" -> "Hiddify import"
            "sing-box" -> "sing-box import"
            "nekobox" -> "NekoBox import"
            "nekoray" -> "NekoRay import"
            "clash", "clashmeta", "mihomo", "stash" -> "Clash import"
            "karing" -> "Karing import"
            "happ" -> "Happ import"
            "vpn" -> "Amnezia VPN import"
            else -> "${scheme.uppercase()} import"
        }

    data class ImportPayload(
        val source: String,
        val content: String,
        val name: String,
    )
}
