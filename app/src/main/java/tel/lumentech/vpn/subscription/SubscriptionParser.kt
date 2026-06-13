package tel.lumentech.vpn.subscription

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import tel.lumentech.vpn.model.ImportResult
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.SubscriptionProfile

class SubscriptionParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(source: String, content: String, name: String = "Manual import"): ImportResult {
        val normalized = content.trim()
        require(normalized.isNotEmpty()) { "Subscription is empty" }
        val canonical = AmneziaQrCodec.decodeNativeConfig(normalized) ?: normalized
        val expanded = expandSubscription(canonical)
        val warnings = mutableListOf<String>()
        val servers = mutableListOf<ServerProfile>()

        for (entry in expanded) {
            runCatching { parseEntry(source, entry) }
                .onSuccess { parsed ->
                    if (parsed != null) {
                        servers.add(parsed)
                    } else if (entry.isStructuredEntry()) {
                        parseStructured(source, entry, warnings)?.let { servers.addAll(it) }
                    }
                }
                .onFailure { warnings.add("Skipped unsupported entry: ${it.message ?: "unknown"}") }
        }

        if (servers.isEmpty()) {
            parseStructured(source, canonical, warnings)?.let { servers.addAll(it) }
        }
        require(servers.isNotEmpty()) { "No supported VPN profiles found" }
        val subscriptionId = stableId(source + canonical.take(128))
        val fixedServers = servers.map { it.copy(subscriptionId = subscriptionId) }
        return ImportResult(
            subscription = SubscriptionProfile(
                id = subscriptionId,
                name = name.ifBlank { "Manual import" },
                source = source,
                servers = fixedServers,
            ),
            warnings = warnings
        )
    }

    private fun expandSubscription(content: String): List<String> {
        if (content.startsWith("{") || content.startsWith("[") || content.contains("proxies:")) return listOf(content)
        if (content.contains("[Interface]", ignoreCase = true) && content.contains("[Peer]", ignoreCase = true)) {
            return listOf(content)
        }
        if (looksLikeOpenVpnConfig(content)) return listOf(content)
        if (content.lines().size > 1) {
            return content.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
        }
        if (content.contains(",")) {
            val parts = content.splitProfileEntries(',')
            if (parts.any { it.contains("://") || it.startsWith("[Interface]", true) }) return parts
        }
        if (content.contains("|")) {
            val parts = content.splitProfileEntries('|')
            if (parts.any { it.contains("://") || it.startsWith("[Interface]", true) }) return parts
        }
        val decoded = decodeBase64OrNull(content)
        if (decoded != null && decoded != content) {
            val lines = decoded.lines()
                .flatMap { it.split("|") }
                .map { it.trim() }
                .filter { it.isNotEmpty() }
            if (lines.any { it.contains("://") || it.startsWith("[Interface]", true) }) return lines
        }
        return listOf(content)
    }

    private fun String.splitProfileEntries(delimiter: Char): List<String> {
        val result = mutableListOf<String>()
        var start = 0
        for (index in indices) {
            if (this[index] != delimiter) continue
            val next = substring(index + 1).trimStart()
            if (!next.startsProfileEntry()) continue
            substring(start, index).trim().takeIf { it.isNotEmpty() }?.let { result += it }
            start = index + 1
        }
        substring(start).trim().takeIf { it.isNotEmpty() }?.let { result += it }
        return result
    }

    private fun String.startsProfileEntry(): Boolean {
        val value = trimStart()
        return value.isStructuredEntry() ||
            value.startsWith("[Interface]", ignoreCase = true) ||
            PROFILE_URI_PREFIXES.any { value.startsWith(it, ignoreCase = true) }
    }

    private fun String.isStructuredEntry(): Boolean {
        val value = trimStart()
        return value.startsWith("{") || value.startsWith("[") || value.contains("proxies:")
    }

    private fun parseEntry(source: String, entry: String): ServerProfile? {
        val lower = entry.lowercase()
        return when {
            lower.startsWith("vless://") || lower.startsWith("mless://") ->
                parseUri(source, entry.replaceFirst("mless://", "vless://", ignoreCase = true), ProtocolType.VLESS)
            lower.startsWith("vmess://") -> parseVmess(source, entry)
            lower.startsWith("trojan://") -> parseUri(source, entry, ProtocolType.TROJAN)
            lower.startsWith("ss://") -> parseShadowsocks(source, entry)
            lower.startsWith("socks://") || lower.startsWith("socks4://") || lower.startsWith("socks4a://") || lower.startsWith("socks5://") ->
                parseSocks(source, entry)
            lower.startsWith("http://") -> parseHttpProxy(source, entry)
            lower.startsWith("hysteria://") -> parseUri(source, entry, ProtocolType.HYSTERIA)
            lower.startsWith("hysteria2://") || lower.startsWith("hy2://") -> parseUri(source, entry, ProtocolType.HYSTERIA2)
            lower.startsWith("tuic://") -> parseUri(source, entry, ProtocolType.TUIC)
            lower.startsWith("wireguard://") -> parseWireGuardUri(source, entry)
            lower.startsWith("ikev2://") || lower.startsWith("ipsec://") -> parseIpsecUri(source, entry)
            lower.startsWith("naive://") || lower.startsWith("naiveproxy://") -> parseNaiveProxy(source, entry)
            lower.startsWith("https://") && URI(entry).rawUserInfo?.isNotBlank() == true -> parseNaiveProxy(source, entry)
            lower.startsWith("[interface]") || lower.contains("\n[peer]") -> parseWireGuardConfig(source, entry)
            looksLikeOpenVpnConfig(entry) -> parseOpenVpnConfig(source, entry)
            lower.startsWith("{") || lower.startsWith("[") || lower.contains("proxies:") -> null
            else -> null
        }
    }

    private fun parseStructured(source: String, content: String, warnings: MutableList<String>): List<ServerProfile>? {
        if (looksLikeOpenVpnConfig(content)) {
            return listOf(parseOpenVpnConfig(source, content))
        }
        if (content.startsWith("{") || content.startsWith("[")) {
            val element = runCatching { json.parseToJsonElement(content) }.getOrElse {
                warnings.add("Invalid JSON: ${it.message}")
                return emptyList()
            }
            return when (element) {
                is JsonObject -> parseStructuredObject(source, element, warnings)
                is JsonArray -> element.flatMap { item ->
                    (item as? JsonObject)?.let { parseStructuredObject(source, it, warnings) }.orEmpty()
                }
                else -> emptyList()
            }
        }
        if (content.contains("proxies:")) {
            return parseClashYaml(source, content)
        }
        return null
    }

    private fun parseStructuredObject(source: String, root: JsonObject, warnings: MutableList<String>): List<ServerProfile> {
        parseLumenManifest(source, root)?.let { return it }
        parseOpenVpnCloakCompound(source, root)?.let { return listOf(it) }
        parseOpenVpnShadowsocksCompound(source, root)?.let { return listOf(it) }
        parseIpsecJson(source, root)?.let { return listOf(it) }
        parseCloakJson(source, root)?.let { return listOf(it) }
        val servers = mutableListOf<ServerProfile>()
        parseXrayJson(source, root)?.let { servers.addAll(it) }
        parseAmneziaJson(source, root, warnings)?.let { servers.addAll(it) }
        parseSingBoxJson(source, root.toString(), warnings).let { servers.addAll(it) }
        return servers.distinctBy { it.id }
    }

    private fun parseUri(source: String, raw: String, protocol: ProtocolType): ServerProfile {
        val uri = URI(raw)
        val query = parseQuery(uri.rawQuery.orEmpty())
        val extra = if (protocol == ProtocolType.HYSTERIA2) uri.hysteria2Extra(query) else query
        val userInfo = uri.rawUserInfo?.urlDecode().orEmpty().ifBlank { uri.userInfoFromAuthority() }
        val fragment = uri.rawFragment?.urlDecode().orEmpty()
        val host = uri.hostFromAuthority()
        val transport = when (protocol) {
            ProtocolType.VLESS -> query["type"] ?: query["network"] ?: "tcp"
            else -> query["type"].orEmpty()
        }
        val security = when (protocol) {
            ProtocolType.VLESS -> query["security"] ?: query["tls"] ?: "none"
            else -> query["security"].orEmpty()
        }
        val port = if (uri.port > 0) {
            uri.port
        } else {
            uri.firstPortFromAuthority() ?: when (protocol) {
                ProtocolType.HYSTERIA,
                ProtocolType.VLESS,
                ProtocolType.HYSTERIA2,
                ProtocolType.TUIC -> 443
                else -> 0
            }
        }
        val sni = query["sni"] ?: query["serverName"] ?: query["servername"] ?: query["peer"] ?: ""
        val path = if (protocol == ProtocolType.VLESS && transport.equals("ws", ignoreCase = true)) {
            query["path"] ?: "/"
        } else {
            query["path"].orEmpty()
        }
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = fragment.ifBlank { "${protocol.name} ${host.ifBlank { source }}" },
            protocol = protocol,
            rawUri = raw,
            host = host,
            port = port,
            username = userInfo.substringBefore(":", userInfo),
            password = userInfo.substringAfter(":", ""),
            uuid = if (protocol in setOf(ProtocolType.VLESS, ProtocolType.TUIC)) userInfo.substringBefore(":", userInfo) else "",
            transport = transport,
            security = security,
            sni = sni,
            publicKey = query["pbk"].orEmpty(),
            shortId = query["sid"].orEmpty(),
            path = path,
            serviceName = query["serviceName"]
                ?: query["service_name"]
                ?: query["grpc-service-name"]
                ?: query["grpc_service_name"]
                ?: "",
            extraJson = extra.toJsonString()
        )
    }

    private fun parseVmess(source: String, raw: String): ServerProfile {
        val body = raw.removePrefix("vmess://")
        val decoded = decodeBase64OrNull(body) ?: error("Invalid vmess base64")
        val obj = json.parseToJsonElement(decoded).jsonObject
        val host = obj.string("add")
        val port = obj.string("port").toIntOrNull() ?: 0
        val id = obj.string("id")
        val name = obj.string("ps").ifBlank { "VMess $host" }
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = name,
            protocol = ProtocolType.VMESS,
            rawUri = raw,
            host = host,
            port = port,
            uuid = id,
            transport = obj.string("net"),
            security = obj.string("tls"),
            sni = obj.string("sni").ifBlank { obj.string("host") },
            path = obj.string("path"),
            extraJson = decoded
        )
    }

    private fun parseShadowsocks(source: String, raw: String): ServerProfile {
        val noScheme = raw.removePrefix("ss://")
        val fragment = noScheme.substringAfter("#", "").urlDecode()
        val withoutFragment = noScheme.substringBefore("#")
        val query = parseQuery(withoutFragment.substringAfter("?", ""))
        val main = withoutFragment.substringBefore("?")
        val decoded = decodeBase64OrNull(main.substringBefore("@")) ?: main.substringBefore("@").urlDecode()
        val credentials: String
        val hostPort: String
        if (main.contains("@")) {
            credentials = decoded
            hostPort = main.substringAfter("@")
        } else {
            val decodedAll = decodeBase64OrNull(main) ?: main
            credentials = decodedAll.substringBefore("@")
            hostPort = decodedAll.substringAfter("@")
        }
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = fragment.ifBlank { "Shadowsocks ${hostPort.substringBefore(":")}" },
            protocol = ProtocolType.SHADOWSOCKS,
            rawUri = raw,
            host = hostPort.substringBefore(":"),
            port = hostPort.substringAfter(":", "0").toIntOrNull() ?: 0,
            method = credentials.substringBefore(":"),
            password = credentials.substringAfter(":", ""),
            extraJson = shadowsocksExtra(query).toJsonString()
        )
    }

    private fun parseSocks(source: String, raw: String): ServerProfile {
        val uri = URI(raw)
        val query = parseQuery(uri.rawQuery.orEmpty())
        val userInfo = uri.rawUserInfo?.urlDecode().orEmpty()
        val scheme = uri.scheme?.lowercase().orEmpty()
        val version = when (scheme) {
            "socks4" -> "4"
            "socks4a" -> "4a"
            else -> query["version"] ?: query["v"] ?: "5"
        }
        val host = uri.host.orEmpty()
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = uri.rawFragment?.urlDecode().orEmpty().ifBlank { "SOCKS ${host.ifBlank { source }}" },
            protocol = ProtocolType.SOCKS,
            rawUri = raw,
            host = host,
            port = if (uri.port > 0) uri.port else 0,
            username = userInfo.substringBefore(":", userInfo),
            password = userInfo.substringAfter(":", ""),
            extraJson = (query + ("version" to version)).toJsonString()
        )
    }

    private fun parseHttpProxy(source: String, raw: String): ServerProfile {
        val uri = URI(raw)
        val query = parseQuery(uri.rawQuery.orEmpty())
        val userInfo = uri.rawUserInfo?.urlDecode().orEmpty()
        val host = uri.hostFromAuthority()
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = uri.rawFragment?.urlDecode().orEmpty().ifBlank { "HTTP ${host.ifBlank { source }}" },
            protocol = ProtocolType.HTTP_PROXY,
            rawUri = raw,
            host = host,
            port = if (uri.port > 0) uri.port else uri.firstPortFromAuthority() ?: 80,
            username = userInfo.substringBefore(":", userInfo),
            password = userInfo.substringAfter(":", ""),
            transport = query["network"] ?: query["transport"] ?: "tcp",
            extraJson = query.toJsonString()
        )
    }

    private fun parseNaiveProxy(source: String, raw: String): ServerProfile {
        val normalizedRaw = raw.replaceFirst("naiveproxy://", "naive://", ignoreCase = true)
        val uri = URI(normalizedRaw)
        val query = parseQuery(uri.rawQuery.orEmpty())
        val userInfo = uri.rawUserInfo?.urlDecode().orEmpty()
        val host = uri.hostFromAuthority()
        val tlsServerName = query["sni"] ?: query["serverName"] ?: query["servername"] ?: host
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = uri.rawFragment?.urlDecode().orEmpty().ifBlank { "NaiveProxy ${host.ifBlank { source }}" },
            protocol = ProtocolType.NAIVE,
            rawUri = raw,
            host = host,
            port = if (uri.port > 0) uri.port else uri.firstPortFromAuthority() ?: 443,
            username = userInfo.substringBefore(":", userInfo),
            password = userInfo.substringAfter(":", ""),
            transport = query["network"] ?: query["transport"] ?: "tcp",
            security = "tls",
            sni = tlsServerName,
            extraJson = query.toJsonString()
        )
    }

    private fun shadowsocksExtra(query: Map<String, String>): Map<String, String> {
        val pluginValue = query["plugin"].orEmpty()
        if (pluginValue.isBlank()) return query
        val parts = pluginValue.split(";")
        val plugin = parts.firstOrNull().orEmpty()
        val pluginOpts = parts.drop(1).joinToString(";")
        return buildMap {
            putAll(query)
            if (plugin.isNotBlank()) put("plugin", plugin)
            if (pluginOpts.isNotBlank()) put("plugin_opts", pluginOpts)
        }
    }

    private fun parseWireGuardUri(source: String, raw: String): ServerProfile {
        val uri = URI(raw)
        val query = parseQuery(uri.rawQuery.orEmpty())
        val host = uri.hostFromAuthority()
        val port = if (uri.port > 0) uri.port else uri.firstPortFromAuthority() ?: 51820
        val fragment = uri.rawFragment?.urlDecode().orEmpty()
        val privateKey = query.firstValue("private_key", "privateKey", "client_private_key", "clientPrivateKey")
            .ifBlank { uri.rawUserInfo?.urlDecode().orEmpty() }
            .ifBlank { uri.userInfoFromAuthority() }
        val publicKey = query.firstValue("public_key", "publicKey", "peer_public_key", "peerPublicKey")
        val address = query.firstValue("address", "addresses", "client_address", "clientAddress")
        val allowedIps = query.firstValue("allowed_ips", "allowedIPs", "allowedips").ifBlank { "0.0.0.0/0, ::/0" }
        val preSharedKey = query.firstValue("preshared_key", "pre_shared_key", "presharedKey", "preSharedKey", "psk")
        val endpoint = query.firstValue("endpoint").ifBlank { listOf(host, port).takeIf { host.isNotBlank() }?.joinToString(":").orEmpty() }
        val rawConfig = buildString {
            appendLine("[Interface]")
            if (privateKey.isNotBlank()) appendLine("PrivateKey = $privateKey")
            if (address.isNotBlank()) appendLine("Address = $address")
            query.firstValue("dns", "DNS").takeIf { it.isNotBlank() }?.let { appendLine("DNS = $it") }
            query.firstValue("mtu", "MTU").takeIf { it.isNotBlank() }?.let { appendLine("MTU = $it") }
            appendLine("[Peer]")
            if (publicKey.isNotBlank()) appendLine("PublicKey = $publicKey")
            if (preSharedKey.isNotBlank()) appendLine("PresharedKey = $preSharedKey")
            if (endpoint.isNotBlank()) appendLine("Endpoint = $endpoint")
            appendLine("AllowedIPs = $allowedIps")
            query.firstValue("reserved", "Reserved").takeIf { it.isNotBlank() }?.let { appendLine("Reserved = $it") }
        }.trim()
        val completeConfig = privateKey.isNotBlank() && publicKey.isNotBlank() && address.isNotBlank() && endpoint.isNotBlank()
        val profile = if (completeConfig) {
            parseWireGuardConfig(source, rawConfig)
        } else {
            parseUri(source, raw, ProtocolType.WIREGUARD)
        }
        return profile.copy(
            displayName = fragment.ifBlank { profile.displayName },
            rawUri = if (completeConfig) rawConfig else raw,
            extraJson = if (completeConfig) rawConfig else query.toJsonString(),
        )
    }

    private fun parseWireGuardConfig(source: String, raw: String): ServerProfile {
        val endpoint = raw.lineSequence()
            .firstOrNull { it.trim().startsWith("Endpoint", ignoreCase = true) }
            ?.substringAfter("=")
            ?.trim()
            .orEmpty()
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = "WireGuard ${endpoint.substringBefore(":").ifBlank { source }}",
            protocol = if (raw.contains("Jc =", true) || raw.contains("Jmin =", true)) ProtocolType.AMNEZIA_WG else ProtocolType.WIREGUARD,
            rawUri = raw,
            host = endpoint.substringBefore(":"),
            port = endpoint.substringAfter(":", "0").toIntOrNull() ?: 0,
            extraJson = raw
        )
    }

    private fun parseIpsecUri(source: String, raw: String): ServerProfile {
        val uri = URI(raw)
        val query = parseQuery(uri.rawQuery.orEmpty())
        val userInfo = uri.rawUserInfo?.urlDecode().orEmpty()
        val host = uri.host.orEmpty()
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = uri.rawFragment?.urlDecode().orEmpty().ifBlank { "IKEv2 ${host.ifBlank { source }}" },
            protocol = ProtocolType.IPSEC,
            rawUri = raw,
            host = host,
            port = if (uri.port > 0) uri.port else 500,
            username = userInfo.substringBefore(":", userInfo).ifBlank { query["username"].orEmpty() },
            password = userInfo.substringAfter(":", "").ifBlank { query["password"].orEmpty() },
            sni = query["serverName"] ?: query["sni"].orEmpty(),
            extraJson = query.toJsonString()
        )
    }

    private fun parseOpenVpnConfig(
        source: String,
        raw: String,
        protocol: ProtocolType = ProtocolType.OPENVPN,
        displayPrefix: String = "OpenVPN",
    ): ServerProfile {
        val remote = raw.lineSequence()
            .map { it.trim() }
            .firstOrNull { it.startsWith("remote ", ignoreCase = true) }
            .orEmpty()
        val parts = remote.split(Regex("\\s+")).filter { it.isNotBlank() }
        val host = parts.getOrNull(1).orEmpty()
        val port = parts.getOrNull(2)?.toIntOrNull() ?: 0
        val proto = raw.lineSequence()
            .map { it.trim() }
            .firstOrNull { it.startsWith("proto ", ignoreCase = true) }
            ?.substringAfter(" ")
            .orEmpty()
        return ServerProfile(
            id = stableId(raw),
            subscriptionId = "",
            displayName = "$displayPrefix ${host.ifBlank { source }}",
            protocol = protocol,
            rawUri = raw,
            host = host,
            port = port,
            transport = proto,
            extraJson = buildMap {
                if (proto.isNotBlank()) put("proto", proto)
            }.toJsonString()
        )
    }

    private fun parseLumenManifest(source: String, root: JsonObject): List<ServerProfile>? {
        if (root.string("schemaVersion") != "lumen.subscription-manifest.v1") return null
        val subscriptionId = (root["subscription"] as? JsonObject)?.string("id").orEmpty()
        val providerName = (root["provider"] as? JsonObject)?.string("name").orEmpty()
        val nodes = root["nodes"] as? JsonArray ?: return emptyList()
        return nodes.flatMap { nodeElement ->
            val node = nodeElement as? JsonObject ?: return@flatMap emptyList()
            val nodeName = node.stringAny("displayName", "name").ifBlank { providerName.ifBlank { "Lumen" } }
            val protocols = node["protocols"] as? JsonArray ?: return@flatMap emptyList()
            protocols.mapNotNull { protocolElement ->
                val protocol = protocolElement as? JsonObject ?: return@mapNotNull null
                lumenProtocolProfile(
                    source = source,
                    subscriptionId = subscriptionId,
                    nodeName = nodeName,
                    protocol = protocol,
                )
            }
        }.distinctBy { it.id }
    }

    private fun lumenProtocolProfile(
        source: String,
        subscriptionId: String,
        nodeName: String,
        protocol: JsonObject,
    ): ServerProfile? {
        val endpoint = protocol["endpoint"] as? JsonObject ?: return null
        val security = protocol["security"] as? JsonObject
        val credentials = protocol["credentials"] as? JsonObject
        val hints = protocol["rendererHints"] as? JsonObject
        val rawType = protocol.stringAny("type", "adapter")
        val type = lumenProtocolType(rawType)
        if (type == ProtocolType.UNKNOWN) return null
        val host = endpoint.string("host")
        val port = endpoint.string("port").toIntOrNull() ?: return null
        val name = hints?.string("name").orEmpty().ifBlank { nodeName }
        if (type == ProtocolType.WIREGUARD || type == ProtocolType.AMNEZIA_WG) {
            val rawConfig = lumenWireGuardConfig(
                protocol = protocol,
                endpoint = endpoint,
                credentials = credentials,
                hints = hints,
                type = type,
            ) ?: return null
            return parseWireGuardConfig(source, rawConfig).copy(
                id = stableId("$subscriptionId|${protocol.string("id")}|$host|$port|$rawType"),
                subscriptionId = subscriptionId,
                displayName = name,
                protocol = type,
                host = host,
                port = port,
                rawUri = rawConfig,
                extraJson = rawConfig,
            )
        }
        if (type == ProtocolType.OPENVPN || type == ProtocolType.OPENVPN_SHADOWSOCKS) {
            val rawConfig = lumenOpenVpnConfig(
                endpoint = endpoint,
                credentials = credentials,
                hints = hints,
                type = type,
            ) ?: return null
            return ServerProfile(
                id = stableId("$subscriptionId|${protocol.string("id")}|$host|$port|$rawType"),
                subscriptionId = subscriptionId,
                displayName = name,
                protocol = type,
                rawUri = rawConfig,
                host = host,
                port = port,
                username = credentials?.stringAny("username", "uuid").orEmpty(),
                password = lumenPassword(type, credentials),
                method = hints?.string("method").orEmpty(),
                transport = endpoint.stringAny("transport", "network").ifBlank { "tcp" },
                security = security?.string("type").orEmpty(),
                extraJson = buildJsonObject {
                    if (type == ProtocolType.OPENVPN_SHADOWSOCKS) put("type", "shadowsocks")
                    hints?.string("method")?.takeIf { it.isNotBlank() }?.let { put("method", it) }
                    credentials?.string("shadowsocksPassword")?.takeIf { it.isNotBlank() }?.let { put("password", it) }
                    credentials?.stringAny("username", "uuid")?.takeIf { it.isNotBlank() }?.let { put("openvpn_username", it) }
                    credentials?.string("password")?.takeIf { it.isNotBlank() }?.let { put("openvpn_password", it) }
                    hints?.string("openvpnRemoteHost")?.takeIf { it.isNotBlank() }?.let { put("openvpn_remote_host", it) }
                    hints?.string("openvpnRemotePort")?.takeIf { it.isNotBlank() }?.let { put("openvpn_remote_port", it) }
                }.toString()
            )
        }
        if (type == ProtocolType.IPSEC) {
            val caCert = hints.stringAnyOrBlank("ikev2CaCert", "caCert", "ca", "ca_cert")
            val serverId = hints.stringAnyOrBlank("ikev2ServerId", "serverId", "server_id")
                .ifBlank { security?.string("serverName").orEmpty() }
                .ifBlank { host }
            return ServerProfile(
                id = stableId("$subscriptionId|${protocol.string("id")}|$host|$port|$rawType"),
                subscriptionId = subscriptionId,
                displayName = name,
                protocol = type,
                rawUri = protocol.toString(),
                host = host,
                port = port,
                username = credentials?.stringAny("username", "uuid").orEmpty(),
                password = credentials?.string("password").orEmpty(),
                transport = endpoint.stringAny("transport", "network").ifBlank { "udp" },
                security = security?.string("type").orEmpty().ifBlank { "tls" },
                sni = serverId,
                extraJson = buildJsonObject {
                    put("server_id", serverId)
                    caCert.takeIf { it.isNotBlank() }?.let { put("ikev2_ca_cert", it) }
                    hints?.string("mtu")?.takeIf { it.isNotBlank() }?.let { put("mtu", it) }
                    hints?.arrayOrString("dns")?.takeIf { it.isNotEmpty() }?.let {
                        put("dns", it.joinToString(","))
                    }
                }.toString()
            )
        }
        val extra = buildJsonObject {
            protocol.string("flow").takeIf { it.isNotBlank() }?.let { put("flow", it) }
            protocol.string("path").takeIf { it.isNotBlank() }?.let { put("path", it) }
            protocol.string("serviceName").takeIf { it.isNotBlank() }?.let { put("serviceName", it) }
            protocol.string("mode").takeIf { it.isNotBlank() }?.let { put("mode", it) }
            hints?.string("method")?.takeIf { it.isNotBlank() }?.let { put("method", it) }
            hints?.string("plugin")?.takeIf { it.isNotBlank() }?.let { put("plugin", it) }
            hints?.stringAnyOrBlank("pluginOpts", "plugin_opts", "plugin-opts")
                ?.takeIf { it.isNotBlank() }
                ?.let { put("plugin_opts", it) }
            hints?.string("obfs")?.takeIf { it.isNotBlank() }?.let { put("obfs", it) }
            credentials?.string("hysteriaObfsPassword")?.takeIf { it.isNotBlank() }?.let { put("obfs_password", it) }
            hints?.string("address")?.takeIf { it.isNotBlank() }?.let { put("address", it) }
            hints?.string("allowedIps")?.takeIf { it.isNotBlank() }?.let { put("allowed_ips", it) }
            hints?.string("mtu")?.takeIf { it.isNotBlank() }?.let { put("mtu", it) }
            security?.string("fingerprint")?.takeIf { it.isNotBlank() }?.let { put("fp", it) }
            security?.string("spiderX")?.takeIf { it.isNotBlank() }?.let { put("spx", it) }
            security?.string("allowInsecure")?.takeIf { it.isNotBlank() }?.let { put("allowInsecure", it) }
            security?.string("pinnedPeerCertSha256")?.takeIf { it.isNotBlank() }?.let { put("pinnedPeerCertSha256", it) }
            security?.arrayOrString("alpn")?.takeIf { it.isNotEmpty() }?.let {
                put("alpn", it.joinToString(","))
            }
        }
        return ServerProfile(
            id = stableId("$subscriptionId|${protocol.string("id")}|$host|$port|$rawType"),
            subscriptionId = subscriptionId,
            displayName = name,
            protocol = type,
            rawUri = protocol.toString(),
            host = host,
            port = port,
            username = credentials?.stringAny("username", "uuid").orEmpty(),
            password = lumenPassword(type, credentials),
            uuid = credentials?.string("uuid").orEmpty(),
            method = hints?.string("method").orEmpty(),
            transport = endpoint.stringAny("transport", "network").ifBlank { "tcp" },
            security = security?.string("type").orEmpty(),
            sni = security?.string("serverName").orEmpty(),
            publicKey = security?.string("publicKey").orEmpty(),
            shortId = security?.string("shortId").orEmpty(),
            extraJson = extra.toString()
        )
    }

    private fun lumenOpenVpnConfig(
        endpoint: JsonObject,
        credentials: JsonObject?,
        hints: JsonObject?,
        type: ProtocolType,
    ): String? {
        val caCert = hints.stringAnyOrBlank("caCert", "ca", "ca_cert")
        if (caCert.isBlank()) return null
        val endpointHost = endpoint.string("host")
        val endpointPort = endpoint.string("port").toIntOrNull() ?: return null
        val remoteHost = if (type == ProtocolType.OPENVPN_SHADOWSOCKS) {
            hints.stringAnyOrBlank("openvpnRemoteHost", "openvpn_remote_host").ifBlank { "127.0.0.1" }
        } else {
            endpointHost
        }
        val remotePort = if (type == ProtocolType.OPENVPN_SHADOWSOCKS) {
            hints.stringAnyOrBlank("openvpnRemotePort", "openvpn_remote_port").toIntOrNull() ?: 1194
        } else {
            endpointPort
        }
        if (remoteHost.isBlank() || remotePort !in 1..65535) return null
        val transport = endpoint.stringAny("transport", "network")
        val proto = if (type == ProtocolType.OPENVPN_SHADOWSOCKS) {
            "tcp"
        } else if (transport.equals("tcp", ignoreCase = true)) {
            "tcp"
        } else {
            "udp"
        }
        return buildString {
            appendLine("client")
            appendLine("dev tun")
            appendLine("proto $proto")
            appendLine("remote $remoteHost $remotePort")
            appendLine("resolv-retry infinite")
            appendLine("nobind")
            appendLine("persist-key")
            appendLine("persist-tun")
            appendLine("remote-cert-tls server")
            appendLine("auth SHA256")
            if (
                credentials?.stringAny("username", "uuid").orEmpty().isNotBlank() &&
                credentials?.string("password").orEmpty().isNotBlank()
            ) {
                appendLine("auth-user-pass")
            }
            appendLine("auth-nocache")
            appendLine("data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305")
            appendLine("verb 3")
            appendLine("<ca>")
            appendLine(caCert.trim())
            appendLine("</ca>")
        }
    }

    private fun lumenWireGuardConfig(
        protocol: JsonObject,
        endpoint: JsonObject,
        credentials: JsonObject?,
        hints: JsonObject?,
        type: ProtocolType,
    ): String? {
        val host = endpoint.string("host")
        val port = endpoint.string("port").toIntOrNull() ?: return null
        val privateKey = credentials.stringAnyOrBlank(
            "wireguardPrivateKey",
            "privateKey",
            "private_key",
            "clientPrivKey",
            "client_priv_key",
            "PrivateKey",
        )
        val security = protocol["security"] as? JsonObject
        val publicKey = security.stringAnyOrBlank("publicKey", "peerPublicKey", "serverPubKey", "PublicKey")
            .ifBlank {
                credentials.stringAnyOrBlank(
                    "peerPublicKey",
                    "serverPubKey",
                    "server_pub_key",
                    "publicKey",
                    "public_key",
                    "PublicKey",
                    "wireguardPublicKey",
                )
            }
        if (host.isBlank() || privateKey.isBlank() || publicKey.isBlank()) return null
        val address = hints.stringAnyOrBlank("address", "clientAddress", "clientIp", "client_ip", "Address")
            .ifBlank { "10.66.0.2/32" }
        val allowedIps = hints.arrayOrStringOrEmpty("allowedIps", "allowed_ips", "AllowedIPs")
            .ifEmpty { listOf("0.0.0.0/0", "::/0") }
        return buildString {
            appendLine("[Interface]")
            appendLine("PrivateKey = $privateKey")
            appendLine("Address = $address")
            hints.stringAnyOrBlank("dns", "DNS").takeIf { it.isNotBlank() }?.let { appendLine("DNS = $it") }
            hints.stringAnyOrBlank("mtu", "MTU").takeIf { it.isNotBlank() }?.let { appendLine("MTU = $it") }
            if (type == ProtocolType.AMNEZIA_WG) {
                for (key in AMNEZIA_WG_KEYS) {
                    if (key in AMNEZIA_WG_JUNK_COUNT_KEYS && !hasValidAmneziaWireGuardJunkCount(protocol, hints)) {
                        continue
                    }
                    protocol.stringAny(key).ifBlank { hints.stringAnyOrBlank(key) }
                        .takeIf { it.isNotBlank() }
                        ?.takeIf { isValidAmneziaWireGuardOption(key, it) }
                        ?.let { appendLine("$key = $it") }
                }
            }
            appendLine()
            appendLine("[Peer]")
            appendLine("PublicKey = $publicKey")
            credentials.stringAnyOrBlank(
                "presharedKey",
                "preshared_key",
                "preSharedKey",
                "pre_shared_key",
                "psk",
                "PresharedKey",
            ).takeIf { it.isNotBlank() }?.let { appendLine("PreSharedKey = $it") }
            appendLine("Endpoint = $host:$port")
            appendLine("AllowedIPs = ${allowedIps.joinToString(", ")}")
            hints.stringAnyOrBlank("persistentKeepalive", "persistent_keepalive", "PersistentKeepalive")
                .takeIf { it.isNotBlank() }
                ?.let { appendLine("PersistentKeepalive = $it") }
        }
    }

    private fun hasValidAmneziaWireGuardJunkCount(protocol: JsonObject, hints: JsonObject?): Boolean =
        AMNEZIA_WG_JUNK_COUNT_KEYS.all { key ->
            val value = protocol.stringAny(key).ifBlank { hints.stringAnyOrBlank(key) }
            isValidAmneziaWireGuardOption(key, value)
        }

    private fun isValidAmneziaWireGuardOption(key: String, value: String): Boolean {
        if (key !in AMNEZIA_WG_POSITIVE_INT_KEYS) return value.isNotBlank()
        return value.toIntOrNull()?.let { it > 0 } == true
    }

    private fun lumenProtocolType(rawType: String): ProtocolType =
        when {
            rawType.startsWith("vless", ignoreCase = true) -> ProtocolType.VLESS
            rawType.startsWith("vmess", ignoreCase = true) -> ProtocolType.VMESS
            rawType.startsWith("trojan", ignoreCase = true) -> ProtocolType.TROJAN
            rawType.startsWith("shadowsocks", ignoreCase = true) -> ProtocolType.SHADOWSOCKS
            rawType.equals("http-proxy", ignoreCase = true) ||
                rawType.equals("http", ignoreCase = true) -> ProtocolType.HTTP_PROXY
            rawType.startsWith("hysteria2", ignoreCase = true) -> ProtocolType.HYSTERIA2
            rawType.startsWith("tuic", ignoreCase = true) -> ProtocolType.TUIC
            rawType.startsWith("naive", ignoreCase = true) -> ProtocolType.NAIVE
            rawType.equals("openvpn-shadowsocks", ignoreCase = true) -> ProtocolType.OPENVPN_SHADOWSOCKS
            rawType.startsWith("openvpn", ignoreCase = true) -> ProtocolType.OPENVPN
            rawType.startsWith("wireguard-amneziawg", ignoreCase = true) -> ProtocolType.AMNEZIA_WG
            rawType.startsWith("wireguard", ignoreCase = true) -> ProtocolType.WIREGUARD
            rawType.startsWith("ikev2", ignoreCase = true) ||
                rawType.startsWith("ipsec", ignoreCase = true) -> ProtocolType.IPSEC
            else -> ProtocolType.UNKNOWN
        }

    private fun lumenPassword(type: ProtocolType, credentials: JsonObject?): String =
        when (type) {
            ProtocolType.SHADOWSOCKS -> credentials?.string("shadowsocksPassword").orEmpty()
            ProtocolType.OPENVPN_SHADOWSOCKS -> credentials?.string("shadowsocksPassword").orEmpty()
            ProtocolType.HTTP_PROXY -> credentials?.string("password").orEmpty()
            ProtocolType.HYSTERIA2 -> credentials?.string("hysteriaPassword").orEmpty()
            else -> credentials?.string("password").orEmpty()
        }

    private fun parseSingBoxJson(source: String, content: String, warnings: MutableList<String>): List<ServerProfile> {
        val element = runCatching { json.parseToJsonElement(content) }.getOrElse {
            warnings.add("Invalid JSON: ${it.message}")
            return emptyList()
        }
        val root = element as? JsonObject ?: return emptyList()
        val outbounds = (root["outbounds"] as? JsonArray)?.toList()
            ?: root.takeIf { it.string("type").isNotBlank() }?.let { listOf(it) }
            ?: return emptyList()
        return outbounds.mapNotNull { item ->
            val obj = item as? JsonObject ?: return@mapNotNull null
            val type = obj.string("type")
            if (type.isBlank()) return@mapNotNull null
            val protocol = when (type.lowercase()) {
                "vless" -> ProtocolType.VLESS
                "vmess" -> ProtocolType.VMESS
                "trojan" -> ProtocolType.TROJAN
                "shadowsocks" -> ProtocolType.SHADOWSOCKS
                "socks" -> ProtocolType.SOCKS
                "http" -> ProtocolType.HTTP_PROXY
                "hysteria" -> ProtocolType.HYSTERIA
                "hysteria2" -> ProtocolType.HYSTERIA2
                "tuic" -> ProtocolType.TUIC
                "naive" -> ProtocolType.NAIVE
                "wireguard" -> ProtocolType.WIREGUARD
                "selector", "urltest", "direct", "block", "dns" -> return@mapNotNull null
                else -> ProtocolType.SING_BOX
            }
            val server = obj.string("server")
            val tls = obj.objectValue("tls")
            val reality = tls?.objectValue("reality")
            val transport = obj.objectValue("transport")
            ServerProfile(
                id = stableId(obj.toString()),
                subscriptionId = "",
                displayName = obj.string("tag").ifBlank { "$type $server" },
                protocol = protocol,
                rawUri = content,
                host = server,
                port = obj.string("server_port").toIntOrNull() ?: 0,
                uuid = obj.string("uuid"),
                username = obj.string("username"),
                password = obj.string("password"),
                method = obj.string("method"),
                transport = transport?.string("type").orEmpty(),
                security = when {
                    reality?.string("public_key").orEmpty().isNotBlank() ||
                        reality?.string("enabled").equals("true", ignoreCase = true) -> "reality"
                    tls != null -> "tls"
                    else -> ""
                },
                sni = tls?.string("server_name").orEmpty(),
                publicKey = reality?.string("public_key").orEmpty(),
                shortId = reality?.string("short_id").orEmpty(),
                path = transport?.string("path").orEmpty(),
                serviceName = transport?.string("service_name").orEmpty()
                    .ifBlank { transport?.string("serviceName").orEmpty() },
                extraJson = obj.toString()
            )
        }
    }

    private fun parseAmneziaJson(source: String, root: JsonObject, warnings: MutableList<String>): List<ServerProfile>? {
        val candidates = mutableListOf<ServerProfile>()
        val description = root.stringAny("description", "name", "serverName").ifBlank { "Amnezia VPN" }

        parseAmneziaContainers(source, root, description, warnings).let { candidates.addAll(it) }

        root.findStringValues("last_config", "lastConfig", "config", "native_config", "nativeConfig").forEach { nested ->
            runCatching { parse(source, nested, description).subscription.servers }
                .onSuccess { candidates.addAll(it) }
                .onFailure { warnings.add("Skipped Amnezia nested config: ${it.message ?: "unknown"}") }
        }

        root.findCloakObjects().forEach { obj ->
            parseCloakJson(source, obj)?.let { candidates.add(it) }
        }

        root.findObjectsWithKeys("hostName", "clientPrivKey", "serverPubKey").forEach { obj ->
            parseAmneziaWireGuardObject(source, obj, description)?.let { candidates.add(it) }
        }
        root.findObjectsWithKeys("hostName", "client_priv_key", "server_pub_key").forEach { obj ->
            parseAmneziaWireGuardObject(source, obj, description)?.let { candidates.add(it) }
        }

        root.findObjectsWithKeys("outbounds").forEach { obj ->
            parseXrayJson(source, obj)?.let { candidates.addAll(it) }
            parseSingBoxJson(source, obj.toString(), warnings).let { candidates.addAll(it) }
        }

        return combineOpenVpnCompounds(candidates).distinctBy { it.id }.takeIf { it.isNotEmpty() }
    }

    private fun combineOpenVpnCompounds(candidates: List<ServerProfile>): List<ServerProfile> {
        val openVpns = candidates.filter { it.protocol == ProtocolType.OPENVPN }
        if (openVpns.isEmpty()) return candidates
        val cloak = candidates.firstOrNull { it.protocol == ProtocolType.OPENVPN_CLOAK && !looksLikeOpenVpnConfig(it.rawUri) }
        val shadowsocks = candidates.firstOrNull { it.protocol == ProtocolType.SHADOWSOCKS }
        val compounds = mutableListOf<ServerProfile>()
        if (cloak != null) {
            compounds += openVpns.map { ovpn ->
                ovpn.copy(
                    id = stableId(ovpn.rawUri + cloak.extraJson),
                    displayName = "OpenVPN over Cloak ${cloak.host.ifBlank { ovpn.host }}",
                    protocol = ProtocolType.OPENVPN_CLOAK,
                    host = cloak.host,
                    port = cloak.port,
                    username = cloak.username,
                    password = cloak.password,
                    method = cloak.method,
                    transport = cloak.transport,
                    security = cloak.security,
                    sni = cloak.sni,
                    publicKey = cloak.publicKey,
                    extraJson = cloak.extraJson,
                )
            }
        }
        if (shadowsocks != null) {
            compounds += openVpns.map { ovpn ->
                ovpn.copy(
                    id = stableId(ovpn.rawUri + shadowsocks.extraJson),
                    displayName = ovpn.displayName.replace("OpenVPN", "OpenVPN over SS"),
                    protocol = ProtocolType.OPENVPN_SHADOWSOCKS,
                    host = shadowsocks.host,
                    port = shadowsocks.port,
                    password = shadowsocks.password,
                    method = shadowsocks.method,
                    extraJson = shadowsocks.extraJson,
                )
            }
        }
        return if (compounds.isEmpty()) candidates else candidates.filterNot {
            it.protocol == ProtocolType.OPENVPN ||
                (it.protocol == ProtocolType.OPENVPN_CLOAK && !looksLikeOpenVpnConfig(it.rawUri))
        } + compounds
    }

    private fun parseAmneziaContainers(
        source: String,
        root: JsonObject,
        description: String,
        warnings: MutableList<String>,
    ): List<ServerProfile> {
        val containers = root["containers"] as? JsonArray ?: return emptyList()
        val out = mutableListOf<ServerProfile>()
        val rootHost = root.stringAny("hostName", "host", "server")
        for (containerElement in containers) {
            val container = containerElement as? JsonObject ?: continue
            val containerName = container.stringAny("container", "name")
            for ((key, value) in container) {
                if (key.equals("container", ignoreCase = true)) continue
                val protocolObject = value as? JsonObject ?: continue
                val nestedName = descriptionForContainer(description, containerName, key)
                parseAmneziaProtocolObject(source, protocolObject, nestedName, containerName, key, rootHost, warnings)
                    .let { out.addAll(it) }
            }
        }
        return out
    }

    private fun parseAmneziaProtocolObject(
        source: String,
        protocolObject: JsonObject,
        description: String,
        containerName: String,
        protocolKey: String,
        rootHost: String,
        warnings: MutableList<String>,
    ): List<ServerProfile> {
        val out = mutableListOf<ServerProfile>()
        parseAmneziaWireGuardObject(source, protocolObject.withFallbackHost(rootHost), description)?.let { out += it }
        parseCloakJson(source, protocolObject)?.let { out += it.copy(displayName = description.replace(protocolKey, "OpenVPN over Cloak")) }

        protocolObject.findStringValues("last_config", "lastConfig", "config", "native_config", "nativeConfig").forEach { nested ->
            val content = nested.trim()
            val parsed = runCatching { parse(source, content, description).subscription.servers }
                .getOrElse {
                    warnings.add("Skipped Amnezia ${containerName.ifBlank { protocolKey }} config: ${it.message ?: "unknown"}")
                    emptyList()
                }
            out += parsed.map { profile ->
                val amendedHost = if (profile.host.isBlank() && rootHost.isNotBlank()) profile.copy(host = rootHost) else profile
                if (isOpenVpnOverShadowSocks(containerName, protocolKey, content) && amendedHost.protocol == ProtocolType.OPENVPN) {
                    amendedHost.copy(
                        displayName = amendedHost.displayName.replace("OpenVPN", "OpenVPN over SS"),
                        protocol = ProtocolType.OPENVPN_SHADOWSOCKS
                    )
                } else {
                    amendedHost
                }
            }
        }
        return out
    }

    private fun JsonObject.withFallbackHost(host: String): JsonObject {
        if (host.isBlank() || stringAny("hostName", "host", "server").isNotBlank()) return this
        return buildJsonObject {
            for ((key, value) in this@withFallbackHost) put(key, value)
            put("hostName", host)
        }
    }

    private fun descriptionForContainer(description: String, containerName: String, protocolKey: String): String {
        val suffix = when {
            containerName.contains("ssxray", ignoreCase = true) || protocolKey.equals("ssxray", true) -> "Shadowsocks"
            containerName.contains("openvpn", ignoreCase = true) -> "OpenVPN"
            containerName.contains("awg", ignoreCase = true) || protocolKey.equals("awg", true) -> "AmneziaWG"
            containerName.contains("wireguard", ignoreCase = true) -> "WireGuard"
            containerName.contains("xray", ignoreCase = true) -> "XRay"
            else -> protocolKey
        }
        return listOf(description, suffix)
            .filter { it.isNotBlank() }
            .distinct()
            .joinToString(" ")
    }

    private fun isOpenVpnOverShadowSocks(containerName: String, protocolKey: String, content: String): Boolean =
        (containerName.contains("shadow", ignoreCase = true) || containerName.contains("ss", ignoreCase = true) ||
            protocolKey.contains("shadow", ignoreCase = true) || protocolKey.contains("ss", ignoreCase = true)) &&
            looksLikeOpenVpnConfig(content)

    private fun parseAmneziaWireGuardObject(source: String, obj: JsonObject, description: String): ServerProfile? {
        val host = obj.stringAny("hostName", "host", "server")
        val port = obj.stringAny("port", "server_port", "serverPort").toIntOrNull() ?: 0
        val privateKey = obj.stringAny("clientPrivKey", "client_priv_key", "privateKey", "private_key", "PrivateKey")
        val address = obj.stringAny("clientIp", "client_ip", "address", "Address")
        val publicKey = obj.stringAny("serverPubKey", "server_pub_key", "publicKey", "public_key", "PublicKey")
        if (host.isBlank() || port <= 0 || privateKey.isBlank() || address.isBlank() || publicKey.isBlank()) return null
        val allowedIps = obj.arrayOrString("allowedIps", "allowed_ips", "AllowedIPs").ifEmpty { listOf("0.0.0.0/0", "::/0") }
        val raw = buildString {
            appendLine("[Interface]")
            appendLine("PrivateKey = $privateKey")
            appendLine("Address = $address")
            obj.stringAny("dns1", "DNS").takeIf { it.isNotBlank() }?.let { appendLine("DNS = $it") }
            obj.stringAny("mtu", "MTU").takeIf { it.isNotBlank() }?.let { appendLine("MTU = $it") }
            for (key in AMNEZIA_WG_KEYS) {
                obj.stringAny(key).takeIf { it.isNotBlank() }?.let { appendLine("$key = $it") }
            }
            appendLine()
            appendLine("[Peer]")
            appendLine("PublicKey = $publicKey")
            obj.stringAny("pskKey", "psk_key", "presharedKey", "preshared_key", "PresharedKey", "PreSharedKey").takeIf { it.isNotBlank() }?.let {
                appendLine("PreSharedKey = $it")
            }
            appendLine("Endpoint = $host:$port")
            appendLine("AllowedIPs = ${allowedIps.joinToString(", ")}")
            obj.stringAny("persistentKeepAlive", "persistent_keep_alive", "PersistentKeepalive").takeIf { it.isNotBlank() }?.let {
                appendLine("PersistentKeepalive = $it")
            }
        }
        return parseWireGuardConfig(source, raw).copy(displayName = description)
    }

    private fun parseXrayJson(source: String, root: JsonObject): List<ServerProfile>? {
        val outbounds = root["outbounds"] as? JsonArray ?: return null
        val servers = outbounds.mapNotNull { item ->
            val outbound = item as? JsonObject ?: return@mapNotNull null
            val protocolName = outbound.stringAny("protocol", "type").lowercase()
            val protocol = when (protocolName) {
                "vless" -> ProtocolType.VLESS
                "vmess" -> ProtocolType.VMESS
                "trojan" -> ProtocolType.TROJAN
                "shadowsocks", "ss" -> ProtocolType.SHADOWSOCKS
                "socks" -> ProtocolType.SOCKS
                "http" -> ProtocolType.HTTP_PROXY
                "hysteria" -> ProtocolType.HYSTERIA
                "hysteria2", "hy2" -> ProtocolType.HYSTERIA2
                "tuic" -> ProtocolType.TUIC
                "naive", "naiveproxy" -> ProtocolType.NAIVE
                else -> return@mapNotNull null
            }
            val settings = outbound["settings"] as? JsonObject
            val stream = outbound["streamSettings"] as? JsonObject
            val vnext = (settings?.get("vnext") as? JsonArray)?.firstOrNull() as? JsonObject
            val serverEntry = (settings?.get("servers") as? JsonArray)?.firstOrNull() as? JsonObject
            val serverObj = vnext ?: serverEntry ?: settings
            val users = (serverObj?.get("users") as? JsonArray)?.firstOrNull() as? JsonObject
            val clients = (settings?.get("clients") as? JsonArray)?.firstOrNull() as? JsonObject
            val streamSecurity = stream?.stringAny("security").orEmpty()
            val reality = stream?.get("realitySettings") as? JsonObject
            val tls = stream?.get("tlsSettings") as? JsonObject
            val hysteria = stream?.get("hysteriaSettings") as? JsonObject
            val tcp = stream?.get("tcpSettings") as? JsonObject
            val ws = stream?.get("wsSettings") as? JsonObject
            val grpc = stream?.get("grpcSettings") as? JsonObject
            val http = stream?.get("httpSettings") as? JsonObject
            val httpUpgrade = stream?.get("httpupgradeSettings") as? JsonObject
                ?: stream?.get("httpUpgradeSettings") as? JsonObject
            val xhttp = stream?.get("xhttpSettings") as? JsonObject
                ?: stream?.get("splithttpSettings") as? JsonObject
                ?: stream?.get("splitHttpSettings") as? JsonObject
            val host = serverObj?.stringAny("address", "server").orEmpty()
            val port = serverObj?.stringAny("port", "server_port", "serverPort")?.toIntOrNull() ?: 0
            if (host.isBlank() || port <= 0) return@mapNotNull null
            val wsHeaders = ws?.get("headers") as? JsonObject
            val httpHeaders = http?.get("headers") as? JsonObject
            val httpUpgradeHeaders = httpUpgrade?.get("headers") as? JsonObject
            val xhttpHeaders = xhttp?.get("headers") as? JsonObject
            val rootTitle = root.stringAny("remarks", "remark", "ps", "name")
            val outboundTitle = outbound.stringAny("name", "remarks").ifBlank {
                outbound.stringAny("tag").takeUnless { it.isTechnicalOutboundTag() }.orEmpty()
            }
            val hysteriaAuth = hysteria?.stringAny("auth", "auth_str", "authString", "password").orEmpty()
                .ifBlank { settings?.stringAny("auth", "auth_str", "authString", "password").orEmpty() }
                .ifBlank { serverObj?.stringAny("auth", "auth_str", "authString", "password").orEmpty() }
                .ifBlank { users?.stringAny("auth", "auth_str", "authString", "pass", "password").orEmpty() }
                .ifBlank { clients?.stringAny("auth", "auth_str", "authString", "pass", "password").orEmpty() }
            val extra = buildMap {
                putIfNotBlank("flow", users?.stringAny("flow").orEmpty())
                putIfNotBlank("packet_encoding", users?.stringAny("packetEncoding", "packet_encoding").orEmpty())
                putIfNotBlank("fp", reality?.stringAny("fingerprint", "fp").orEmpty().ifBlank { tls?.stringAny("fingerprint", "fp").orEmpty() })
                putIfNotBlank("spx", reality?.stringAny("spiderX", "spx").orEmpty())
                putIfNotBlank("alpn", tls?.arrayOrString("alpn")?.joinToString(",").orEmpty())
                putIfNotBlank("allowInsecure", tls?.stringAny("allowInsecure").orEmpty())
                putIfNotBlank("ws-opts.headers.Host", wsHeaders?.stringAny("Host", "host").orEmpty())
                putIfNotBlank("http.host", http?.arrayOrString("host")?.joinToString(",").orEmpty())
                putIfNotBlank("http.path", http?.stringAny("path").orEmpty())
                putIfNotBlank("http.method", http?.stringAny("method").orEmpty())
                putIfNotBlank("httpupgrade.host", httpUpgrade?.stringAny("host").orEmpty())
                putIfNotBlank("httpupgrade.path", httpUpgrade?.stringAny("path").orEmpty())
                putIfNotBlank("xhttp.host", xhttp?.stringAny("host").orEmpty())
                putIfNotBlank("xhttp.path", xhttp?.stringAny("path").orEmpty())
                putIfNotBlank("xhttp.mode", xhttp?.stringAny("mode").orEmpty())
                putIfNotBlank("xhttp.domain_strategy", xhttp?.stringAny("domain_strategy", "domainStrategy").orEmpty())
                putIfNotBlank("xhttp.x_padding_bytes", xhttp?.stringAny("x_padding_bytes", "xPaddingBytes").orEmpty())
                putIfNotBlank("xhttp.sc_max_each_post_bytes", xhttp?.stringAny("sc_max_each_post_bytes", "scMaxEachPostBytes").orEmpty())
                putIfNotBlank("xhttp.sc_min_posts_interval_ms", xhttp?.stringAny("sc_min_posts_interval_ms", "scMinPostsIntervalMs").orEmpty())
                putIfNotBlank("xhttp.sc_stream_up_server_secs", xhttp?.stringAny("sc_stream_up_server_secs", "scStreamUpServerSecs").orEmpty())
                putIfNotBlank("xhttp.noGRPCHeader", xhttp?.stringAny("noGRPCHeader", "no_grpc_header").orEmpty())
                putIfNotBlank("xhttp.noSSEHeader", xhttp?.stringAny("noSSEHeader", "no_sse_header").orEmpty())
                putIfNotBlank("grpc-opts.grpc-service-name", grpc?.stringAny("serviceName").orEmpty())
                putIfNotBlank("auth_str", hysteriaAuth)
                putIfNotBlank("hysteria.version", hysteria?.stringAny("version").orEmpty().ifBlank { settings?.stringAny("version").orEmpty() })
                putIfNotBlank("hysteria.up_mbps", hysteria?.stringAny("up_mbps", "upMbps", "up").orEmpty())
                putIfNotBlank("hysteria.down_mbps", hysteria?.stringAny("down_mbps", "downMbps", "down").orEmpty())
                putIfNotBlank("hysteria.congestion", hysteria?.stringAny("congestion").orEmpty())
                putIfNotBlank("hysteria.obfs", hysteria?.stringAny("obfs").orEmpty())
                appendHeaderValues("ws-opts.headers", wsHeaders)
                appendHeaderValues("http.headers", httpHeaders)
                appendHeaderValues("httpupgrade.headers", httpUpgradeHeaders)
                appendHeaderValues("xhttp.headers", xhttpHeaders)
            }
            ServerProfile(
                id = stableId(outbound.toString()),
                subscriptionId = "",
                displayName = rootTitle.ifBlank { outboundTitle }.ifBlank { "${protocol.name} $host" },
                protocol = protocol,
                rawUri = root.toString(),
                host = host,
                port = port,
                username = users?.stringAny("user", "username", "id", "email").orEmpty(),
                password = hysteriaAuth.ifBlank {
                    users?.stringAny("pass", "password").orEmpty()
                }.ifBlank {
                    serverObj?.stringAny("pass", "password").orEmpty()
                },
                uuid = users?.stringAny("id").orEmpty(),
                method = settings?.stringAny("method", "cipher").orEmpty().ifBlank {
                    serverObj?.stringAny("method", "cipher").orEmpty()
                },
                transport = stream?.stringAny("network").orEmpty(),
                security = streamSecurity,
                sni = reality?.stringAny("serverName", "sni").orEmpty()
                    .ifBlank { tls?.stringAny("serverName", "sni").orEmpty() },
                publicKey = reality?.stringAny("publicKey", "public_key", "pbk").orEmpty(),
                shortId = reality?.arrayOrString("shortId", "shortIds", "short_id", "sid")?.firstOrNull().orEmpty(),
                path = ws?.stringAny("path").orEmpty()
                    .ifBlank { http?.stringAny("path").orEmpty() }
                    .ifBlank { httpUpgrade?.stringAny("path").orEmpty() }
                    .ifBlank { xhttp?.stringAny("path").orEmpty() }
                    .ifBlank { tcp?.stringAny("path").orEmpty() },
                serviceName = grpc?.stringAny("serviceName").orEmpty(),
                extraJson = if (protocol == ProtocolType.HYSTERIA && protocolName == "hysteria") {
                    outbound.toString()
                } else {
                    extra.toJsonString()
                }
            )
        }
        return servers.takeIf { it.isNotEmpty() }
    }

    private fun parseCloakJson(source: String, root: JsonObject): ServerProfile? {
        val remoteHost = root.stringAny("RemoteHost", "remoteHost")
        val remotePort = root.stringAny("RemotePort", "remotePort").toIntOrNull() ?: 0
        val publicKey = root.stringAny("PublicKey", "publicKey")
        val uid = root.stringAny("UID", "uid")
        if (remoteHost.isBlank() || remotePort <= 0 || publicKey.isBlank() || uid.isBlank()) return null
        return ServerProfile(
            id = stableId(root.toString()),
            subscriptionId = "",
            displayName = "OpenVPN over Cloak $remoteHost",
            protocol = ProtocolType.OPENVPN_CLOAK,
            rawUri = root.toString(),
            host = remoteHost,
            port = remotePort,
            username = uid,
            password = uid,
            method = root.stringAny("EncryptionMethod", "encryptionMethod"),
            transport = root.stringAny("Transport", "transport"),
            security = root.stringAny("ProxyMethod", "proxyMethod"),
            sni = root.stringAny("ServerName", "serverName"),
            publicKey = publicKey,
            extraJson = root.toString()
        )
    }

    private fun parseOpenVpnCloakCompound(source: String, root: JsonObject): ServerProfile? {
        val openVpn = root.findOpenVpnConfigs().firstOrNull() ?: return null
        val cloak = root.findCloakObjects().firstOrNull()
            ?: root.takeIf { parseCloakJson(source, it) != null }
            ?: return null
        val base = parseOpenVpnConfig(source, openVpn, ProtocolType.OPENVPN_CLOAK, "OpenVPN over Cloak")
        val remoteHost = cloak.stringAny("RemoteHost", "remoteHost")
        val remotePort = cloak.stringAny("RemotePort", "remotePort").toIntOrNull() ?: base.port
        return base.copy(
            id = stableId(openVpn + cloak.toString()),
            displayName = "OpenVPN over Cloak ${remoteHost.ifBlank { base.host }}",
            host = remoteHost.ifBlank { base.host },
            port = remotePort,
            username = cloak.stringAny("UID", "uid"),
            password = cloak.stringAny("UID", "uid"),
            method = cloak.stringAny("EncryptionMethod", "encryptionMethod"),
            transport = cloak.stringAny("Transport", "transport"),
            security = cloak.stringAny("ProxyMethod", "proxyMethod"),
            sni = cloak.stringAny("ServerName", "serverName"),
            publicKey = cloak.stringAny("PublicKey", "publicKey"),
            extraJson = cloak.toString()
        )
    }

    private fun parseOpenVpnShadowsocksCompound(source: String, root: JsonObject): ServerProfile? {
        val openVpn = root.findOpenVpnConfigs().firstOrNull() ?: return null
        val ss = root.findObjectsWithKeys("type", "server", "password").firstOrNull {
            it.stringAny("type", "protocol").equals("shadowsocks", true) || it.stringAny("type", "protocol").equals("ss", true)
        } ?: return null
        val base = parseOpenVpnConfig(source, openVpn, ProtocolType.OPENVPN_SHADOWSOCKS, "OpenVPN over SS")
        return base.copy(
            id = stableId(openVpn + ss.toString()),
            host = ss.stringAny("server", "address").ifBlank { base.host },
            port = ss.stringAny("server_port", "serverPort", "port").toIntOrNull() ?: base.port,
            password = ss.stringAny("password"),
            method = ss.stringAny("method", "cipher"),
            extraJson = buildJsonObject {
                put("type", "shadowsocks")
                put("server", ss.stringAny("server", "address"))
                put("server_port", ss.stringAny("server_port", "serverPort", "port").toIntOrNull() ?: 0)
                put("method", ss.stringAny("method", "cipher"))
                put("password", ss.stringAny("password"))
            }.toString()
        )
    }

    private fun parseIpsecJson(source: String, root: JsonObject): ServerProfile? {
        val type = root.stringAny("type", "protocol").lowercase()
        if (type !in setOf("ipsec", "ikev2", "ike", "ikev2-eap")) return null
        val remote = root.objectValue("remote")
        val local = root.objectValue("local")
        val host = root.stringAny("server", "host", "address")
            .ifBlank { remote.stringAnyOrBlank("addr", "address", "server", "host") }
        if (host.isBlank()) return null
        val caCert = root.stringAny("ikev2_ca_cert", "ikev2CaCert", "caCert", "ca_cert", "ca")
            .ifBlank { remote.stringAnyOrBlank("cert", "caCert", "ca") }
            .decodeIpsecCertIfNeeded()
        val serverId = root.stringAny("server_id", "serverId", "serverName", "sni")
            .ifBlank { remote.stringAnyOrBlank("id", "server_id", "serverId") }
            .ifBlank { host }
        val username = root.stringAny("username", "user", "login")
            .ifBlank { local.stringAnyOrBlank("eap_id", "eapId", "username", "user") }
        val password = root.stringAny("password", "pass", "secret")
            .ifBlank { local.stringAnyOrBlank("shared_secret", "sharedSecret", "password", "secret") }
        val mtu = root.stringAny("mtu", "MTU")
        val dns = root.arrayOrString("dns", "dns-servers", "dnsServers")
        return ServerProfile(
            id = stableId(root.toString()),
            subscriptionId = "",
            displayName = root.stringAny("name", "tag").ifBlank { "IKEv2 $host" },
            protocol = ProtocolType.IPSEC,
            rawUri = root.toString(),
            host = host,
            port = root.stringAny("port").toIntOrNull()
                ?: remote.stringAnyOrBlank("port").toIntOrNull()
                ?: 500,
            username = username,
            password = password,
            sni = serverId,
            extraJson = buildJsonObject {
                put("server_id", serverId)
                caCert.takeIf { it.isNotBlank() }?.let { put("ikev2_ca_cert", it) }
                mtu.takeIf { it.isNotBlank() }?.let { put("mtu", it) }
                dns.takeIf { it.isNotEmpty() }?.let { put("dns", it.joinToString(",")) }
            }.toString()
        )
    }

    private fun parseClashYaml(source: String, content: String): List<ServerProfile> {
        val servers = mutableListOf<ServerProfile>()
        var current = mutableMapOf<String, String>()
        val keyStack = mutableListOf<Pair<Int, String>>()
        fun flush() {
            if (current.isEmpty()) return
            val normalized = current.normalizedClashProxy()
            val type = current["type"].orEmpty()
            val protocol = when (type.lowercase()) {
                "vless" -> ProtocolType.VLESS
                "vmess" -> ProtocolType.VMESS
                "trojan" -> ProtocolType.TROJAN
                "ss", "shadowsocks" -> ProtocolType.SHADOWSOCKS
                "socks", "socks5", "socks4", "socks4a" -> ProtocolType.SOCKS
                "http" -> ProtocolType.HTTP_PROXY
                "hysteria" -> ProtocolType.HYSTERIA
                "hysteria2", "hy2" -> ProtocolType.HYSTERIA2
                "tuic" -> ProtocolType.TUIC
                "naive", "naiveproxy" -> ProtocolType.NAIVE
                else -> ProtocolType.CLASH
            }
            val server = normalized["server"].orEmpty()
            if (server.isNotBlank()) {
                servers += ServerProfile(
                    id = stableId(normalized.toString()),
                    subscriptionId = "",
                    displayName = normalized["name"].orEmpty().ifBlank { "$type $server" },
                    protocol = protocol,
                    rawUri = content,
                    host = server,
                    port = normalized["port"]?.toIntOrNull() ?: 0,
                    username = normalized["username"].orEmpty(),
                    uuid = normalized["uuid"].orEmpty(),
                    password = normalized["password"].orEmpty(),
                    method = normalized["cipher"].orEmpty(),
                    transport = normalized["network"].orEmpty().ifBlank { normalized["type"].orEmpty() },
                    security = when {
                        normalized["tls"].equals("true", true) -> "tls"
                        normalized["tls"].equals("reality", true) -> "reality"
                        else -> normalized["security"].orEmpty()
                    },
                    sni = normalized["servername"].orEmpty().ifBlank { normalized["sni"].orEmpty() },
                    publicKey = normalized["reality-opts.public-key"].orEmpty()
                        .ifBlank { normalized["reality-opts.public_key"].orEmpty() }
                        .ifBlank { normalized["pbk"].orEmpty() },
                    shortId = normalized["reality-opts.short-id"].orEmpty()
                        .ifBlank { normalized["reality-opts.short_id"].orEmpty() }
                        .ifBlank { normalized["sid"].orEmpty() },
                    path = normalized["ws-opts.path"].orEmpty(),
                    serviceName = normalized["grpc-opts.grpc-service-name"].orEmpty()
                        .ifBlank { normalized["grpc-opts.serviceName"].orEmpty() },
                    extraJson = normalized.toJsonString()
                )
            }
            current = mutableMapOf()
            keyStack.clear()
        }
        content.lines().forEach { line ->
            val noComment = line.substringBefore("#")
            if (noComment.isBlank()) return@forEach
            val indent = line.indexOfFirst { !it.isWhitespace() }.takeIf { it >= 0 } ?: 0
            val startsItem = noComment.trimStart().startsWith("- ")
            val trimmed = noComment.trim().removePrefix("- ").trim()
            if (trimmed.startsWith("name:") && current.isNotEmpty()) flush()
            val idx = trimmed.indexOf(':')
            if (idx > 0) {
                val key = trimmed.substring(0, idx).trim()
                val value = trimmed.substring(idx + 1).trim().trim('"', '\'')
                if (startsItem) {
                    keyStack.clear()
                }
                while (keyStack.isNotEmpty() && keyStack.last().first >= indent) keyStack.removeAt(keyStack.lastIndex)
                val prefix = keyStack.joinToString(".") { it.second }
                if (value.isBlank()) {
                    keyStack += indent to key
                } else {
                    val effectiveKey = listOf(prefix, key).filter { it.isNotBlank() }.joinToString(".")
                    current[effectiveKey] = value
                }
            }
        }
        flush()
        return servers
    }

    private fun Map<String, String>.normalizedClashProxy(): MutableMap<String, String> {
        val normalized = toMutableMap()
        when (normalized["type"].orEmpty().lowercase()) {
            "socks", "socks5" -> normalized.putIfAbsent("version", "5")
            "socks4" -> normalized.putIfAbsent("version", "4")
            "socks4a" -> normalized.putIfAbsent("version", "4a")
            "http" -> normalized.putIfAbsent("network", "tcp")
        }
        normalized["packet-encoding"]?.let { normalized.putIfAbsent("packet_encoding", it) }
        normalized["congestion-controller"]?.let { normalized.putIfAbsent("congestion_control", it) }
        normalized["udp-relay-mode"]?.let { normalized.putIfAbsent("udp_relay_mode", it) }
        normalized["skip-cert-verify"]?.let { normalized.putIfAbsent("allowInsecure", it) }
        normalized["obfs-password"]?.let { normalized.putIfAbsent("obfs_password", it) }
        normalized["ports"]?.let { normalized.putIfAbsent("server_ports", normalizeHysteria2Ports(it)) }
        normalized["mport"]?.let { normalized.putIfAbsent("server_ports", normalizeHysteria2Ports(it)) }
        return normalized
    }

    private fun URI.hysteria2Extra(query: Map<String, String>): Map<String, String> {
        val normalized = query.toMutableMap()
        portSpecFromAuthority()
            ?.takeIf { it.contains(",") || it.contains("-") }
            ?.let { normalized.putIfAbsent("server_ports", normalizeHysteria2Ports(it)) }
        query["mport"]
            ?.takeIf { it.isNotBlank() }
            ?.let { normalized.putIfAbsent("server_ports", normalizeHysteria2Ports(it)) }
        query["hop-interval"]?.let { normalized.putIfAbsent("hop_interval", it) }
        query["obfs-password"]?.let { normalized.putIfAbsent("obfs_password", it) }
        query["pinSHA256"]?.let { normalized.putIfAbsent("pin_sha256", it) }
        return normalized
    }

    private fun URI.hostFromAuthority(): String {
        host?.takeIf { it.isNotBlank() }?.let { return it }
        val server = authorityServerPart()
        if (server.startsWith("[")) return server.substringAfter("[").substringBefore("]").urlDecode()
        return server.substringBefore(":").urlDecode()
    }

    private fun URI.firstPortFromAuthority(): Int? =
        portSpecFromAuthority()
            ?.substringBefore(",")
            ?.substringBefore("-")
            ?.substringBefore(":")
            ?.toIntOrNull()
            ?.takeIf { it in 1..65535 }

    private fun URI.portSpecFromAuthority(): String? {
        val server = authorityServerPart()
        if (server.startsWith("[")) {
            val afterHost = server.substringAfter("]", "")
            return afterHost.takeIf { it.startsWith(":") }?.drop(1)?.takeIf { it.isNotBlank() }
        }
        return server.substringAfter(":", "").takeIf { it.isNotBlank() }
    }

    private fun URI.authorityServerPart(): String =
        rawAuthority.orEmpty().substringAfterLast("@").urlDecode()

    private fun URI.userInfoFromAuthority(): String =
        rawAuthority.orEmpty()
            .takeIf { it.contains("@") }
            ?.substringBeforeLast("@")
            ?.urlDecode()
            .orEmpty()

    private fun normalizeHysteria2Ports(value: String): String =
        value.split(",", " ")
            .map { it.trim().replace("-", ":") }
            .filter { it.isNotBlank() }
            .joinToString(",")

    private fun parseQuery(rawQuery: String): Map<String, String> =
        rawQuery.split("&").filter { it.contains("=") }.associate {
            val key = it.substringBefore("=").urlDecode()
            val value = it.substringAfter("=").urlDecode()
            key to value
        }

    private fun Map<String, String>.firstValue(vararg names: String): String {
        for (name in names) {
            entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.let { return it }
        }
        return ""
    }

    private fun looksLikeOpenVpnConfig(value: String): Boolean {
        val lines = value.lineSequence().map { it.trim() }.filter { it.isNotBlank() }.toList()
        if (lines.isEmpty()) return false
        val hasClient = lines.any { it.equals("client", true) || it.startsWith("client ", true) }
        val hasDev = lines.any { it.equals("dev tun", true) || it.equals("dev tap", true) || it.startsWith("dev tun", true) || it.startsWith("dev tap", true) }
        val hasRemote = lines.any { it.startsWith("remote ", true) }
        return hasClient && (hasDev || hasRemote)
    }

    private fun JsonObject.string(name: String): String = (this[name] as? JsonPrimitive)?.contentOrNull.orEmpty()

    private fun JsonObject.objectValue(name: String): JsonObject? = this[name] as? JsonObject

    private fun JsonObject.stringAny(vararg names: String): String =
        names.firstNotNullOfOrNull { name ->
            (this[name] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
        }.orEmpty()

    private fun JsonObject?.stringAnyOrBlank(vararg names: String): String =
        this?.stringAny(*names).orEmpty()

    private fun JsonObject?.arrayOrStringOrEmpty(vararg names: String): List<String> =
        this?.arrayOrString(*names).orEmpty()

    private fun JsonObject.arrayOrString(vararg names: String): List<String> {
        for (name in names) {
            when (val value = this[name]) {
                is JsonArray -> return value.mapNotNull { (it as? JsonPrimitive)?.contentOrNull?.takeIf { text -> text.isNotBlank() } }
                is JsonPrimitive -> return value.contentOrNull
                    ?.split(",", " ")
                    ?.map { it.trim() }
                    ?.filter { it.isNotBlank() }
                    .orEmpty()
                else -> Unit
            }
        }
        return emptyList()
    }

    private fun String.decodeIpsecCertIfNeeded(): String {
        val value = trim()
        if (value.isBlank() || value.contains("BEGIN CERTIFICATE")) return value
        return runCatching {
            String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8)
        }.getOrDefault(value)
    }

    private fun MutableMap<String, String>.putIfNotBlank(key: String, value: String) {
        if (value.isNotBlank()) this[key] = value
    }

    private fun MutableMap<String, String>.appendHeaderValues(prefix: String, headers: JsonObject?) {
        headers ?: return
        headers.forEach { (key, value) ->
            (value as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }?.let {
                this["$prefix.$key"] = it
            }
        }
    }

    private fun JsonObject.findStringValues(vararg keys: String): List<String> {
        val out = mutableListOf<String>()
        fun walk(element: JsonElement) {
            when (element) {
                is JsonObject -> {
                    for ((key, value) in element) {
                        if (keys.any { it.equals(key, ignoreCase = true) }) {
                            (value as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }?.let { out += it }
                        }
                        walk(value)
                    }
                }
                is JsonArray -> element.forEach(::walk)
                else -> Unit
            }
        }
        walk(this)
        return out.distinct()
    }

    private fun JsonObject.findOpenVpnConfigs(): List<String> {
        val out = mutableListOf<String>()
        fun collect(value: String, depth: Int = 0) {
            val trimmed = value.trim()
            if (looksLikeOpenVpnConfig(trimmed)) {
                out += trimmed
                return
            }
            if (depth >= 3 || !(trimmed.startsWith("{") || trimmed.startsWith("["))) return
            val element = runCatching { json.parseToJsonElement(trimmed) }.getOrNull() ?: return
            if (element is JsonObject) {
                element.findStringValues(
                    "openvpn",
                    "openvpn_config",
                    "openVpnConfig",
                    "ovpn",
                    "ovpn_config",
                    "config",
                    "last_config",
                    "lastConfig",
                    "native_config",
                    "nativeConfig"
                ).forEach { collect(it, depth + 1) }
            }
        }
        findStringValues(
            "openvpn",
            "openvpn_config",
            "openVpnConfig",
            "ovpn",
            "ovpn_config",
            "config",
            "last_config",
            "lastConfig",
            "native_config",
            "nativeConfig"
        ).forEach { collect(it) }
        return out.distinct()
    }

    private fun JsonObject.findCloakObjects(): List<JsonObject> =
        (findObjectsWithKeys("RemoteHost", "RemotePort", "PublicKey", "UID") +
            findObjectsWithKeys("remoteHost", "remotePort", "publicKey", "uid")).distinctBy { it.toString() }

    private fun JsonObject.findObjectsWithKeys(vararg keys: String): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        fun walk(element: JsonElement) {
            when (element) {
                is JsonObject -> {
                    if (keys.all { key -> element.keys.any { it.equals(key, ignoreCase = true) } }) out += element
                    element.values.forEach(::walk)
                }
                is JsonArray -> element.forEach(::walk)
                else -> Unit
            }
        }
        walk(this)
        return out
    }

    private fun decodeBase64OrNull(value: String): String? {
        val cleaned = value.trim().replace("-", "+").replace("_", "/")
        val padded = cleaned + "=".repeat((4 - cleaned.length % 4) % 4)
        return runCatching { String(Base64.getDecoder().decode(padded), StandardCharsets.UTF_8) }.getOrNull()
    }

    private fun String.urlDecode(): String = URLDecoder.decode(this, StandardCharsets.UTF_8.name())

    private fun String.isTechnicalOutboundTag(): Boolean =
        equals("proxy", ignoreCase = true) ||
            equals("direct", ignoreCase = true) ||
            equals("block", ignoreCase = true) ||
            equals("api", ignoreCase = true) ||
            equals("dns", ignoreCase = true)

    private fun stableId(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8))
        return digest.take(12).joinToString("") { "%02x".format(it) }
    }

    private fun Map<String, String>.toJsonString(): String =
        if (isEmpty()) {
            "{}"
        } else {
            json.encodeToString(
                JsonObject.serializer(),
                buildJsonObject {
                    for ((key, value) in this@toJsonString) put(key, value)
                }
            )
        }

    private companion object {
        val PROFILE_URI_PREFIXES = listOf(
            "vless://",
            "mless://",
            "vmess://",
            "trojan://",
            "ss://",
            "socks://",
            "socks5://",
            "http://",
            "hysteria://",
            "hysteria2://",
            "hy2://",
            "tuic://",
            "wireguard://",
            "wg://",
            "ipsec://",
            "ikev2://",
            "sing-box://",
            "nekobox://",
            "nekoray://",
            "clash://",
            "mihomo://",
            "stash://",
            "happ://",
            "hiddify://",
            "v2ray://",
            "v2rayn://",
            "v2rayng://",
            "vpn://",
            "lumen://",
        )

        val AMNEZIA_WG_KEYS = listOf(
            "Jc",
            "Jmin",
            "Jmax",
            "S1",
            "S2",
            "S3",
            "S4",
            "H1",
            "H2",
            "H3",
            "H4",
            "I1",
            "I2",
            "I3",
            "I4",
            "I5",
            "junkPacketCount",
            "junkPacketMinSize",
            "junkPacketMaxSize",
            "initPacketJunkSize",
            "responsePacketJunkSize",
            "initPacketMagicHeader",
            "responsePacketMagicHeader",
            "underloadPacketMagicHeader",
            "transportPacketMagicHeader",
            "cookieReplyPacketJunkSize",
            "transportPacketJunkSize",
            "specialJunk1",
            "specialJunk2",
            "specialJunk3",
            "specialJunk4",
            "specialJunk5"
        )

        val AMNEZIA_WG_POSITIVE_INT_KEYS = setOf(
            "Jc",
            "Jmin",
            "Jmax",
            "S1",
            "S2",
            "S3",
            "S4",
            "junkPacketCount",
            "junkPacketMinSize",
            "junkPacketMaxSize",
            "initPacketJunkSize",
            "responsePacketJunkSize",
            "cookieReplyPacketJunkSize",
            "transportPacketJunkSize",
        )

        val AMNEZIA_WG_JUNK_COUNT_KEYS = setOf("Jc", "Jmin", "Jmax")
    }
}
