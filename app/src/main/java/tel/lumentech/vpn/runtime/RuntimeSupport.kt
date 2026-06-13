package tel.lumentech.vpn.runtime

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.model.ServerProfile

object RuntimeSupport {
    private val json = Json { ignoreUnknownKeys = true }

    val singBoxProtocols: Set<ProtocolType> = setOf(
        ProtocolType.VLESS,
        ProtocolType.VMESS,
        ProtocolType.TROJAN,
        ProtocolType.SHADOWSOCKS,
        ProtocolType.SOCKS,
        ProtocolType.HTTP_PROXY,
        ProtocolType.HYSTERIA,
        ProtocolType.HYSTERIA2,
        ProtocolType.TUIC,
        ProtocolType.NAIVE,
        ProtocolType.WIREGUARD,
        ProtocolType.XRAY,
        ProtocolType.SING_BOX,
    )

    val windowsConnectableProtocols: Set<ProtocolType> = singBoxProtocols + setOf(
        ProtocolType.AMNEZIA_WG,
        ProtocolType.OPENVPN,
        ProtocolType.OPENVPN_CLOAK,
        ProtocolType.OPENVPN_SHADOWSOCKS,
        ProtocolType.IPSEC,
    )

    val connectableProtocols: Set<ProtocolType> = singBoxProtocols + setOf(
        ProtocolType.AMNEZIA_WG,
        ProtocolType.IPSEC,
    )

    fun backend(protocol: ProtocolType): RuntimeBackend = when (protocol) {
        ProtocolType.VLESS,
        ProtocolType.XRAY -> RuntimeBackend.XRAY_CORE
        in singBoxProtocols -> RuntimeBackend.SING_BOX
        ProtocolType.AMNEZIA_WG -> RuntimeBackend.AMNEZIAWG
        ProtocolType.OPENVPN -> RuntimeBackend.OPENVPN
        ProtocolType.OPENVPN_CLOAK -> RuntimeBackend.OPENVPN_CLOAK
        ProtocolType.OPENVPN_SHADOWSOCKS -> RuntimeBackend.OPENVPN_SHADOWSOCKS
        ProtocolType.IPSEC -> RuntimeBackend.ANDROID_IKEV2
        else -> RuntimeBackend.UNSUPPORTED
    }

    fun backend(profile: ServerProfile): RuntimeBackend =
        when {
            profile.protocol == ProtocolType.WIREGUARD && looksLikeWireGuard(profile.rawUri) -> RuntimeBackend.AMNEZIAWG
            profile.hasRawXrayOutbound() -> RuntimeBackend.XRAY_CORE
            profile.hasRawSingBoxOutbound() -> RuntimeBackend.SING_BOX
            else -> backend(profile.protocol)
        }

    fun isConnectable(protocol: ProtocolType): Boolean = protocol in connectableProtocols

    fun isConnectable(profile: ServerProfile): Boolean = when (backend(profile)) {
        RuntimeBackend.XRAY_CORE,
        RuntimeBackend.SING_BOX,
        RuntimeBackend.AMNEZIAWG,
        RuntimeBackend.OPENVPN,
        RuntimeBackend.OPENVPN_CLOAK,
        RuntimeBackend.OPENVPN_SHADOWSOCKS,
        RuntimeBackend.ANDROID_IKEV2 -> validationIssue(profile) == null
        RuntimeBackend.UNSUPPORTED -> false
    }

    fun isWindowsConnectable(protocol: ProtocolType): Boolean = protocol in windowsConnectableProtocols

    fun isWindowsConnectable(profile: ServerProfile): Boolean = validationIssue(profile) == null

    fun validationIssue(profile: ServerProfile): String? = when (backend(profile)) {
        RuntimeBackend.XRAY_CORE -> when {
            profile.host.isBlank() -> "Xray profile is incomplete: server host is missing."
            profile.port !in 1..65535 -> "Xray profile is incomplete: server port is invalid."
            profile.uuid.isBlank() && profile.username.isBlank() && !profile.hasRawXrayOutbound() ->
                "Xray profile is incomplete: UUID is missing."
            else -> null
        }
        RuntimeBackend.SING_BOX -> when {
            profile.hasRawSingBoxOutbound() -> null
            profile.protocol == ProtocolType.SING_BOX && !profile.rawUri.trim().startsWith("{") ->
                unsupportedRuntimeMessage(profile.protocol)
            profile.protocol == ProtocolType.HYSTERIA && profile.host.isBlank() ->
                "Hysteria profile is incomplete: server host is missing."
            profile.protocol == ProtocolType.HYSTERIA && profile.port !in 1..65535 ->
                "Hysteria profile is incomplete: server port is invalid."
            profile.protocol == ProtocolType.HYSTERIA && profile.hysteriaAuth().isBlank() ->
                "Hysteria profile is incomplete: auth/password is missing."
            profile.protocol == ProtocolType.HYSTERIA2 && profile.host.isBlank() ->
                "Hysteria2 profile is incomplete: server host is missing."
            profile.protocol == ProtocolType.HYSTERIA2 &&
                profile.port !in 1..65535 &&
                profile.extraStrings("server_ports", "serverPorts", "ports", "mport", "multi_port", "multiPort").isEmpty() ->
                "Hysteria2 profile is incomplete: server port is invalid."
            profile.protocol == ProtocolType.HYSTERIA2 && profile.hysteria2Auth().isBlank() ->
                "Hysteria2 profile is incomplete: auth/password is missing."
            profile.protocol == ProtocolType.TROJAN && profile.host.isBlank() ->
                "Trojan profile is incomplete: server host is missing."
            profile.protocol == ProtocolType.TROJAN && profile.port !in 1..65535 ->
                "Trojan profile is incomplete: server port is invalid."
            profile.protocol == ProtocolType.TROJAN && profile.password.isBlank() && profile.username.isBlank() ->
                "Trojan profile is incomplete: password is missing."
            profile.protocol == ProtocolType.NAIVE && profile.host.isBlank() ->
                "NaiveProxy profile is incomplete: server host is missing."
            profile.protocol == ProtocolType.NAIVE && profile.port !in 1..65535 ->
                "NaiveProxy profile is incomplete: server port is invalid."
            profile.protocol == ProtocolType.NAIVE && (profile.username.isBlank() || profile.password.isBlank()) ->
                "NaiveProxy profile is incomplete: username/password is missing."
            profile.protocol == ProtocolType.HTTP_PROXY && profile.host.isBlank() ->
                "HTTP proxy profile is incomplete: server host is missing."
            profile.protocol == ProtocolType.HTTP_PROXY && profile.port !in 1..65535 ->
                "HTTP proxy profile is incomplete: server port is invalid."
            profile.protocol == ProtocolType.WIREGUARD && !looksLikeWireGuard(profile.rawUri) ->
                "WireGuard profile is incomplete: native .conf body is missing."
            else -> null
        }
        RuntimeBackend.AMNEZIAWG -> when {
            looksLikeWireGuard(profile.rawUri) -> null
            else -> "AmneziaWG profile is incomplete: native .conf body is missing."
        }
        RuntimeBackend.OPENVPN -> when {
            looksLikeOpenVpn(profile.rawUri) -> null
            else -> "OpenVPN profile is incomplete: .ovpn config body is missing."
        }
        RuntimeBackend.OPENVPN_CLOAK -> when {
            looksLikeOpenVpn(profile.rawUri) && profile.extraJson.contains("RemoteHost", true) -> null
            else -> "OpenVPN over Cloak profile is incomplete: it needs both .ovpn config and Cloak client JSON."
        }
        RuntimeBackend.OPENVPN_SHADOWSOCKS -> when {
            !looksLikeOpenVpn(profile.rawUri) ->
                "OpenVPN over Shadowsocks profile is incomplete: .ovpn config body is missing."
            !profile.extraJson.contains("shadowsocks", true) ->
                "OpenVPN over Shadowsocks profile is incomplete: Shadowsocks proxy settings are missing."
            !looksLikeOpenVpnTcp(profile.rawUri) ->
                "OpenVPN over Shadowsocks currently supports TCP .ovpn profiles only; UDP needs a native Shadowsocks UDP bridge."
            profile.host.isBlank() ->
                "OpenVPN over Shadowsocks profile is incomplete: Shadowsocks server host is missing."
            profile.port !in 1..65535 ->
                "OpenVPN over Shadowsocks profile is incomplete: Shadowsocks server port is invalid."
            profile.method.isBlank() ->
                "OpenVPN over Shadowsocks profile is incomplete: Shadowsocks method is missing."
            profile.password.isBlank() ->
                "OpenVPN over Shadowsocks profile is incomplete: Shadowsocks password is missing."
            else -> null
        }
        RuntimeBackend.ANDROID_IKEV2 -> when {
            profile.host.isBlank() -> "IKEv2/IPsec profile is incomplete: server host is missing."
            profile.username.isBlank() || profile.password.isBlank() ->
                "IKEv2/IPsec profile is incomplete: EAP username/password are missing."
            profile.extraString("ikev2_ca_cert", "ikev2CaCert", "caCert", "ca_cert", "ca").isBlank() ->
                "IKEv2/IPsec profile is incomplete: server root CA certificate is missing."
            else -> null
        }
        RuntimeBackend.UNSUPPORTED -> unsupportedRuntimeMessage(profile.protocol)
    }

    fun label(protocol: ProtocolType): String = when (protocol) {
        ProtocolType.VLESS -> "VLESS"
        ProtocolType.VMESS -> "VMess"
        ProtocolType.TROJAN -> "Trojan"
        ProtocolType.SHADOWSOCKS -> "Shadowsocks"
        ProtocolType.SOCKS -> "SOCKS"
        ProtocolType.HTTP_PROXY -> "HTTP proxy"
        ProtocolType.HYSTERIA -> "Hysteria"
        ProtocolType.HYSTERIA2 -> "Hysteria2"
        ProtocolType.TUIC -> "TUIC"
        ProtocolType.NAIVE -> "NaiveProxy"
        ProtocolType.WIREGUARD -> "WireGuard"
        ProtocolType.AMNEZIA_WG -> "AmneziaWG"
        ProtocolType.OPENVPN -> "OpenVPN"
        ProtocolType.OPENVPN_CLOAK -> "OpenVPN over Cloak"
        ProtocolType.OPENVPN_SHADOWSOCKS -> "OpenVPN over SS"
        ProtocolType.XRAY -> "XRay/Reality"
        ProtocolType.IPSEC -> "IKEv2/IPsec"
        ProtocolType.SING_BOX -> "sing-box"
        ProtocolType.CLASH -> "Clash"
        ProtocolType.UNKNOWN -> "Unknown"
    }

    fun unsupportedRuntimeMessage(protocol: ProtocolType): String = when (protocol) {
        ProtocolType.OPENVPN ->
            "OpenVPN profile is incomplete: .ovpn config body is missing."
        ProtocolType.OPENVPN_CLOAK ->
            "OpenVPN over Cloak profile is incomplete: it needs both .ovpn config and Cloak client JSON."
        ProtocolType.OPENVPN_SHADOWSOCKS ->
            "OpenVPN over Shadowsocks profile needs OpenVPN and Shadowsocks bridge runtimes."
        ProtocolType.IPSEC ->
            "IKEv2/IPsec profile needs Android platform VPN support and EAP credentials."
        ProtocolType.CLASH ->
            "Clash subscription must be parsed into concrete proxy profiles."
        ProtocolType.SING_BOX ->
            "sing-box profile must contain a full JSON config with outbound."
        ProtocolType.UNKNOWN ->
            "Protocol is unknown."
        else ->
            "${label(protocol)} profile is incomplete or incompatible with the current runtime."
    }

    private fun looksLikeOpenVpn(value: String): Boolean {
        val lines = value.lineSequence().map { it.trim() }.filter { it.isNotBlank() }.toList()
        val hasClient = lines.any { it.equals("client", true) || it.startsWith("client ", true) }
        val hasDev = lines.any { it.startsWith("dev tun", true) || it.startsWith("dev tap", true) }
        val hasRemote = lines.any { it.startsWith("remote ", true) }
        return hasClient && (hasDev || hasRemote)
    }

    private fun looksLikeOpenVpnTcp(value: String): Boolean {
        val lines = value.lineSequence()
            .map { it.trim() }
            .filter { it.isNotBlank() && !it.startsWith("#") && !it.startsWith(";") }
            .toList()
        val proto = lines.firstOrNull { it.startsWith("proto ", true) }
            ?.split(Regex("\\s+"))
            ?.getOrNull(1)
            ?.lowercase()
        if (proto != null) return proto.startsWith("tcp")
        return lines.any { line ->
            line.startsWith("remote ", true) &&
                line.split(Regex("\\s+")).drop(3).any { it.lowercase().startsWith("tcp") }
        }
    }

    private fun looksLikeWireGuard(value: String): Boolean =
        value.contains("[Interface]", true) && value.contains("[Peer]", true)

    private fun ServerProfile.hysteria2Auth(): String =
        when {
            username.isNotBlank() && password.isNotBlank() -> "$username:$password"
            password.isNotBlank() -> password
            username.isNotBlank() -> username
            else -> extraString("password", "auth", "auth_str", "authString")
        }

    private fun ServerProfile.hysteriaAuth(): String =
        when {
            password.isNotBlank() -> password
            username.isNotBlank() -> username
            else -> extraString("auth_str", "authString", "auth", "password")
        }

    private fun ServerProfile.extraObject(): JsonObject =
        runCatching { json.parseToJsonElement(extraJson).jsonObject }.getOrElse { JsonObject(emptyMap()) }

    private fun ServerProfile.extraString(vararg names: String): String {
        val extra = extraObject()
        for (name in names) {
            when (val value = extra.valueAt(name)) {
                is JsonPrimitive -> value.contentOrNull?.takeIf { it.isNotBlank() }?.let { return it }
                is JsonArray -> value.firstNotNullOfOrNull { (it as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank) }
                    ?.let { return it }
                else -> Unit
            }
        }
        return ""
    }

    private fun ServerProfile.extraStrings(vararg names: String): List<String> {
        val extra = extraObject()
        for (name in names) {
            when (val value = extra.valueAt(name)) {
                is JsonArray -> return value.mapNotNull {
                    (it as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank)
                }
                is JsonPrimitive -> return value.contentOrNull
                    ?.split(",")
                    ?.map { it.trim() }
                    ?.filter { it.isNotBlank() }
                    .orEmpty()
                else -> Unit
            }
        }
        return emptyList()
    }

    private fun ServerProfile.hasRawSingBoxOutbound(): Boolean {
        if (extraObject().isRawSingBoxOutboundFor(protocol, host, port, displayName)) return true
        val outbounds = runCatching {
            (json.parseToJsonElement(rawUri).jsonObject["outbounds"] as? JsonArray).orEmpty()
        }.getOrDefault(emptyList())
        return outbounds
            .mapNotNull { it as? JsonObject }
            .any { it.isRawSingBoxOutboundFor(protocol, host, port, displayName) }
    }

    private fun ServerProfile.hasRawXrayOutbound(): Boolean {
        if (extraObject().isRawXrayOutboundFor(protocol, host, port, displayName)) return true
        val outbounds = runCatching {
            (json.parseToJsonElement(rawUri).jsonObject["outbounds"] as? JsonArray).orEmpty()
        }.getOrDefault(emptyList())
        return outbounds
            .mapNotNull { it as? JsonObject }
            .any { it.isRawXrayOutboundFor(protocol, host, port, displayName) }
    }

    private fun JsonObject.isRawSingBoxOutboundFor(protocol: ProtocolType, host: String, port: Int, tag: String): Boolean {
        val type = (this["type"] as? JsonPrimitive)?.contentOrNull?.lowercase().orEmpty()
        if (type.isBlank() || this["server_port"] == null) return false
        val expected = when (protocol) {
            ProtocolType.VLESS, ProtocolType.XRAY -> "vless"
            ProtocolType.VMESS -> "vmess"
            ProtocolType.TROJAN -> "trojan"
            ProtocolType.SHADOWSOCKS -> "shadowsocks"
            ProtocolType.SOCKS -> "socks"
            ProtocolType.HTTP_PROXY -> "http"
            ProtocolType.HYSTERIA -> "hysteria"
            ProtocolType.HYSTERIA2 -> "hysteria2"
            ProtocolType.TUIC -> "tuic"
            ProtocolType.NAIVE -> "naive"
            else -> return false
        }
        if (type != expected) return false
        val outboundHost = (this["server"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        val outboundPort = (this["server_port"] as? JsonPrimitive)?.contentOrNull?.toIntOrNull()
        val outboundTag = (this["tag"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        return (host.isBlank() || outboundHost == host) &&
            (port <= 0 || outboundPort == port) &&
            (tag.isBlank() || outboundTag.isBlank() || outboundTag == tag)
    }

    private fun JsonObject.isRawXrayOutboundFor(protocol: ProtocolType, host: String, port: Int, tag: String): Boolean {
        val outboundProtocol = (this["protocol"] as? JsonPrimitive)?.contentOrNull?.lowercase().orEmpty()
        val expected = when (protocol) {
            ProtocolType.VLESS, ProtocolType.XRAY -> "vless"
            ProtocolType.VMESS -> "vmess"
            ProtocolType.TROJAN -> "trojan"
            ProtocolType.SHADOWSOCKS -> "shadowsocks"
            ProtocolType.SOCKS -> "socks"
            ProtocolType.HTTP_PROXY -> "http"
            ProtocolType.HYSTERIA -> "hysteria"
            else -> return false
        }
        if (outboundProtocol != expected) return false
        if (protocol == ProtocolType.HYSTERIA) {
            val stream = this["streamSettings"] as? JsonObject
            val network = (stream?.get("network") as? JsonPrimitive)?.contentOrNull?.lowercase().orEmpty()
            if (network != "hysteria") return false
        }
        val settings = this["settings"] as? JsonObject
        val vnext = (settings?.get("vnext") as? JsonArray)?.firstOrNull() as? JsonObject
        val serverEntry = (settings?.get("servers") as? JsonArray)?.firstOrNull() as? JsonObject
        val serverObj = vnext ?: serverEntry ?: settings
        val outboundHost = serverObj?.stringAny("address", "server").orEmpty()
        val outboundPort = serverObj?.stringAny("port", "server_port", "serverPort")?.toIntOrNull()
        val outboundTag = (this["tag"] as? JsonPrimitive)?.contentOrNull.orEmpty()
        return (host.isBlank() || outboundHost == host) &&
            (port <= 0 || outboundPort == port) &&
            (tag.isBlank() || outboundTag.isBlank() || outboundTag == tag || outboundTag.isTechnicalOutboundTag())
    }

    private fun JsonObject.valueAt(name: String): JsonElement? {
        this[name]?.let { return it }
        val parts = name.split(".")
        if (parts.size == 1) return null
        var current: JsonElement = this
        for (part in parts) {
            current = (current as? JsonObject)?.get(part) ?: return null
        }
        return current
    }

    private fun JsonObject.stringAny(vararg names: String): String =
        names.firstNotNullOfOrNull { name ->
            (this[name] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
        }.orEmpty()

    private fun String.isTechnicalOutboundTag(): Boolean =
        equals("proxy", ignoreCase = true) ||
            equals("direct", ignoreCase = true) ||
            equals("block", ignoreCase = true) ||
            equals("api", ignoreCase = true) ||
            equals("dns", ignoreCase = true)
}
