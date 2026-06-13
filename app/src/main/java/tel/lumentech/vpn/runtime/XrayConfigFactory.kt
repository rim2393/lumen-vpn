package tel.lumentech.vpn.runtime

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONObject
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile

data class XrayRuntimeConfig(
    val connectedServerAddress: String,
    val connectedServerPort: String,
    val localSocksPort: Int = XrayConfigFactory.DEFAULT_SOCKS_PORT,
    val localHttpPort: Int = XrayConfigFactory.DEFAULT_HTTP_PORT,
    val localApiPort: Int = XrayConfigFactory.DEFAULT_API_PORT,
    val remark: String,
    val fullJsonConfig: String,
    val flowStripped: Boolean = false,
)

data class XrayLatencyBatchConfig(
    val fullJsonConfig: String,
    val httpPortsByServerId: Map<String, Int>,
    val socksPortsByServerId: Map<String, Int>,
)

class XrayConfigFactory {
    fun build(
        profile: ServerProfile,
        settings: RuntimeSettings = RuntimeSettings(),
        stripFlow: Boolean = false,
        localSocksPort: Int = DEFAULT_SOCKS_PORT,
        localHttpPort: Int = DEFAULT_HTTP_PORT,
        localApiPort: Int = DEFAULT_API_PORT,
    ): XrayRuntimeConfig {
        val rawOutbound = profile.rawXrayOutbound()
        require(profile.protocol == ProtocolType.VLESS || profile.protocol == ProtocolType.XRAY || rawOutbound != null) {
            "Xray core is available for VLESS/XRay profiles and raw Xray JSON outbounds only."
        }
        require(profile.host.isNotBlank()) { "Xray profile host is missing." }
        require(profile.port in 1..65535) { "Xray profile port is invalid." }
        require(rawOutbound != null || profile.uuid.isNotBlank() || profile.username.isNotBlank()) { "Xray profile UUID is missing." }

        val root = JSONObject()
            .put("log", JSONObject().put("loglevel", "warning"))
            .put(
                "inbounds",
                JSONArray()
                    .put(socksInbound(localSocksPort))
                    .put(httpInbound(localHttpPort))
                    .put(apiInbound(localApiPort)),
            )
            .put(
                "outbounds",
                JSONArray()
                    .put(proxyOutbound(profile, stripFlow, rawOutbound))
                    .put(JSONObject().put("tag", "direct").put("protocol", "freedom").put("settings", JSONObject().put("domainStrategy", "AsIs")))
                    .put(JSONObject().put("tag", "block").put("protocol", "blackhole").put("settings", JSONObject())),
            )
            .put("dns", JSONObject().put("servers", JSONArray().also { dnsServers(settings).forEach(it::put) }))
            .put(
                "routing",
                JSONObject()
                    .put("domainStrategy", "AsIs")
                    .put("rules", routingRules(settings)),
            )
            .put("stats", JSONObject())
            .put("api", JSONObject().put("tag", "api").put("services", JSONArray().put("StatsService")))
            .put(
                "policy",
                JSONObject()
                    .put(
                        "levels",
                        JSONObject().put(
                            "8",
                            JSONObject()
                                .put("statsUserUplink", true)
                                .put("statsUserDownlink", true),
                        ),
                    )
                    .put(
                        "system",
                        JSONObject()
                            .put("statsInboundUplink", true)
                            .put("statsInboundDownlink", true)
                            .put("statsOutboundUplink", true)
                            .put("statsOutboundDownlink", true),
                    ),
            )

        return XrayRuntimeConfig(
            connectedServerAddress = profile.host,
            connectedServerPort = profile.port.toString(),
            localSocksPort = localSocksPort,
            localHttpPort = localHttpPort,
            localApiPort = localApiPort,
            remark = profile.displayName,
            fullJsonConfig = root.toString(),
            flowStripped = stripFlow,
        )
    }

    fun buildLatencyTestBatch(
        profiles: List<ServerProfile>,
        settings: RuntimeSettings = RuntimeSettings(),
        httpPortsByServerId: Map<String, Int>,
        socksPortsByServerId: Map<String, Int>,
    ): XrayLatencyBatchConfig {
        require(profiles.isNotEmpty()) { "Xray latency batch is empty." }
        val inbounds = JSONArray()
        val outbounds = JSONArray()
        val rules = JSONArray()

        profiles.forEachIndexed { index, profile ->
            val rawOutbound = profile.rawXrayOutbound()
            require(profile.protocol == ProtocolType.VLESS || profile.protocol == ProtocolType.XRAY || rawOutbound != null) {
                "Xray core is available for VLESS/XRay profiles and raw Xray JSON outbounds only."
            }
            require(profile.host.isNotBlank()) { "Xray profile host is missing." }
            require(profile.port in 1..65535) { "Xray profile port is invalid." }
            require(rawOutbound != null || profile.uuid.isNotBlank() || profile.username.isNotBlank()) { "Xray profile UUID is missing." }

            val safeTag = "latency-$index"
            val httpTag = "http-$safeTag"
            val socksTag = "socks-$safeTag"
            val outboundTag = "proxy-$safeTag"
            val httpPort = httpPortsByServerId.getValue(profile.id)
            val socksPort = socksPortsByServerId.getValue(profile.id)

            inbounds
                .put(httpInbound(httpPort).put("tag", httpTag))
                .put(socksInbound(socksPort).put("tag", socksTag))
            outbounds.put(proxyOutbound(profile, stripFlow = false, rawOutbound = rawOutbound).put("tag", outboundTag))
            rules.put(
                JSONObject()
                    .put("type", "field")
                    .put("inboundTag", JSONArray().put(httpTag).put(socksTag))
                    .put("outboundTag", outboundTag),
            )
        }

        outbounds
            .put(JSONObject().put("tag", "direct").put("protocol", "freedom").put("settings", JSONObject().put("domainStrategy", "AsIs")))
            .put(JSONObject().put("tag", "block").put("protocol", "blackhole").put("settings", JSONObject()))

        val root = JSONObject()
            .put("log", JSONObject().put("loglevel", "warning"))
            .put("inbounds", inbounds)
            .put("outbounds", outbounds)
            .put("dns", JSONObject().put("servers", JSONArray().also { dnsServers(settings).forEach(it::put) }))
            .put(
                "routing",
                JSONObject()
                    .put("domainStrategy", "AsIs")
                    .put("rules", rules),
            )

        return XrayLatencyBatchConfig(
            fullJsonConfig = root.toString(),
            httpPortsByServerId = httpPortsByServerId,
            socksPortsByServerId = socksPortsByServerId,
        )
    }

    fun summarize(config: XrayRuntimeConfig): String {
        val root = JSONObject(config.fullJsonConfig)
        val outbound = root.optJSONArray("outbounds")?.optJSONObject(0)
        val stream = outbound?.optJSONObject("streamSettings")
        val reality = stream?.optJSONObject("realitySettings")
        val tls = stream?.optJSONObject("tlsSettings")
        val protocol = outbound?.optString("protocol").orEmpty().ifBlank { "xray" }
        val users = outbound
            ?.optJSONObject("settings")
            ?.optJSONArray("vnext")
            ?.optJSONObject(0)
            ?.optJSONArray("users")
            ?.optJSONObject(0)
        return "$protocol/${stream?.optString("network").orEmpty().ifBlank { "tcp" }}" +
            "/security=${stream?.optString("security").orEmpty().ifBlank { "none" }}" +
            "/flow=${!users?.optString("flow").isNullOrBlank()}" +
            "/flowStripped=${config.flowStripped}" +
            "/sni=${!reality?.optString("serverName").isNullOrBlank() || !tls?.optString("serverName").isNullOrBlank()}" +
            "/spiderX=${!reality?.optString("spiderX").isNullOrBlank()}" +
            "/alpn=${tls?.optJSONArray("alpn")?.length()?.let { it > 0 } ?: false}"
    }

    fun buildOpenVpnShadowsocksBridge(
        profile: ServerProfile,
        targetHost: String,
        targetPort: Int,
        localBridgePort: Int,
    ): XrayRuntimeConfig {
        require(profile.protocol == ProtocolType.OPENVPN_SHADOWSOCKS) {
            "OpenVPN over Shadowsocks bridge requires an OPENVPN_SHADOWSOCKS profile."
        }
        require(profile.host.isNotBlank()) { "Shadowsocks server host is missing." }
        require(profile.port in 1..65535) { "Shadowsocks server port is invalid." }
        require(profile.method.isNotBlank()) { "Shadowsocks method is missing." }
        require(profile.password.isNotBlank()) { "Shadowsocks password is missing." }
        require(targetHost.isNotBlank()) { "OpenVPN target host is missing." }
        require(targetPort in 1..65535) { "OpenVPN target port is invalid." }

        val inboundTag = "openvpn-ss-bridge"
        val root = JSONObject()
            .put("log", JSONObject().put("loglevel", "warning"))
            .put(
                "inbounds",
                JSONArray().put(
                    JSONObject()
                        .put("tag", inboundTag)
                        .put("listen", "127.0.0.1")
                        .put("port", localBridgePort)
                        .put("protocol", "dokodemo-door")
                        .put(
                            "settings",
                            JSONObject()
                                .put("address", targetHost)
                                .put("port", targetPort)
                                .put("network", "tcp"),
                        ),
                ),
            )
            .put(
                "outbounds",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("tag", "proxy")
                            .put("protocol", "shadowsocks")
                            .put(
                                "settings",
                                JSONObject().put(
                                    "servers",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("address", profile.host)
                                            .put("port", profile.port)
                                            .put("method", profile.method)
                                            .put("password", profile.password),
                                    ),
                                ),
                            ),
                    )
                    .put(JSONObject().put("tag", "block").put("protocol", "blackhole").put("settings", JSONObject())),
            )
            .put(
                "routing",
                JSONObject()
                    .put("domainStrategy", "AsIs")
                    .put(
                        "rules",
                        JSONArray().put(
                            JSONObject()
                                .put("type", "field")
                                .put("inboundTag", JSONArray().put(inboundTag))
                                .put("outboundTag", "proxy"),
                        ),
                    ),
            )

        return XrayRuntimeConfig(
            connectedServerAddress = profile.host,
            connectedServerPort = profile.port.toString(),
            localSocksPort = localBridgePort,
            localHttpPort = 0,
            localApiPort = 0,
            remark = profile.displayName,
            fullJsonConfig = root.toString(),
        )
    }

    private fun proxyOutbound(profile: ServerProfile, stripFlow: Boolean, rawOutbound: JSONObject?): JSONObject {
        if (rawOutbound != null) return rawOutbound

        val user = JSONObject()
            .put("id", profile.uuid.ifBlank { profile.username })
            .put("encryption", profile.extraString("encryption").ifBlank { "none" })
            .put("level", 8)
            .put("security", "auto")
        val flow = profile.extraString("flow")
        if (!stripFlow && flow.isNotBlank()) user.put("flow", flow)
        val packetEncoding = profile.extraString("packetEncoding", "packet_encoding")
        if (packetEncoding.isNotBlank() && packetEncoding != "(none)") user.put("packetEncoding", packetEncoding)

        return JSONObject()
            .put("tag", "proxy")
            .put("protocol", "vless")
            .put(
                "settings",
                JSONObject().put(
                    "vnext",
                    JSONArray().put(
                        JSONObject()
                            .put("address", profile.host)
                            .put("port", profile.port)
                            .put("users", JSONArray().put(user)),
                    ),
                ),
            )
            .put("streamSettings", streamSettings(profile))
            .put("mux", JSONObject().put("enabled", false).put("concurrency", 8))
    }

    private fun ServerProfile.rawXrayOutbound(): JSONObject? {
        extraJsonObject().takeIf { it.isRawXrayOutboundFor(this) }?.let {
            return JSONObject(it.toString()).put("tag", "proxy")
        }
        val root = runCatching { JSONObject(rawUri.ifBlank { "{}" }) }.getOrNull() ?: return null
        val outbounds = root.optJSONArray("outbounds") ?: return null
        for (index in 0 until outbounds.length()) {
            val outbound = outbounds.optJSONObject(index) ?: continue
            if (outbound.isRawXrayOutboundFor(this)) {
                return JSONObject(outbound.toString()).put("tag", "proxy")
            }
        }
        return null
    }

    private fun JSONObject.isRawXrayOutboundFor(profile: ServerProfile): Boolean {
        val protocol = optString("protocol").lowercase()
        val expected = when (profile.protocol) {
            ProtocolType.VLESS, ProtocolType.XRAY -> "vless"
            ProtocolType.VMESS -> "vmess"
            ProtocolType.TROJAN -> "trojan"
            ProtocolType.SHADOWSOCKS -> "shadowsocks"
            ProtocolType.SOCKS -> "socks"
            ProtocolType.HYSTERIA -> "hysteria"
            else -> return false
        }
        if (protocol != expected) return false
        if (profile.protocol == ProtocolType.HYSTERIA) {
            val network = optJSONObject("streamSettings")?.optString("network").orEmpty().lowercase()
            if (network != "hysteria") return false
        }
        val settings = optJSONObject("settings")
        val server = settings?.optJSONArray("vnext")?.optJSONObject(0)
            ?: settings?.optJSONArray("servers")?.optJSONObject(0)
            ?: settings
            ?: return false
        val outboundHost = server.optString("address").ifBlank { server.optString("server") }
        val outboundPort = firstPositiveInt(server, "port", "server_port", "serverPort")
        val outboundTag = optString("tag")
        return (profile.host.isBlank() || outboundHost == profile.host) &&
            (profile.port <= 0 || outboundPort == profile.port) &&
            (profile.displayName.isBlank() || outboundTag.isBlank() || outboundTag == profile.displayName || outboundTag.isTechnicalOutboundTag())
    }

    private fun firstPositiveInt(obj: JSONObject, vararg names: String): Int {
        for (name in names) {
            val value = obj.opt(name)
            when (value) {
                is Number -> value.toInt().takeIf { it > 0 }?.let { return it }
                is String -> value.toIntOrNull()?.takeIf { it > 0 }?.let { return it }
            }
        }
        return 0
    }

    private fun streamSettings(profile: ServerProfile): JSONObject {
        val network = normalizedNetwork(profile)
        val security = normalizedSecurity(profile)
        val stream = JSONObject()
            .put("network", network)
            .put("security", security)

        when (network) {
            "ws" -> stream.put(
                "wsSettings",
                JSONObject()
                    .put("path", profile.path.ifBlank { profile.extraString("ws-opts.path", "wsSettings.path", "ws.path").ifBlank { "/" } })
                    .put("headers", hostHeaders(profile, "ws-opts.headers.Host", "wsSettings.headers.Host")),
            )
            "grpc" -> stream.put(
                "grpcSettings",
                JSONObject().put(
                    "serviceName",
                    profile.serviceName.ifBlank {
                        profile.extraString("serviceName", "service_name", "grpc-service-name", "grpc-opts.grpc-service-name", "grpcSettings.serviceName")
                    },
                ),
            )
            "http" -> stream.put(
                "httpSettings",
                JSONObject()
                    .put("host", JSONArray().also { httpHosts(profile).forEach(it::put) })
                    .put("path", profile.path.ifBlank { profile.extraString("http.path", "httpSettings.path", "h2.path").ifBlank { "/" } }),
            )
            "httpupgrade" -> stream.put(
                "httpupgradeSettings",
                JSONObject()
                    .put("host", profile.extraString("host", "httpupgrade.host", "httpupgradeSettings.host").ifBlank { profile.sni })
                    .put("path", profile.path.ifBlank { profile.extraString("httpupgrade.path", "httpupgradeSettings.path").ifBlank { "/" } }),
            )
            "xhttp" -> stream.put(
                "xhttpSettings",
                JSONObject()
                    .put("host", profile.extraString("host", "xhttp.host", "xhttpSettings.host").ifBlank { profile.sni })
                    .put("path", profile.path.ifBlank { profile.extraString("xhttp.path", "xhttpSettings.path").ifBlank { "/" } })
                    .put("mode", profile.extraString("mode", "xhttp.mode", "xhttpSettings.mode").ifBlank { "auto" })
                    .also { xhttp ->
                        profile.extraString("xhttp.domain_strategy", "xhttpSettings.domainStrategy").takeIf { it.isNotBlank() }?.let {
                            xhttp.put("domainStrategy", it)
                        }
                        profile.extraString("xhttp.x_padding_bytes", "xhttpSettings.xPaddingBytes", "xPaddingBytes").takeIf { it.isNotBlank() }?.let {
                            xhttp.put("xPaddingBytes", it)
                        }
                        profile.extraString("xhttp.sc_max_each_post_bytes", "xhttpSettings.scMaxEachPostBytes", "scMaxEachPostBytes").takeIf { it.isNotBlank() }?.let {
                            xhttp.put("scMaxEachPostBytes", it)
                        }
                        profile.extraString("xhttp.sc_min_posts_interval_ms", "xhttpSettings.scMinPostsIntervalMs", "scMinPostsIntervalMs").takeIf { it.isNotBlank() }?.let {
                            xhttp.put("scMinPostsIntervalMs", it)
                        }
                        profile.extraString("xhttp.sc_stream_up_server_secs", "xhttpSettings.scStreamUpServerSecs", "scStreamUpServerSecs").takeIf { it.isNotBlank() }?.let {
                            xhttp.put("scStreamUpServerSecs", it)
                        }
                        profile.extraString("xhttp.noGRPCHeader", "xhttpSettings.noGRPCHeader", "noGRPCHeader").toBooleanStrictOrNull()?.let {
                            xhttp.put("noGRPCHeader", it)
                        }
                        profile.extraString("xhttp.noSSEHeader", "xhttpSettings.noSSEHeader", "noSSEHeader").toBooleanStrictOrNull()?.let {
                            xhttp.put("noSSEHeader", it)
                        }
                        prefixedHeaders(profile, "xhttp.headers.").takeIf { it.length() > 0 }?.let { headers ->
                            xhttp.put("headers", headers)
                        }
                    },
            )
            "tcp" -> {
                val headerType = profile.extraString("headerType", "header_type", "tcp.header.type")
                if (headerType.isNotBlank()) {
                    stream.put("tcpSettings", JSONObject().put("header", JSONObject().put("type", headerType)))
                }
            }
        }

        if (security == "tls") {
            stream.put(
                "tlsSettings",
                JSONObject()
                    .put("serverName", tlsServerName(profile))
                    .also { tls ->
                        profile.extraString(
                            "pinnedPeerCertSha256",
                            "tls.pinnedPeerCertSha256",
                            "tlsSettings.pinnedPeerCertSha256",
                        ).takeIf { it.isNotBlank() }?.let { tls.put("pinnedPeerCertSha256", it) }
                    }
                    .also { tls -> putAlpn(tls, profile, network) },
            )
        }
        if (security == "reality") {
            stream.put(
                "realitySettings",
                JSONObject()
                    .put("show", false)
                    .put("serverName", realityServerName(profile))
                    .put(
                        "fingerprint",
                        profile.extraString(
                            "fp",
                            "fingerprint",
                            "client-fingerprint",
                            "clientFingerprint",
                            "utls.fingerprint",
                            "tls.utls.fingerprint",
                            "realitySettings.fingerprint",
                        ).ifBlank { "chrome" },
                    )
                    .put("publicKey", profile.publicKey.ifBlank {
                        profile.extraString(
                            "pbk",
                            "publicKey",
                            "public_key",
                            "realitySettings.publicKey",
                            "realitySettings.public_key",
                            "reality-opts.public-key",
                            "reality_opts.public_key",
                        )
                    })
                    .put("shortId", profile.shortId.ifBlank {
                        profile.extraString(
                            "sid",
                            "shortId",
                            "short_id",
                            "realitySettings.shortId",
                            "realitySettings.short_id",
                            "reality-opts.short-id",
                            "reality_opts.short_id",
                        )
                    })
                    .put("spiderX", profile.extraString("spx", "spiderX", "realitySettings.spiderX").ifBlank { "/" }),
            )
        }
        return stream
    }

    private fun socksInbound(port: Int): JSONObject =
        JSONObject()
            .put("tag", "socks")
            .put("port", port)
            .put("listen", "127.0.0.1")
            .put("protocol", "socks")
            .put("settings", JSONObject().put("auth", "noauth").put("udp", true).put("userLevel", 8))
            .put("sniffing", JSONObject().put("enabled", true).put("destOverride", JSONArray().put("http").put("tls")))

    private fun httpInbound(port: Int): JSONObject =
        JSONObject()
            .put("tag", "http")
            .put("port", port)
            .put("listen", "127.0.0.1")
            .put("protocol", "http")

    private fun apiInbound(port: Int): JSONObject =
        JSONObject()
            .put("tag", "api")
            .put("port", port)
            .put("listen", "127.0.0.1")
            .put("protocol", "dokodemo-door")
            .put("settings", JSONObject().put("address", "127.0.0.1"))

    private fun routingRules(settings: RuntimeSettings): JSONArray =
        JSONArray()
            .put(JSONObject().put("type", "field").put("inboundTag", JSONArray().put("api")).put("outboundTag", "api"))
            .also { rules ->
                settings.blockDomains.takeIf { it.isNotEmpty() }?.let { domains ->
                    rules.put(JSONObject().put("type", "field").put("domain", JSONArray().also { domains.forEach(it::put) }).put("outboundTag", "block"))
                }
                settings.directDomains.takeIf { it.isNotEmpty() }?.let { domains ->
                    rules.put(JSONObject().put("type", "field").put("domain", JSONArray().also { domains.forEach(it::put) }).put("outboundTag", "direct"))
                }
                settings.proxyDomains.takeIf { it.isNotEmpty() }?.let { domains ->
                    rules.put(JSONObject().put("type", "field").put("domain", JSONArray().also { domains.forEach(it::put) }).put("outboundTag", "proxy"))
                }
            }

    private fun dnsServers(settings: RuntimeSettings): List<String> = when (settings.dnsMode) {
        "google" -> listOf("8.8.8.8", "8.8.4.4")
        "quad9" -> listOf("9.9.9.9", "149.112.112.112")
        "custom" -> settings.customDns.split(",", "\n", " ").map { it.trim().substringBefore(":") }.filter { it.isNotBlank() }
        else -> listOf("1.1.1.1", "1.0.0.1", "8.8.8.8")
    }

    private fun normalizedNetwork(profile: ServerProfile): String =
        profile.transport.ifBlank { profile.extraString("type", "network") }.lowercase().let {
            when (it) {
                "", "tcp", "raw" -> "tcp"
                "websocket" -> "ws"
                "h2" -> "http"
                "http_upgrade" -> "httpupgrade"
                "splithttp", "split-http" -> "xhttp"
                else -> it
            }
        }

    private fun normalizedSecurity(profile: ServerProfile): String =
        profile.security.ifBlank { profile.extraString("security", "tls") }.lowercase().let {
            when (it) {
                "tls", "reality" -> it
                else -> "none"
            }
        }

    private fun tlsServerName(profile: ServerProfile): String =
        profile.extraString("sni", "serverName", "servername", "peer", "tlsSettings.serverName")
            .ifBlank { profile.extraString("host") }
            .ifBlank { profile.sni }
            .ifBlank { profile.host }

    private fun realityServerName(profile: ServerProfile): String =
        profile.extraString("sni", "serverName", "servername", "peer", "tlsSettings.serverName", "realitySettings.serverName")
            .ifBlank { profile.sni }
            .ifBlank { profile.host }

    private fun hostHeaders(profile: ServerProfile, vararg names: String): JSONObject =
        JSONObject().also { headers ->
            profile.extraString(*names).ifBlank { profile.extraString("host") }.takeIf { it.isNotBlank() }?.let {
                headers.put("Host", it)
            }
        }

    private fun httpHosts(profile: ServerProfile): List<String> =
        profile.extraStrings("host", "http.host", "httpSettings.host", "h2.host").ifEmpty {
            listOf(profile.sni.ifBlank { profile.host })
        }

    private fun prefixedHeaders(profile: ServerProfile, prefix: String): JSONObject {
        val extra = profile.extraJsonObject()
        val headers = JSONObject()
        val keys = extra.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            if (key.startsWith(prefix) && key.length > prefix.length) {
                extra.optString(key).takeIf { it.isNotBlank() }?.let {
                    headers.put(key.removePrefix(prefix), it)
                }
            }
        }
        return headers
    }

    private fun putAlpn(tls: JSONObject, profile: ServerProfile, network: String) {
        val alpn = profile.extraStrings("alpn", "tls.alpn", "tlsSettings.alpn").ifEmpty {
            if (network == "xhttp") listOf("h2", "http/1.1") else emptyList()
        }
        if (alpn.isNotEmpty()) tls.put("alpn", JSONArray().also { alpn.forEach(it::put) })
    }

    private fun ServerProfile.extraJsonObject(): JSONObject =
        runCatching { JSONObject(extraJson.ifBlank { "{}" }) }.getOrDefault(JSONObject())

    private fun ServerProfile.extraString(vararg names: String): String {
        val extra = extraJsonObject()
        val query = rawVlessQuery()
        for (name in names) {
            extra.optString(name).takeIf { it.isNotBlank() }?.let { return it }
            val nested = extra.nestedValue(name)
            if (nested is String && nested.isNotBlank()) return nested
            if (nested is JSONArray && nested.length() > 0) return nested.optString(0)
            query[name]?.takeIf { it.isNotBlank() }?.let { return it }
        }
        return ""
    }

    private fun ServerProfile.extraStrings(vararg names: String): List<String> {
        val extra = extraJsonObject()
        val query = rawVlessQuery()
        for (name in names) {
            val value: Any? = if (extra.has(name)) extra.opt(name) else extra.nestedValue(name)
            when (value) {
                is JSONArray -> return buildList {
                    for (index in 0 until value.length()) {
                        value.optString(index).takeIf { it.isNotBlank() }?.let(::add)
                    }
                }
                is String -> return value.split(",").map { it.trim() }.filter { it.isNotBlank() }
            }
            query[name]?.takeIf { it.isNotBlank() }?.let {
                return it.split(",").map(String::trim).filter(String::isNotBlank)
            }
        }
        return emptyList()
    }

    private fun ServerProfile.rawVlessQuery(): Map<String, String> {
        val raw = rawUri.trim()
        if (!raw.startsWith("vless://", ignoreCase = true) && !raw.startsWith("mless://", ignoreCase = true)) {
            return emptyMap()
        }
        val query = raw.substringBefore("#").substringAfter("?", "")
        if (query.isBlank()) return emptyMap()
        return query.split("&").mapNotNull { part ->
            val index = part.indexOf('=')
            if (index <= 0) return@mapNotNull null
            part.substring(0, index).urlDecode() to part.substring(index + 1).urlDecode()
        }.toMap()
    }

    private fun String.urlDecode(): String =
        runCatching { URLDecoder.decode(this, StandardCharsets.UTF_8.name()) }.getOrDefault(this)

    private fun String.isTechnicalOutboundTag(): Boolean =
        equals("proxy", ignoreCase = true) ||
            equals("direct", ignoreCase = true) ||
            equals("block", ignoreCase = true) ||
            equals("api", ignoreCase = true) ||
            equals("dns", ignoreCase = true)

    private fun JSONObject.nestedValue(path: String): Any? {
        if (!path.contains(".")) return null
        var current: Any = this
        for (part in path.split(".")) {
            current = (current as? JSONObject)?.opt(part) ?: return null
        }
        return current
    }

    companion object {
        const val DEFAULT_SOCKS_PORT = 10807
        const val DEFAULT_HTTP_PORT = 10808
        const val DEFAULT_API_PORT = 10809
    }
}

object XrayNativeFiles {
    private const val XRAY_ASSET_GEOIP = "geoip.dat"
    private const val XRAY_ASSET_GEOSITE = "geosite.dat"

    fun prepareAssets(context: Context) {
        listOf(XRAY_ASSET_GEOIP, XRAY_ASSET_GEOSITE).forEach { asset ->
            val output = File(context.filesDir, asset)
            if (output.exists() && output.length() > 0) return@forEach
            runCatching {
                context.assets.open(asset).use { input ->
                    FileOutputStream(output).use { outputStream ->
                        input.copyTo(outputStream)
                    }
                }
            }
        }
    }

    fun prepareExecutable(context: Context, libraryFileName: String): File {
        val source = File(context.applicationInfo.nativeLibraryDir, libraryFileName)
        require(source.exists()) { "Native runtime $libraryFileName is missing." }
        if (source.canExecute()) return source
        val binDir = File(context.filesDir, "bin").apply { mkdirs() }
        val target = File(binDir, libraryFileName)
        if (!target.exists() || target.length() != source.length() || target.lastModified() < source.lastModified()) {
            source.inputStream().use { input ->
                FileOutputStream(target).use { output ->
                    input.copyTo(output)
                }
            }
        }
        target.setReadable(true, false)
        target.setWritable(true, true)
        target.setExecutable(true, false)
        return target
    }
}
