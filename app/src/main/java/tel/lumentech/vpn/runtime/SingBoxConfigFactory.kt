package tel.lumentech.vpn.runtime

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.URI
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile

class SingBoxConfigFactory {
    private val json = Json { prettyPrint = true; ignoreUnknownKeys = true }

    fun build(profile: ServerProfile, settings: RuntimeSettings = RuntimeSettings()): String {
        if (profile.protocol == ProtocolType.SING_BOX && profile.rawUri.trim().startsWith("{")) {
            return ensureTunInbound(profile.rawUri)
        }
        if (profile.protocol == ProtocolType.SING_BOX) {
            error(RuntimeSupport.unsupportedRuntimeMessage(profile.protocol))
        }
        val endpoint = endpoint(profile)
        val outbound = if (endpoint == null) outbound(profile) else null
        val config = buildJsonObject {
            put("log", buildJsonObject { put("level", "info"); put("timestamp", true) })
            put("dns", buildJsonObject {
                put("servers", buildJsonArray {
                    dnsServers(settings).forEach { add(it) }
                })
                put("final", dnsFinal(settings))
                if (!settings.ipv6) put("strategy", "ipv4_only")
            })
            put("inbounds", buildJsonArray {
                add(buildJsonObject {
                    put("type", "tun")
                    put("tag", "tun-in")
                    put("interface_name", "lumen0")
                    put("address", buildJsonArray {
                        add(JsonPrimitive("172.19.0.1/30"))
                        if (settings.ipv6) add(JsonPrimitive("fdfe:dcba:9876::1/126"))
                    })
                    put("mtu", ANDROID_TUN_MTU)
                    put("auto_route", true)
                    put("strict_route", settings.strictRoute)
                    put("stack", "mixed")
                })
            })
            if (endpoint != null) {
                put("endpoints", buildJsonArray { add(endpoint) })
            }
            put("outbounds", buildJsonArray {
                outbound?.let { add(it) }
                if (outbound != null) add(latencyUrlTestOutbound())
                add(buildJsonObject { put("type", "direct"); put("tag", "direct") })
                add(buildJsonObject { put("type", "block"); put("tag", "block") })
            })
            put("route", buildJsonObject {
                put("auto_detect_interface", true)
                put("default_domain_resolver", "local")
                val rules = routeRules(settings)
                if (rules.isNotEmpty()) put("rules", rules)
                val ruleSets = routeRuleSets(settings)
                if (ruleSets.isNotEmpty()) put("rule_set", ruleSets)
                put("final", settings.finalOutbound.takeIf { it in setOf("proxy", "direct", "block") } ?: "proxy")
            })
        }
        return json.encodeToString(JsonObject.serializer(), config)
    }

    fun buildLatencyTestProxy(profile: ServerProfile, settings: RuntimeSettings = RuntimeSettings(), listenPort: Int): String {
        if (profile.protocol == ProtocolType.SING_BOX && profile.rawUri.trim().startsWith("{")) {
            return ensureLocalProxyInbound(profile.rawUri, listenPort)
        }
        if (profile.protocol == ProtocolType.SING_BOX) {
            error(RuntimeSupport.unsupportedRuntimeMessage(profile.protocol))
        }
        val endpoint = if (profile.protocol == ProtocolType.AMNEZIA_WG) endpoint(profile) else null
        val outbound = when (profile.protocol) {
            ProtocolType.WIREGUARD -> wireGuardOutbound(profile)
            ProtocolType.AMNEZIA_WG -> null
            else -> outbound(profile)
        }
        val config = buildJsonObject {
            put("log", buildJsonObject { put("level", "warn"); put("timestamp", false) })
            put("dns", buildJsonObject {
                put("servers", buildJsonArray { add(localDns()) })
                put("final", "local")
                if (!settings.ipv6) put("strategy", "ipv4_only")
            })
            put("inbounds", buildJsonArray { add(localProxyInbound(listenPort)) })
            if (endpoint != null) {
                put("endpoints", buildJsonArray { add(endpoint) })
            }
            put("outbounds", buildJsonArray {
                outbound?.let { add(it) }
                if (outbound != null) add(latencyUrlTestOutbound())
                add(buildJsonObject { put("type", "direct"); put("tag", "direct") })
                add(buildJsonObject { put("type", "block"); put("tag", "block") })
            })
            put("route", buildJsonObject {
                put("auto_detect_interface", true)
                put("default_domain_resolver", "local")
                if (settings.sniff) {
                    put("rules", buildJsonArray {
                        add(buildJsonObject {
                            put("inbound", "latency-in")
                            put("action", "sniff")
                        })
                    })
                }
                put("final", if (outbound != null) LATENCY_URL_TEST_TAG else "proxy")
            })
        }
        return json.encodeToString(JsonObject.serializer(), config)
    }

    fun buildLatencyTestBatch(
        profiles: List<ServerProfile>,
        settings: RuntimeSettings = RuntimeSettings(),
        listenPortsByServerId: Map<String, Int>,
    ): LatencyBatchConfig {
        val taggedOutbounds = profiles.mapIndexedNotNull { index, profile ->
            val tag = "node-$index"
            val outbound = when (profile.protocol) {
                ProtocolType.WIREGUARD -> wireGuardOutbound(profile)
                ProtocolType.AMNEZIA_WG -> null
                ProtocolType.SING_BOX -> if (profile.rawUri.trim().startsWith("{")) {
                    profile.rawUriSingBoxOutbounds().firstOrNull { it.isRawSingBoxOutboundFor(profile) }
                } else {
                    null
                }
                else -> outbound(profile)
            } ?: return@mapIndexedNotNull null
            profile.id to outbound.withTag(tag)
        }
        require(taggedOutbounds.isNotEmpty()) { "No sing-box latency outbounds" }
        val tagsByServerId = taggedOutbounds.associate { (id, outbound) -> id to outbound.string("tag") }
        val config = buildJsonObject {
            put("log", buildJsonObject { put("level", "warn"); put("timestamp", false) })
            put("dns", buildJsonObject {
                put("servers", buildJsonArray { add(localDns()) })
                put("final", "local")
                if (!settings.ipv6) put("strategy", "ipv4_only")
            })
            put("inbounds", buildJsonArray {
                tagsByServerId.forEach { (serverId, tag) ->
                    listenPortsByServerId[serverId]?.let { port ->
                        add(localProxyInbound(port, "latency-in-$tag"))
                    }
                }
            })
            put("outbounds", buildJsonArray {
                taggedOutbounds.forEach { (_, outbound) -> add(outbound) }
                add(buildJsonObject { put("type", "direct"); put("tag", "direct") })
                add(buildJsonObject { put("type", "block"); put("tag", "block") })
            })
            put("route", buildJsonObject {
                put("auto_detect_interface", true)
                put("default_domain_resolver", "local")
                put("rules", buildJsonArray {
                    tagsByServerId.forEach { (_, tag) ->
                        add(buildJsonObject {
                            put("inbound", "latency-in-$tag")
                            put("outbound", tag)
                        })
                    }
                })
                put("final", "direct")
            })
        }
        return LatencyBatchConfig(
            config = json.encodeToString(JsonObject.serializer(), config),
            tagsByServerId = tagsByServerId,
            listenPortsByServerId = listenPortsByServerId.filterKeys(tagsByServerId::containsKey),
        )
    }

    fun summarize(config: String): String = runCatching {
        val root = json.parseToJsonElement(config).jsonObject
        val tun = (root["inbounds"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.firstOrNull { it.string("type") == "tun" }
        val outbounds = (root["outbounds"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.filter { it.string("tag") !in setOf("direct", "block") }
            ?.joinToString(",") { outbound ->
                val tls = outbound["tls"] as? JsonObject
                val reality = tls?.get("reality") as? JsonObject
                val transport = outbound["transport"] as? JsonObject
                val mode = transport?.string("mode").orEmpty().takeIf { it.isNotBlank() }?.let { ":$it" }.orEmpty()
                "${outbound.string("type")}/${transport?.string("type").orEmpty().ifBlank { "tcp" }}$mode" +
                    "/tls=${tls?.string("enabled").orEmpty().ifBlank { "false" }}" +
                    "/sni=${tls?.string("server_name").orEmpty().isNotBlank()}" +
                    "/reality=${reality?.string("enabled").orEmpty().ifBlank { "false" }}"
            }
            .orEmpty()
        val dns = root["dns"] as? JsonObject
        val dnsServers = (dns?.get("servers") as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.joinToString(",") { server ->
                val detour = server.string("detour").takeIf { it.isNotBlank() }?.let { "->$it" }.orEmpty()
                "${server.string("tag")}:${server.string("type")}$detour"
            }
            .orEmpty()
        val route = root["route"] as? JsonObject
        "tunMtu=${tun?.string("mtu").orEmpty().ifBlank { "default" }} stack=${tun?.string("stack").orEmpty().ifBlank { "default" }} " +
            "dnsFinal=${dns?.string("final").orEmpty()} dns=[$dnsServers] routeFinal=${route?.string("final").orEmpty()} out=[$outbounds]"
    }.getOrDefault("runtime summary unavailable")

    fun validate(profile: ServerProfile) {
        when (profile.protocol) {
            ProtocolType.VLESS, ProtocolType.VMESS, ProtocolType.TROJAN,
            ProtocolType.SHADOWSOCKS, ProtocolType.SOCKS, ProtocolType.HTTP_PROXY, ProtocolType.TUIC,
            ProtocolType.NAIVE, ProtocolType.XRAY -> {
                require(profile.host.isNotBlank()) { "Server host is missing" }
                require(profile.port in 1..65535) { "Server port is invalid" }
                if (profile.protocol == ProtocolType.NAIVE) {
                    require(profile.username.isNotBlank() && profile.password.isNotBlank()) {
                        "NaiveProxy username/password is missing"
                    }
                }
            }
            ProtocolType.HYSTERIA, ProtocolType.HYSTERIA2 -> {
                require(profile.host.isNotBlank()) { "Server host is missing" }
                if (profile.protocol == ProtocolType.HYSTERIA2) {
                    require(profile.port in 1..65535 || profile.hysteria2ServerPorts().isNotEmpty()) { "Server port is invalid" }
                    require(profile.hysteria2Auth().isNotBlank()) { "Hysteria2 auth/password is missing" }
                } else {
                    require(profile.port in 1..65535) { "Server port is invalid" }
                    require(profile.hysteriaAuth().isNotBlank()) { "Hysteria auth/password is missing" }
                }
            }
            ProtocolType.WIREGUARD, ProtocolType.AMNEZIA_WG -> {
                require(profile.rawUri.contains("[Interface]", ignoreCase = true) || profile.host.isNotBlank()) {
                    "WireGuard config is incomplete"
                }
            }
            ProtocolType.SING_BOX -> {
                require(profile.rawUri.trim().startsWith("{")) { RuntimeSupport.unsupportedRuntimeMessage(profile.protocol) }
            }
            else -> {
                require(RuntimeSupport.isConnectable(profile.protocol)) {
                    RuntimeSupport.unsupportedRuntimeMessage(profile.protocol)
                }
            }
        }
    }

    private fun endpoint(profile: ServerProfile): JsonObject? =
        when (profile.protocol) {
            ProtocolType.WIREGUARD, ProtocolType.AMNEZIA_WG -> wireGuardEndpoint(profile)
            else -> null
        }

    private fun outbound(profile: ServerProfile): JsonObject {
        validate(profile)
        profile.rawSingBoxOutbound()?.let { return it }
        return when (profile.protocol) {
            ProtocolType.VLESS -> buildJsonObject {
                putBase(profile, "vless")
                put("uuid", profile.uuid)
                profile.extraString("flow").takeIf { it.isNotBlank() }?.let { put("flow", it) }
                profile.extraString("packet_encoding", "packetEncoding").takeIf { it.isNotBlank() && it != "(none)" }?.let {
                    put("packet_encoding", it)
                }
                putTransport(profile)
                putTls(profile)
            }
            ProtocolType.VMESS -> buildJsonObject {
                putBase(profile, "vmess")
                put("uuid", profile.uuid)
                put("security", "auto")
                put("alter_id", 0)
                profile.extraString("packet_encoding", "packetEncoding").takeIf { it.isNotBlank() && it != "(none)" }?.let {
                    put("packet_encoding", it)
                }
                putTransport(profile)
                putTls(profile)
            }
            ProtocolType.TROJAN -> buildJsonObject {
                putBase(profile, "trojan")
                put("password", profile.password.ifBlank { profile.username })
                putTransport(profile)
                putTls(profile, force = true)
            }
            ProtocolType.SHADOWSOCKS -> buildJsonObject {
                putBase(profile, "shadowsocks")
                put("method", profile.method.ifBlank { "2022-blake3-aes-128-gcm" })
                put("password", profile.password)
                profile.extraString("plugin").takeIf { it.isNotBlank() }?.let { put("plugin", it) }
                profile.extraString("plugin_opts", "plugin-opts").takeIf { it.isNotBlank() }?.let { put("plugin_opts", it) }
            }
            ProtocolType.SOCKS -> buildJsonObject {
                putBase(profile, "socks")
                put("version", profile.extraString("version").ifBlank { "5" })
                if (profile.username.isNotBlank()) put("username", profile.username)
                if (profile.password.isNotBlank()) put("password", profile.password)
                profile.extraString("network").takeIf { it.isNotBlank() }?.let { put("network", it) }
            }
            ProtocolType.HTTP_PROXY -> buildJsonObject {
                putBase(profile, "http")
                if (profile.username.isNotBlank()) put("username", profile.username)
                if (profile.password.isNotBlank()) put("password", profile.password)
            }
            ProtocolType.HYSTERIA -> buildJsonObject {
                putBase(profile, "hysteria")
                put("auth_str", profile.hysteriaAuth())
                profile.extraString("up_mbps", "upmbps", "up").toIntOrNull()?.let { put("up_mbps", it) }
                profile.extraString("down_mbps", "downmbps", "down").toIntOrNull()?.let { put("down_mbps", it) }
                profile.extraString("obfs").takeIf { it.isNotBlank() }?.let { put("obfs", it) }
                profile.extraString("recv_window_conn", "recvWindowConn").toIntOrNull()?.let { put("recv_window_conn", it) }
                profile.extraString("recv_window", "recvWindow").toIntOrNull()?.let { put("recv_window", it) }
                profile.extraBoolean("disable_mtu_discovery", "disableMtuDiscovery")?.let { put("disable_mtu_discovery", it) }
                putTls(profile, force = true)
            }
            ProtocolType.HYSTERIA2 -> buildJsonObject {
                val ports = profile.hysteria2ServerPorts()
                put("type", "hysteria2")
                put("tag", "proxy")
                put("server", profile.host)
                if (ports.isEmpty()) put("server_port", profile.port)
                put("password", profile.hysteria2Auth())
                ports.takeIf { it.isNotEmpty() }?.let {
                    put("server_ports", buildJsonArray { ports.forEach { add(JsonPrimitive(it)) } })
                }
                profile.extraString("hop_interval", "hopInterval", "hop-interval").takeIf { it.isNotBlank() }?.let { put("hop_interval", it) }
                profile.extraString("up_mbps", "upmbps", "up").toIntOrNull()?.let { put("up_mbps", it) }
                profile.extraString("down_mbps", "downmbps", "down").toIntOrNull()?.let { put("down_mbps", it) }
                profile.extraString("network").takeIf { it.isNotBlank() }?.let { put("network", it) }
                profile.hysteria2Obfs()?.let { put("obfs", it) }
                putTls(profile, force = true)
            }
            ProtocolType.TUIC -> buildJsonObject {
                putBase(profile, "tuic")
                put("uuid", profile.uuid.ifBlank { profile.username })
                put("password", profile.password)
                profile.extraString("congestion_control", "congestionControl")
                    .ifBlank { "cubic" }
                    .let { put("congestion_control", it) }
                profile.extraString("udp_relay_mode", "udpRelayMode").takeIf { it.isNotBlank() }?.let { put("udp_relay_mode", it) }
                profile.extraString("heartbeat").takeIf { it.isNotBlank() }?.let { put("heartbeat", it) }
                profile.extraBoolean("zero_rtt_handshake", "zeroRttHandshake")?.let { put("zero_rtt_handshake", it) }
                putTls(profile, force = true)
            }
            ProtocolType.NAIVE -> buildJsonObject {
                putBase(profile, "naive")
                put("username", profile.username)
                put("password", profile.password)
                putTls(profile, force = true)
            }
            ProtocolType.WIREGUARD, ProtocolType.AMNEZIA_WG -> error(RuntimeSupport.unsupportedRuntimeMessage(profile.protocol))
            ProtocolType.XRAY -> buildJsonObject {
                putBase(profile, "vless")
                put("uuid", profile.uuid)
                profile.extraString("flow").takeIf { it.isNotBlank() }?.let { put("flow", it) }
                profile.extraString("packet_encoding", "packetEncoding").takeIf { it.isNotBlank() && it != "(none)" }?.let {
                    put("packet_encoding", it)
                }
                putTls(profile, force = true)
                putTransport(profile)
            }
            ProtocolType.SING_BOX -> error(RuntimeSupport.unsupportedRuntimeMessage(profile.protocol))
            else -> error(RuntimeSupport.unsupportedRuntimeMessage(profile.protocol))
        }
    }

    private fun JsonObjectBuilder.putBase(profile: ServerProfile, type: String) {
        put("type", type)
        put("tag", "proxy")
        if (profile.host.isNotBlank()) put("server", profile.host)
        if (profile.port > 0) put("server_port", profile.port)
    }

    private fun ServerProfile.rawSingBoxOutbound(): JsonObject? {
        val raw = extraObject().takeIf { it.isRawSingBoxOutboundFor(this) }
            ?: rawUriSingBoxOutbounds().firstOrNull { it.isRawSingBoxOutboundFor(this) }
            ?: return null
        return buildJsonObject {
            raw.forEach { (key, value) -> put(key, value) }
            put("tag", "proxy")
        }
    }

    private fun ServerProfile.rawUriSingBoxOutbounds(): List<JsonObject> =
        runCatching {
            (json.parseToJsonElement(rawUri).jsonObject["outbounds"] as? JsonArray)
                ?.mapNotNull { it as? JsonObject }
                .orEmpty()
        }.getOrDefault(emptyList())

    private fun JsonObject.isRawSingBoxOutboundFor(profile: ServerProfile): Boolean {
        val type = string("type").lowercase()
        if (type.isBlank() || this["server_port"] == null) return false
        val expected = when (profile.protocol) {
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
        val outboundHost = string("server")
        val outboundPort = string("server_port").toIntOrNull()
        val outboundTag = string("tag")
        return (profile.host.isBlank() || outboundHost == profile.host) &&
            (profile.port <= 0 || outboundPort == profile.port) &&
            (profile.displayName.isBlank() || outboundTag.isBlank() || outboundTag == profile.displayName)
    }

    private fun JsonObjectBuilder.putTls(profile: ServerProfile, force: Boolean = false) {
        val realityPublicKey = profile.publicKey.ifBlank {
            profile.extraString(
                "pbk",
                "public_key",
                "public-key",
                "publicKey",
                "reality.public_key",
                "reality.publicKey",
                "realitySettings.publicKey",
                "reality-opts.public-key",
                "reality-opts.public_key",
                "tls.reality.public_key",
            )
        }
        val tlsEnabled = force ||
            profile.security.equals("tls", true) ||
            profile.security.equals("reality", true) ||
            profile.sni.isNotBlank() ||
            realityPublicKey.isNotBlank()
        if (!tlsEnabled) return
        put("tls", buildJsonObject {
            put("enabled", true)
            val serverName = profile.sni.ifBlank {
                profile.extraString(
                    "servername",
                    "serverName",
                    "sni",
                    "peer",
                    "tls.server_name",
                    "tls.serverName",
                    "tlsSettings.serverName",
                    "realitySettings.serverName",
                    "reality-opts.servername",
                )
            }
            if (serverName.isNotBlank()) put("server_name", serverName)
            profile.extraBoolean(
                "allowInsecure",
                "allow_insecure",
                "skip-cert-verify",
                "skip_cert_verify",
                "insecure",
                "tls.insecure",
                "tlsSettings.allowInsecure",
            )?.let { put("insecure", it) }
            val alpn = profile.extraStrings("alpn", "tls.alpn", "tlsSettings.alpn")
            if (alpn.isNotEmpty()) put("alpn", buildJsonArray { alpn.forEach { add(JsonPrimitive(it)) } })
            val certificatePins = profile.extraStrings(
                "pinSHA256",
                "pin_sha256",
                "pin-sha256",
                "certificate_public_key_sha256",
                "tls.certificate_public_key_sha256",
            )
            if (certificatePins.isNotEmpty()) {
                put("certificate_public_key_sha256", buildJsonArray { certificatePins.forEach { add(JsonPrimitive(it)) } })
            }
            put("utls", buildJsonObject {
                put("enabled", true)
                put(
                    "fingerprint",
                    profile.extraString(
                        "fp",
                        "fingerprint",
                        "client-fingerprint",
                        "clientFingerprint",
                        "realitySettings.fingerprint",
                        "reality-opts.client-fingerprint",
                        "tls.utls.fingerprint",
                    ).ifBlank { "chrome" }
                )
            })
            if (profile.security.equals("reality", true) || realityPublicKey.isNotBlank()) {
                put("reality", buildJsonObject {
                    put("enabled", true)
                    put("public_key", realityPublicKey)
                    val shortId = profile.shortId.ifBlank {
                        profile.extraString(
                            "sid",
                            "short_id",
                            "short-id",
                            "shortId",
                            "reality.short_id",
                            "reality.shortId",
                            "realitySettings.shortId",
                            "reality-opts.short-id",
                            "reality-opts.short_id",
                            "tls.reality.short_id",
                        )
                    }
                    if (shortId.isNotBlank()) put("short_id", shortId)
                })
            }
        })
    }

    private fun JsonObjectBuilder.putTransport(profile: ServerProfile) {
        when (profile.transport.lowercase()) {
            "ws", "websocket" -> put("transport", buildJsonObject {
                put("type", "ws")
                val path = profile.path.ifBlank { profile.extraString("ws-opts.path", "wsSettings.path", "ws.path") }
                if (path.isNotBlank()) put("path", path)
                val headers = profile.transportHeaders(
                    "ws-opts.headers",
                    "wsSettings.headers",
                    "ws.headers",
                )
                val host = profile.extraString(
                    "host",
                    "ws-opts.headers.Host",
                    "ws-opts.headers.host",
                    "wsSettings.headers.Host",
                    "wsSettings.headers.host",
                ).ifBlank { profile.sni }
                if (headers.isNotEmpty() || host.isNotBlank()) {
                    put("headers", buildJsonObject {
                        headers.forEach { (key, value) -> put(key, value) }
                        if (host.isNotBlank() && headers.keys.none { it.equals("Host", true) }) put("Host", host)
                    })
                }
            })
            "grpc" -> put("transport", buildJsonObject {
                put("type", "grpc")
                val service = profile.serviceName.ifBlank {
                    profile.extraString(
                        "serviceName",
                        "service_name",
                        "grpc-service-name",
                        "grpc_service_name",
                        "grpc-opts.grpc-service-name",
                        "grpc-opts.serviceName",
                        "grpcSettings.serviceName",
                    )
                }
                if (service.isNotBlank()) put("service_name", service)
                profile.extraBoolean("multiMode", "multi_mode", "grpc-opts.multi-mode", "grpcSettings.multiMode")?.let {
                    put("multi_mode", it)
                }
            })
            "http", "h2" -> put("transport", buildJsonObject {
                put("type", "http")
                val hosts = profile.extraStrings("host", "http.host", "httpSettings.host", "h2.host")
                    .ifEmpty { profile.sni.takeIf { it.isNotBlank() }?.let(::listOf).orEmpty() }
                if (hosts.isNotEmpty()) put("host", buildJsonArray { hosts.forEach { add(JsonPrimitive(it)) } })
                val path = profile.path.ifBlank { profile.extraString("http.path", "httpSettings.path", "h2.path") }
                if (path.isNotBlank()) put("path", path)
                profile.extraString("method", "http.method", "httpSettings.method").takeIf { it.isNotBlank() }?.let {
                    put("method", it)
                }
                val headers = profile.transportHeaders("http.headers", "httpSettings.headers", "h2.headers")
                if (headers.isNotEmpty()) put("headers", buildJsonObject { headers.forEach { (key, value) -> put(key, value) } })
            })
            "httpupgrade", "http_upgrade" -> put("transport", buildJsonObject {
                put("type", "httpupgrade")
                val path = profile.path.ifBlank {
                    profile.extraString("httpupgrade.path", "httpupgradeSettings.path", "http-upgrade.path")
                }
                if (path.isNotBlank()) put("path", path)
                val host = profile.extraString(
                    "host",
                    "httpupgrade.host",
                    "httpupgradeSettings.host",
                    "http-upgrade.host",
                ).ifBlank { profile.sni }
                if (host.isNotBlank()) put("host", host)
                val headers = profile.transportHeaders("httpupgrade.headers", "httpupgradeSettings.headers", "http-upgrade.headers")
                if (headers.isNotEmpty()) put("headers", buildJsonObject { headers.forEach { (key, value) -> put(key, value) } })
            })
            "xhttp", "splithttp", "split-http" -> put("transport", buildJsonObject {
                put("type", "xhttp")
                put(
                    "mode",
                    profile.extraString(
                        "mode",
                        "xhttp.mode",
                        "xhttpSettings.mode",
                        "splithttp.mode",
                        "splithttpSettings.mode",
                        "splitHttpSettings.mode",
                    ).ifBlank { "auto" }
                )
                val path = profile.path.ifBlank { profile.extraString("xhttp.path", "xhttpSettings.path", "splithttp.path") }
                if (path.isNotBlank()) put("path", path)
                val host = profile.extraString("host", "xhttp.host", "xhttpSettings.host", "splithttp.host").ifBlank { profile.sni }
                if (host.isNotBlank()) put("host", host)
                val headers = profile.transportHeaders("xhttp.headers", "xhttpSettings.headers", "splithttp.headers")
                if (headers.isNotEmpty()) put("headers", buildJsonObject { headers.forEach { (key, value) -> put(key, value) } })
                putXhttpCompatibilityFields(profile)
            })
        }
    }

    private fun JsonObjectBuilder.putXhttpCompatibilityFields(profile: ServerProfile) {
        copyFirstExtraJsonValue(
            profile,
            "domain_strategy",
            "domain_strategy",
            "domainStrategy",
            "xhttp.domain_strategy",
            "xhttp.domainStrategy",
            "xhttpSettings.domainStrategy",
            "splithttp.domain_strategy",
            "splithttpSettings.domainStrategy",
        )
        copyFirstExtraJsonValue(
            profile,
            "x_padding_bytes",
            "x_padding_bytes",
            "xPaddingBytes",
            "xhttp.x_padding_bytes",
            "xhttp.xPaddingBytes",
            "xhttpSettings.xPaddingBytes",
        )
        copyFirstExtraJsonValue(
            profile,
            "sc_max_each_post_bytes",
            "sc_max_each_post_bytes",
            "scMaxEachPostBytes",
            "xhttp.sc_max_each_post_bytes",
            "xhttp.scMaxEachPostBytes",
            "xhttpSettings.scMaxEachPostBytes",
        )
        copyFirstExtraJsonValue(
            profile,
            "sc_min_posts_interval_ms",
            "sc_min_posts_interval_ms",
            "scMinPostsIntervalMs",
            "xhttp.sc_min_posts_interval_ms",
            "xhttp.scMinPostsIntervalMs",
            "xhttpSettings.scMinPostsIntervalMs",
        )
        copyFirstExtraJsonValue(
            profile,
            "sc_stream_up_server_secs",
            "sc_stream_up_server_secs",
            "scStreamUpServerSecs",
            "xhttp.sc_stream_up_server_secs",
            "xhttp.scStreamUpServerSecs",
            "xhttpSettings.scStreamUpServerSecs",
        )
        copyFirstExtraJsonValue(
            profile,
            "no_grpc_header",
            "no_grpc_header",
            "noGRPCHeader",
            "xhttp.noGRPCHeader",
            "xhttpSettings.noGRPCHeader",
        )
        copyFirstExtraJsonValue(
            profile,
            "no_sse_header",
            "no_sse_header",
            "noSSEHeader",
            "xhttp.noSSEHeader",
            "xhttpSettings.noSSEHeader",
        )
    }

    private fun JsonObjectBuilder.copyFirstExtraJsonValue(profile: ServerProfile, outputName: String, vararg inputNames: String) {
        val extra = profile.extraObject()
        for (name in inputNames) {
            val value = extra.valueAt(name) ?: continue
            put(outputName, value)
            return
        }
    }

    private fun wireGuardOutbound(profile: ServerProfile): JsonObject {
        val values = parseWireGuard(profile.rawUri)
        val endpoint = values.firstValue("Endpoint")
        val host = profile.host.ifBlank { endpoint.substringBeforeLast(":") }
        val port = if (profile.port > 0) profile.port else endpoint.substringAfterLast(":", "0").toIntOrNull() ?: 0
        val privateKey = values.firstValue("PrivateKey")
        val publicKey = values.firstValue("PublicKey")
        val preSharedKey = values.firstValue("PreSharedKey", "PresharedKey")
        val localAddresses = values.firstValue("Address").cidrValues()
        val allowedIps = values.firstValue("AllowedIPs", "AllowedIps").cidrValues().ifEmpty { listOf("0.0.0.0/0", "::/0") }
        val reserved = values.firstValue("Reserved").toIntArrayOrNull()
        return buildJsonObject {
            put("type", "wireguard")
            put("tag", "proxy")
            put("server", host)
            put("server_port", port)
            if (privateKey.isNotBlank()) put("private_key", privateKey)
            if (publicKey.isNotBlank()) put("peer_public_key", publicKey)
            if (preSharedKey.isNotBlank()) put("pre_shared_key", preSharedKey)
            put("local_address", buildJsonArray {
                localAddresses.forEach { add(JsonPrimitive(it)) }
            })
            put("peers", buildJsonArray {
                add(buildJsonObject {
                    put("server", host)
                    put("server_port", port)
                    if (publicKey.isNotBlank()) put("public_key", publicKey)
                    if (preSharedKey.isNotBlank()) put("pre_shared_key", preSharedKey)
                    put("allowed_ips", buildJsonArray { allowedIps.forEach { add(JsonPrimitive(it)) } })
                    reserved?.let { bytes -> put("reserved", buildJsonArray { bytes.forEach { add(JsonPrimitive(it)) } }) }
                })
            })
            reserved?.let { bytes -> put("reserved", buildJsonArray { bytes.forEach { add(JsonPrimitive(it)) } }) }
            values.firstValue("MTU").toIntOrNull()?.let { put("mtu", it) }
        }
    }

    private fun wireGuardEndpoint(profile: ServerProfile): JsonObject {
        val values = parseWireGuard(profile.rawUri)
        val amnezia = profile.protocol == ProtocolType.AMNEZIA_WG
        val endpoint = values.firstValue("Endpoint")
        val host = profile.host.ifBlank { endpoint.substringBeforeLast(":") }
        val port = if (profile.port > 0) profile.port else endpoint.substringAfterLast(":", "0").toIntOrNull() ?: 0
        val privateKey = values.firstValue("PrivateKey")
        val publicKey = values.firstValue("PublicKey")
        val preSharedKey = values.firstValue("PreSharedKey", "PresharedKey")
        val localAddresses = values.firstValue("Address").cidrValues()
        val allowedIps = values.firstValue("AllowedIPs", "AllowedIps").cidrValues().ifEmpty { listOf("0.0.0.0/0", "::/0") }
        val reserved = values.firstValue("Reserved").toIntArrayOrNull()
        return buildJsonObject {
            put("type", if (amnezia) "awg" else "wireguard")
            put("tag", "proxy")
            if (!amnezia) {
                put("system", false)
                put("name", "lumen-wg")
            } else {
                put("useIntegratedTun", false)
            }
            if (privateKey.isNotBlank()) put("private_key", privateKey)
            put("address", buildJsonArray {
                localAddresses.forEach { add(JsonPrimitive(it)) }
            })
            put("peers", buildJsonArray {
                add(buildJsonObject {
                    put("address", host)
                    put("port", port)
                    if (publicKey.isNotBlank()) put("public_key", publicKey)
                    if (preSharedKey.isNotBlank()) {
                        put(if (amnezia) "preshared_key" else "pre_shared_key", preSharedKey)
                    }
                    put("allowed_ips", buildJsonArray { allowedIps.forEach { add(JsonPrimitive(it)) } })
                    if (!amnezia) {
                        reserved?.let { bytes -> put("reserved", buildJsonArray { bytes.forEach { add(JsonPrimitive(it)) } }) }
                    }
                })
            })
            values.firstValue("MTU").toIntOrNull()?.let { put("mtu", it) }
            if (amnezia) putAmneziaWireGuardOptions(values)
        }
    }

    private fun parseWireGuard(raw: String): Map<String, String> =
        raw.lines().mapNotNull {
            val idx = it.indexOf('=')
            if (idx <= 0) null else it.substring(0, idx).trim() to it.substring(idx + 1).trim()
        }.toMap()

    private fun JsonObjectBuilder.putAmneziaWireGuardOptions(values: Map<String, String>) {
        AMNEZIA_WG_INT_OPTION_NAMES.forEach { key ->
            values.firstValue(key).toLongOrNull()?.let { put(key.lowercase(), JsonPrimitive(it)) }
        }
        AMNEZIA_WG_STRING_OPTION_NAMES.forEach { key ->
            values.firstValue(key).takeIf { it.isNotBlank() }?.let { put(key.lowercase(), JsonPrimitive(it)) }
        }
    }

    private fun Map<String, String>.firstValue(vararg names: String): String {
        for (name in names) {
            entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.let { return it }
        }
        return ""
    }

    private fun String.csvValues(): List<String> =
        split(",").map { it.trim() }.filter { it.isNotBlank() }

    private fun String.cidrValues(): List<String> =
        csvValues().mapNotNull { raw ->
            val value = raw.trim('"', '\'').trim()
            when {
                value.isBlank() -> null
                "/" in value -> value
                ":" in value -> "$value/128"
                else -> "$value/32"
            }
        }

    private fun String.toIntArrayOrNull(): List<Int>? {
        if (isBlank()) return null
        val parts = trim().trim('[', ']').csvValues().mapNotNull { it.toIntOrNull() }
        return parts.takeIf { it.isNotEmpty() }
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
                    ?.csvValues()
                    .orEmpty()
                else -> Unit
            }
        }
        return emptyList()
    }

    private fun ServerProfile.transportHeaders(vararg names: String): Map<String, String> {
        val extra = extraObject()
        for (name in names) {
            val obj = extra.valueAt(name) as? JsonObject ?: continue
            val headers = obj.mapNotNull { (key, value) ->
                (value as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }?.let { key to it }
            }.toMap()
            if (headers.isNotEmpty()) return headers
        }
        return emptyMap()
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

    private fun JsonObject.string(name: String): String =
        (this[name] as? JsonPrimitive)?.contentOrNull.orEmpty()

    private fun ServerProfile.extraBoolean(vararg names: String): Boolean? {
        val value = extraString(*names).lowercase()
        return when (value) {
            "true", "1", "yes", "on" -> true
            "false", "0", "no", "off" -> false
            else -> null
        }
    }

    private fun ServerProfile.hysteria2Obfs(): JsonObject? {
        val extra = extraObject()
        (extra["obfs"] as? JsonObject)?.let { return it }
        val type = extraString("obfs", "obfs.type", "obfs_type").ifBlank {
            if (extraString("obfs-password", "obfs_password", "obfs.password").isNotBlank()) "salamander" else ""
        }
        val password = extraString("obfs-password", "obfs_password", "obfs.password")
        if (type.isBlank()) return null
        return buildJsonObject {
            put("type", type)
            if (password.isNotBlank()) put("password", password)
        }
    }

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

    private fun ServerProfile.hysteria2ServerPorts(): List<String> =
        extraStrings("server_ports", "serverPorts", "ports", "mport", "multi_port", "multiPort")
            .map { it.replace("-", ":") }
            .filter { it.isNotBlank() }
            .distinct()

    private fun dnsServers(settings: RuntimeSettings): List<JsonObject> = when (settings.dnsMode) {
        "google" -> listOf(httpsDns("google", "8.8.8.8", detour = "proxy"), localDns())
        "quad9" -> listOf(httpsDns("quad9", "9.9.9.9", detour = "proxy"), localDns())
        "system" -> listOf(localDns())
        "custom" -> listOf(customDns(settings.customDns.trim()), localDns()).distinctBy { it.string("tag") }
        else -> listOf(httpsDns("cloudflare", "1.1.1.1", detour = "proxy"), localDns())
    }

    private fun dnsFinal(settings: RuntimeSettings): String = when (settings.dnsMode) {
        "google" -> "google"
        "quad9" -> "quad9"
        "system" -> "local"
        "custom" -> "custom"
        else -> "cloudflare"
    }

    private fun localDns(tag: String = "local"): JsonObject = buildJsonObject {
        put("type", "local")
        put("tag", tag)
    }

    private fun httpsDns(tag: String, server: String, path: String = "/dns-query", detour: String? = null): JsonObject = buildJsonObject {
        put("type", "https")
        put("tag", tag)
        put("server", server)
        put("server_port", 443)
        put("path", path)
        put("tls", buildJsonObject { put("enabled", true) })
        if (!detour.isNullOrBlank()) put("detour", detour)
    }

    private fun udpDns(tag: String, server: String, port: Int = 53, detour: String? = null): JsonObject = buildJsonObject {
        put("type", "udp")
        put("tag", tag)
        put("server", server)
        put("server_port", port)
        if (!detour.isNullOrBlank()) put("detour", detour)
    }

    private fun customDns(raw: String): JsonObject {
        val value = raw.ifBlank { return localDns("custom") }
        if (value.equals("local", ignoreCase = true)) return localDns("custom")
        val uri = runCatching { URI(value) }.getOrNull()
        if (uri?.scheme.equals("https", ignoreCase = true)) {
            return httpsDns(
                tag = "custom",
                server = uri?.host.orEmpty().ifBlank { value.removePrefix("https://").substringBefore("/") },
                path = uri?.rawPath?.takeIf { it.isNotBlank() } ?: "/dns-query",
                detour = "proxy",
            )
        }
        val server = value.substringBefore(":")
        val port = value.substringAfter(":", "53").toIntOrNull() ?: 53
        return udpDns("custom", server, port, detour = "proxy")
    }

    private fun routeRules(settings: RuntimeSettings): JsonArray = buildJsonArray {
        add(dnsHijackRule())
        if (settings.sniff) {
            add(buildJsonObject {
                put("inbound", "tun-in")
                put("action", "sniff")
            })
        }
        addRule(settings.blockDomains, "domain_suffix", "block")
        addRule(settings.blockIps, "ip_cidr", "block")
        addRule(settings.directDomains, "domain_suffix", "direct")
        addRule(settings.directIps, "ip_cidr", "direct")
        addRule(settings.proxyDomains, "domain_suffix", "proxy")
        addRule(settings.proxyIps, "ip_cidr", "proxy")
        addRuleSet(settings.ruleSetUrls, "proxy")
        if (settings.bypassPrivateNetworks) {
            add(buildJsonObject {
                put("ip_cidr", buildJsonArray {
                    listOf(
                        "10.0.0.0/8",
                        "172.16.0.0/12",
                        "192.168.0.0/16",
                        "127.0.0.0/8",
                        "169.254.0.0/16",
                        "224.0.0.0/4",
                        "fc00::/7",
                        "fe80::/10",
                    ).forEach { add(JsonPrimitive(it)) }
                })
                put("outbound", "direct")
            })
        }
    }

    private fun JsonArrayBuilder.addRule(values: List<String>, key: String, outbound: String) {
        val cleaned = values.map { it.trim() }.filter { it.isNotBlank() }.distinct()
        if (cleaned.isEmpty()) return
        add(buildJsonObject {
            put(key, buildJsonArray { cleaned.forEach { add(JsonPrimitive(it)) } })
            put("outbound", outbound)
        })
    }

    private fun routeRuleSets(settings: RuntimeSettings): JsonArray = buildJsonArray {
        settings.ruleSetUrls
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
            .forEachIndexed { index, url ->
                add(buildJsonObject {
                    put("type", "remote")
                    put("tag", routeRuleSetTag(index, url))
                    put("format", if (url.endsWith(".srs", ignoreCase = true)) "binary" else "source")
                    put("url", url)
                    put("download_detour", "proxy")
                })
            }
    }

    private fun JsonArrayBuilder.addRuleSet(urls: List<String>, outbound: String) {
        val tags = urls
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinct()
            .mapIndexed(::routeRuleSetTag)
        if (tags.isEmpty()) return
        add(buildJsonObject {
            put("rule_set", buildJsonArray { tags.forEach { add(JsonPrimitive(it)) } })
            put("outbound", outbound)
        })
    }

    private fun routeRuleSetTag(index: Int, url: String): String =
        "remote-rules-$index-" + url
            .substringAfter("://", url)
            .substringBefore("/")
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .ifBlank { "custom" }

    private fun ensureTunInbound(raw: String): String {
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrElse { return raw }
        val existingInbounds = root["inbounds"] as? JsonArray
        val hasTunInbound = existingInbounds?.any {
            (it as? JsonObject)?.get("type")?.jsonPrimitive?.contentOrNull == "tun"
        } == true
        val existingRoute = root["route"] as? JsonObject
        val existingRules = existingRoute?.get("rules") as? JsonArray
        val finalOutbound = existingRoute?.string("final")
            ?.takeIf { it.isNotBlank() }
            ?: primaryOutboundTag(root)
            ?: "direct"
        val amended = buildJsonObject {
            root.forEach { (key, value) ->
                if (key !in setOf("dns", "inbounds", "route")) put(key, value)
            }
            put("dns", root["dns"] ?: defaultDnsConfig())
            put("inbounds", buildJsonArray {
                if (!hasTunInbound) add(defaultTunInbound())
                existingInbounds?.forEach { add(it) }
            })
            put("route", buildJsonObject {
                existingRoute?.forEach { (key, value) -> put(key, value) }
                if (existingRoute?.get("default_domain_resolver") == null) put("default_domain_resolver", "local")
                put("rules", buildJsonArray {
                    if (existingRules?.hasDnsHijackRule() != true) add(dnsHijackRule())
                    if (existingRules?.hasSniffRule() != true) add(sniffRule())
                    existingRules?.forEach { add(it) }
                })
                if (existingRoute?.get("final") == null) put("final", finalOutbound)
            })
        }
        return json.encodeToString(JsonObject.serializer(), amended)
    }

    private fun ensureLocalProxyInbound(raw: String, listenPort: Int): String {
        val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrElse { return raw }
        val existingRoute = root["route"] as? JsonObject
        val existingRules = existingRoute?.get("rules") as? JsonArray
        val finalOutbound = existingRoute?.string("final")
            ?.takeIf { it.isNotBlank() }
            ?: primaryOutboundTag(root)
            ?: "direct"
        val amended = buildJsonObject {
            root.forEach { (key, value) ->
                if (key !in setOf("dns", "inbounds", "route")) put(key, value)
            }
            put("dns", root["dns"] ?: defaultDnsConfig())
            put("inbounds", buildJsonArray { add(localProxyInbound(listenPort)) })
            put("route", buildJsonObject {
                existingRoute?.forEach { (key, value) ->
                    if (key != "rules") put(key, value)
                }
                if (existingRoute?.get("default_domain_resolver") == null) put("default_domain_resolver", "local")
                put("rules", buildJsonArray {
                    add(buildJsonObject {
                        put("inbound", "latency-in")
                        put("action", "sniff")
                    })
                    existingRules?.forEach { add(it) }
                })
                put("final", finalOutbound)
            })
        }
        return json.encodeToString(JsonObject.serializer(), amended)
    }

    private fun localProxyInbound(listenPort: Int, tag: String = "latency-in"): JsonObject = buildJsonObject {
        put("type", "mixed")
        put("tag", tag)
        put("listen", "127.0.0.1")
        put("listen_port", listenPort)
    }

    private fun latencyUrlTestOutbound(outboundTags: List<String> = listOf("proxy")): JsonObject = buildJsonObject {
        put("type", "urltest")
        put("tag", LATENCY_URL_TEST_TAG)
        put("outbounds", buildJsonArray { outboundTags.forEach { add(JsonPrimitive(it)) } })
        put("url", "https://www.gstatic.com/generate_204")
        put("interval", "10m")
        put("tolerance", 50)
    }

    private fun dnsHijackRule(): JsonObject = buildJsonObject {
        put("port", 53)
        put("action", "hijack-dns")
    }

    private fun sniffRule(): JsonObject = buildJsonObject {
        put("inbound", "tun-in")
        put("action", "sniff")
    }

    private fun defaultTunInbound(): JsonObject = buildJsonObject {
        put("type", "tun")
        put("tag", "tun-in")
        put("interface_name", "lumen0")
        put("address", buildJsonArray { add(JsonPrimitive("172.19.0.1/30")) })
        put("mtu", ANDROID_TUN_MTU)
        put("auto_route", true)
        put("stack", "mixed")
    }

    private fun defaultDnsConfig(): JsonObject = buildJsonObject {
        put("servers", buildJsonArray {
            add(httpsDns("cloudflare", "1.1.1.1", detour = "proxy"))
            add(localDns())
        })
        put("final", "cloudflare")
        put("strategy", "ipv4_only")
    }

    private fun primaryOutboundTag(root: JsonObject): String? =
        (root["outbounds"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            ?.mapNotNull { it.string("tag").takeIf(String::isNotBlank) }
            ?.firstOrNull { it !in setOf("direct", "block", "dns-out") }

    private fun JsonObject.withTag(tag: String): JsonObject = buildJsonObject {
        forEach { (key, value) -> put(key, value) }
        put("tag", tag)
    }

    private fun JsonArray.hasDnsHijackRule(): Boolean = any { rule ->
        val item = rule as? JsonObject ?: return@any false
        item.string("action").equals("hijack-dns", ignoreCase = true)
    }

    private fun JsonArray.hasSniffRule(): Boolean = any { rule ->
        val item = rule as? JsonObject ?: return@any false
        item.string("inbound") == "tun-in" &&
            item.string("action").equals("sniff", ignoreCase = true)
    }

    private companion object {
        private const val ANDROID_TUN_MTU = 1500
        private const val LATENCY_URL_TEST_TAG = "latency-urltest"
        val AMNEZIA_WG_INT_OPTION_NAMES = listOf("Jc", "Jmin", "Jmax", "S1", "S2", "S3", "S4")
        val AMNEZIA_WG_STRING_OPTION_NAMES = listOf("H1", "H2", "H3", "H4", "I1", "I2", "I3", "I4", "I5")
    }
}

data class LatencyBatchConfig(
    val config: String,
    val tagsByServerId: Map<String, String>,
    val listenPortsByServerId: Map<String, Int>,
)

private typealias JsonObjectBuilder = kotlinx.serialization.json.JsonObjectBuilder
private typealias JsonArrayBuilder = kotlinx.serialization.json.JsonArrayBuilder
