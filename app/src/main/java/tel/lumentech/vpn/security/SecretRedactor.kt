package tel.lumentech.vpn.security

object SecretRedactor {
    private val keyValuePatterns = listOf(
        Regex("(?i)(password|passwd|pwd|token|refresh_token|access_token|private_key|preshared_key|secret|uuid|auth|auth_str|hwid|device_id|deviceid)=([^&\\s]+)"),
        Regex("(?i)(\"(?:password|token|refresh_token|access_token|private_key|preshared_key|secret|uuid|auth|auth_str|hwid|device_id|deviceid)\"\\s*:\\s*\")([^\"]+)(\")"),
        Regex("(?i)((?:vless|vmess|trojan|ss|socks(?:4a?|5)?|hysteria|hysteria2|hy2|tuic|naive|naiveproxy|wireguard|vpn|happ|hiddify|sing-box|nekobox|nekoray|clash|clashmeta|mihomo|stash|v2ray|v2rayn|v2rayng|lumen)://)([^\\s]+)"),
        Regex("(?i)(https://[^\\s\"'<>]+/(?:api/v1/)?subscriptions/public/)([^/\\s\"'<>]+)"),
        Regex("(?i)(https://[^\\s\"'<>]+/sub/)([^/\\s\"'<>]+)"),
        Regex("(?im)^((?:PrivateKey|PresharedKey|PreSharedKey|PublicKey|Address|Endpoint|AllowedIPs)\\s*=\\s*)(.+)$")
    )

    fun redact(value: String?): String {
        if (value.isNullOrBlank()) return ""
        var redacted = value
        redacted = keyValuePatterns[0].replace(redacted) { "${it.groupValues[1]}=<redacted>" }
        redacted = keyValuePatterns[1].replace(redacted) {
            "${it.groupValues[1]}<redacted>${it.groupValues[3]}"
        }
        redacted = keyValuePatterns[2].replace(redacted) { "${it.groupValues[1]}<redacted>" }
        redacted = keyValuePatterns[3].replace(redacted) { "${it.groupValues[1]}<redacted>" }
        redacted = keyValuePatterns[4].replace(redacted) { "${it.groupValues[1]}<redacted>" }
        redacted = keyValuePatterns[5].replace(redacted) { "${it.groupValues[1]}<redacted>" }
        return redacted
    }
}
