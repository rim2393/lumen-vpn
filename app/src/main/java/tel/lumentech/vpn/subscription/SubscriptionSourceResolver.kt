package tel.lumentech.vpn.subscription

import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.dnsoverhttps.DnsOverHttps
import tel.lumentech.vpn.BuildConfig
import tel.lumentech.vpn.security.LumenHttpSecurity

class SubscriptionSourceResolver(
    private val http: OkHttpClient = OkHttpClient.Builder()
        .certificatePinner(LumenHttpSecurity.certificatePinner)
        .dns(SubscriptionDns)
        .retryOnConnectionFailure(true)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build(),
    private val fetchOverride: ((String) -> String)? = null,
    private val hwidProvider: (() -> String)? = null,
) {
    fun resolve(source: String, content: String): ResolvedSubscriptionSource {
        val normalized = unwrap(content.trim())
        AmneziaQrCodec.decodeNativeConfig(normalized.content)?.let { decoded ->
            return ResolvedSubscriptionSource(
                source = normalized.source,
                content = decoded,
                name = normalized.name ?: "Amnezia VPN"
            )
        }
        if (normalized.content.startsWith("happ://crypt", ignoreCase = true)) {
            error("Encrypted Happ QR is not decodable without Happ private client keys. Use the standard subscription URL from cabinet/bot.")
        }
        if (normalized.content.isRemoteHttpUrl()) {
            val url = normalized.content.stripFragment()
            requireHttpsSubscriptionUrl(url)
            val body = fetchSubscription(url)
            return ResolvedSubscriptionSource(
                source = url,
                content = body,
                name = normalized.name ?: normalized.content.fragmentName() ?: "QR subscription"
            )
        }
        return ResolvedSubscriptionSource(
            source = source,
            content = normalized.content,
            name = normalized.name
        )
    }

    internal fun unwrap(raw: String): ResolvedSubscriptionSource {
        var current = raw.trim().trim('\uFEFF')
        var name: String? = current.fragmentName()

        repeat(6) {
            LumenDeepLink.parse(current)?.let { payload ->
                name = name ?: payload.name
                if (payload.content != current) {
                    current = payload.content
                    return@repeat
                }
            }

            val token = extractSupportedToken(current)
            if (token != null && token != current) {
                current = token
                name = name ?: current.fragmentName()
            }

            val uri = current.toUriOrNull() ?: return@repeat
            val scheme = uri.scheme?.lowercase().orEmpty()
            val fromQuery = if (scheme in setOf("clash", "clashmeta", "mihomo", "stash")) {
                uri.firstStructuredQueryValue("url", "uri", "link", "config", "sub", "subscription")
                    ?: uri.firstQueryValue("url", "uri", "link", "config", "sub", "subscription")
            } else {
                uri.firstQueryValue("url", "uri", "link", "config", "sub", "subscription")
            }
            if (!fromQuery.isNullOrBlank()) {
                name = name ?: uri.rawFragment?.urlDecode()
                current = fromQuery
                return@repeat
            }

            val fromPath = when (scheme) {
                "vpn" -> return ResolvedSubscriptionSource("vpn://", current, name ?: "Amnezia VPN")
                "hiddify" -> unwrapHiddifyImport(current) ?: uri.knownPayloadPath()
                "happ" -> uri.knownPayloadPath()
                "karing" -> uri.knownPayloadPath()
                "sing-box" -> unwrapPathAfterHost(current, "import-remote-profile") ?: uri.knownPayloadPath()
                "nekobox", "nekoray" -> uri.knownPayloadPath()
                "lumen" -> unwrapPathAfterHost(current, "import") ?: uri.knownPayloadPath()
                "v2ray", "v2rayn", "v2rayng" -> unwrapPathAfterHost(current, "install-sub") ?: uri.knownPayloadPath()
                "clash", "mihomo", "stash" -> uri.knownPayloadPath()
                else -> null
            }
            if (!fromPath.isNullOrBlank()) {
                name = name ?: uri.rawFragment?.urlDecode()
                current = fromPath
                return@repeat
            }

            return ResolvedSubscriptionSource("qr", current, name)
        }

        return ResolvedSubscriptionSource("qr", current, name)
    }

    private fun fetchSubscription(url: String): String {
        val startUrl = requireHttpsSubscriptionUrl(url)
        val hwid = hwidProvider?.invoke()?.trim().orEmpty()
        val attachHwid = LumenHttpSecurity.canAttachDeviceId(startUrl.host)
        val candidateStartUrls = listOfNotNull(startUrl.lumenNativePreferredUrl(), startUrl).distinct()
        val firstRequestUrl = candidateStartUrls.first().toRequestUrl(hwid.takeIf { attachHwid }.orEmpty())
        fetchOverride?.let { return it(firstRequestUrl.toString()).trim() }
        var lastError: Throwable? = null
        val bodies = mutableListOf<String>()
        for (candidateUrl in candidateStartUrls) {
            for (userAgent in HAPP_COMPATIBLE_USER_AGENTS) {
                runCatching {
                    executeSubscriptionRequest(
                        startUrl = candidateUrl,
                        userAgent = userAgent,
                        hwid = hwid,
                        attachHwid = attachHwid,
                    )
                }.onSuccess { body ->
                    body?.takeIf { it.isNotBlank() }?.let { bodies += it }
                }.onFailure {
                    if (it is UnsafeSubscriptionRedirectException) throw it
                    lastError = it
                    if (it.isConnectionStageFailure()) throw it
                }
            }
        }
        if (bodies.isNotEmpty()) return chooseBestSubscriptionBody(bodies)
        throw lastError ?: IllegalStateException("Subscription URL returned HTTP 204 No Content. Check that the link is active and bound to this device HWID.")
    }

    internal fun chooseBestSubscriptionBody(candidates: List<String>): String {
        val nonEmpty = candidates.map { it.trim() }.filter { it.isNotBlank() }
        require(nonEmpty.isNotEmpty()) { "Subscription URL returned an empty body. Check expiration, token, network access, and HWID binding." }
        val selected = nonEmpty.maxWith(
            compareBy<String> { it.subscriptionBodyScore() }
                .thenBy { it.length }
        )
        if (BuildConfig.DEBUG) {
            debugLog("Subscription body selected ${selected.safeBodySummary()}")
        }
        return selected
    }

    private fun executeSubscriptionRequest(
        startUrl: HttpUrl,
        userAgent: String,
        hwid: String,
        attachHwid: Boolean,
    ): String? {
        var current = startUrl
        repeat(MAX_REDIRECTS + 1) { redirectIndex ->
            val requestHwid = hwid.takeIf { attachHwid }.orEmpty()
            val requestUrl = current.toRequestUrl(requestHwid)
            val request = subscriptionRequest(requestUrl, userAgent, requestHwid)
            if (BuildConfig.DEBUG) {
                debugLog("Subscription fetch start host=${requestUrl.host} ua=${userAgent.substringBefore('/')}")
            }
            http.newCall(request).execute().use { response ->
                if (BuildConfig.DEBUG) {
                    debugLog("Subscription fetch response host=${requestUrl.host} code=${response.code}")
                }
                if (response.isRedirect) {
                    require(redirectIndex < MAX_REDIRECTS) { "Subscription URL redirected too many times" }
                    val location = response.header("Location").orEmpty()
                    val next = current.resolve(location)
                        ?: error("Subscription URL returned an invalid redirect")
                    if (next.scheme != "https") {
                        throw UnsafeSubscriptionRedirectException("Subscription redirects must use HTTPS")
                    }
                    if (attachHwid) {
                        if (!next.host.equals(startUrl.host, ignoreCase = true)) {
                            throw UnsafeSubscriptionRedirectException(
                            "Subscription redirect to another host is blocked to protect device ID"
                            )
                        }
                    }
                    current = next
                    return@repeat
                }
                if (response.code == 204) return null
                return response.subscriptionBodyText()
            }
        }
        error("Subscription URL redirected too many times")
    }

    private fun String.subscriptionBodyScore(): Int {
        val normalized = trim()
        val lower = normalized.lowercase()
        var score = 0
        if (lower.startsWith("<!doctype") || lower.startsWith("<html") || "<html" in lower) score -= 1000
        if ("\"schemaversion\"" in lower && "lumen.subscription-manifest.v1" in lower) score += 2000
        if ("openvpn-shadowsocks" in lower) score += 500
        if (normalized.startsWith("{") || normalized.startsWith("[")) score += 60
        if ("\"outbounds\"" in lower) score += 80
        if ("\"protocol\"" in lower || "\"type\"" in lower) score += 30
        if ("hysteria" in lower || "hy2://" in lower || "hysteria2://" in lower) score += 500
        if ("\"remarks\"" in lower || "\"tag\"" in lower || "\"name\"" in lower) score += 20
        score += SUPPORTED_PROFILE_REGEX.findAll(lower).count().coerceAtMost(100) * 10
        score += (normalized.length / 500).coerceAtMost(100)
        return score
    }

    private fun String.safeBodySummary(): String {
        val normalized = trim()
        val lower = normalized.lowercase()
        val kind = when {
            lower.startsWith("<!doctype") || lower.startsWith("<html") || "<html" in lower -> "html"
            normalized.startsWith("{") -> "json-object"
            normalized.startsWith("[") -> "json-array"
            looksLikeOpenVpnBody() -> "openvpn"
            else -> "other"
        }
        return "kind=$kind length=${normalized.length} score=${subscriptionBodyScore()} " +
            "hasSchema=${"lumen.subscription-manifest.v1" in lower} " +
            "hasOpenVpnSs=${"openvpn-shadowsocks" in lower} " +
            "hasSocksProxy=${"socks-proxy" in lower}"
    }

    private fun String.looksLikeOpenVpnBody(): Boolean =
        lineSequence().map { it.trim().lowercase() }.any { it == "client" } &&
            lineSequence().map { it.trim().lowercase() }.any { it.startsWith("remote ") }

    private fun subscriptionRequest(url: HttpUrl, userAgent: String, hwid: String): Request =
        Request.Builder()
            .url(url)
            .header("User-Agent", userAgent)
            .header("Accept", "text/plain, application/json, application/yaml, text/yaml, */*")
            .header("X-Client", "LumenVPN")
            .header("X-Platform", "android")
            .header("X-OS", "Android")
            .header("X-Device-Model", "Android")
            .apply {
                if (hwid.isNotBlank()) {
                    header("HWID", hwid)
                    header("hwid", hwid)
                    header("X-HWID", hwid)
                    header("x-hwid", hwid)
                    header("X-Device-ID", hwid)
                    header("Happ-HWID", hwid)
                }
            }
            .get()
            .build()

    private fun okhttp3.Response.subscriptionBodyText(): String {
            if (!isSuccessful) {
                error("Cannot load subscription URL: HTTP ${code}")
            }
            if (code == 204) {
                error("Subscription URL returned HTTP 204 No Content. Check that the link is active and bound to this device HWID.")
            }
            val body = body
            val contentLength = body.contentLength()
            require(contentLength <= MAX_SUBSCRIPTION_BYTES || contentLength == -1L) {
                "Subscription is too large"
            }
            val text = body.byteStream().use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    total += read
                    require(total <= MAX_SUBSCRIPTION_BYTES) { "Subscription is too large" }
                    out.write(buffer, 0, read)
                }
                out.toString(StandardCharsets.UTF_8.name()).trim()
            }
            require(text.isNotBlank()) {
                "Subscription URL returned an empty body. Check expiration, token, network access, and HWID binding."
            }
            return text
    }

    private fun extractSupportedToken(value: String): String? {
        if (value.startsWith("[Interface]", ignoreCase = true)) return value
        if (KNOWN_PREFIXES.any { value.startsWith(it, ignoreCase = true) }) return value
        return TOKEN_REGEX.find(value)?.value?.trimEnd(',', ';', ')', ']', '"', '\'')
    }

    private fun unwrapHiddifyImport(value: String): String? {
        val marker = "hiddify://import/"
        if (!value.startsWith(marker, ignoreCase = true)) return null
        return value.substring(marker.length).substringBefore("#").urlDecode()
    }

    private fun unwrapPathAfterHost(value: String, expectedHost: String): String? {
        val uri = value.toUriOrNull() ?: return null
        if (!uri.host.equals(expectedHost, ignoreCase = true)) return null
        return uri.rawPath
            ?.trimStart('/')
            ?.takeIf { it.isNotBlank() }
            ?.substringBefore("#")
            ?.urlDecode()
    }

    private fun URI.firstQueryValue(vararg names: String): String? {
        val query = rawQuery ?: return null
        val pairs = query.split("&")
        for (pair in pairs) {
            val key = pair.substringBefore("=").urlDecode()
            val value = pair.substringAfter("=", "").urlDecode()
            if (names.any { it.equals(key, ignoreCase = true) } && value.isNotBlank()) {
                return value
            }
        }
        return null
    }

    private fun URI.firstStructuredQueryValue(vararg names: String): String? {
        val query = rawQuery ?: return null
        val pairs = query.split("&")
        for (pair in pairs) {
            val key = pair.substringBefore("=").urlDecode()
            if (names.none { it.equals(key, ignoreCase = true) }) continue
            val rawValue = pair.substringAfter("=", "")
            val standard = rawValue.urlDecodePlusAsSpace()
            if (standard.isStructuredInlineSubscription()) return standard
            val preserved = rawValue.urlDecode()
            if (preserved.isStructuredInlineSubscription()) return preserved
        }
        return null
    }

    private fun URI.knownPayloadPath(): String? =
        rawPath
            ?.trimStart('/')
            ?.substringBefore("#")
            ?.urlDecode()
            ?.takeIf { path -> KNOWN_PREFIXES.any { path.startsWith(it, ignoreCase = true) } }

    private fun String.isRemoteHttpUrl(): Boolean =
        startsWith("https://", ignoreCase = true) || startsWith("http://", ignoreCase = true)

    private fun String.stripFragment(): String = substringBefore("#")

    private fun HttpUrl.toRequestUrl(hwid: String): HttpUrl {
        if (hwid.isBlank()) return this
        if (queryParameterNames.any { it.lowercase() in HWID_QUERY_NAMES }) return this
        return newBuilder().addQueryParameter("HWID", hwid).build()
    }

    private fun HttpUrl.lumenNativePreferredUrl(): HttpUrl? {
        if (!LumenHttpSecurity.canAttachDeviceId(host)) return null
        val lastPathIndex = pathSegments.lastIndex
        val lastPathSegment = pathSegments.lastOrNull()?.lowercase().orEmpty()
        if (lastPathIndex >= 0 && lastPathSegment in THIRD_PARTY_RENDER_TARGETS) {
            return newBuilder().setPathSegment(lastPathIndex, LUMEN_NATIVE_TARGET).build()
        }
        val target = queryParameter("target")
        if (target != null && target.lowercase() in THIRD_PARTY_RENDER_TARGETS) {
            return newBuilder()
                .removeAllQueryParameters("target")
                .addQueryParameter("target", LUMEN_NATIVE_TARGET)
                .build()
        }
        val format = queryParameter("format")
        if (format != null && format.lowercase() in THIRD_PARTY_RENDER_TARGETS) {
            return newBuilder()
                .removeAllQueryParameters("format")
                .addQueryParameter("target", LUMEN_NATIVE_TARGET)
                .build()
        }
        return null
    }

    private fun String.fragmentName(): String? =
        toUriOrNull()?.rawFragment?.urlDecode()?.takeIf { it.isNotBlank() }

    private fun String.toUriOrNull(): URI? = runCatching { URI(this) }.getOrNull()

    private fun requireHttpsSubscriptionUrl(url: String): HttpUrl {
        val parsed = runCatching { url.trim().toHttpUrl() }.getOrNull()
            ?: error("Subscription URL is invalid")
        require(parsed.scheme == "https") { "Subscription URLs must use HTTPS" }
        require(parsed.host.isNotBlank()) { "Subscription URL host is missing" }
        return parsed
    }

    private fun String.urlDecode(): String =
        runCatching {
            URLDecoder.decode(replace("+", "%2B"), StandardCharsets.UTF_8.name())
        }.getOrDefault(this)

    private fun String.urlDecodePlusAsSpace(): String =
        runCatching {
            URLDecoder.decode(this, StandardCharsets.UTF_8.name())
        }.getOrDefault(this)

    private fun String.isStructuredInlineSubscription(): Boolean {
        val trimmed = trimStart()
        return trimmed.startsWith("{") ||
            trimmed.startsWith("[") ||
            trimmed.startsWith("proxies:", ignoreCase = true) ||
            trimmed.contains("\nproxies:", ignoreCase = true)
    }

    private fun debugLog(message: String) {
        runCatching { Log.d(TAG, message) }
    }

    data class ResolvedSubscriptionSource(
        val source: String,
        val content: String,
        val name: String? = null,
    )

    companion object {
        private const val TAG = "SubscriptionResolver"
        private const val MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024
        private const val MAX_REDIRECTS = 3
        private const val DEFAULT_USER_AGENT =
            "HiddifyNext/2.5.7"
        private const val FALLBACK_USER_AGENT = "HiddifyNext/2.5.7"
        private const val LUMEN_NATIVE_TARGET = "lumen-json"
        private val HWID_QUERY_NAMES = setOf("hwid", "deviceid", "device_id", "clientid", "client_id")
        private val THIRD_PARTY_RENDER_TARGETS = setOf("happ", "hiddify")
        private val KNOWN_PREFIXES = listOf(
            "https://",
            "hiddify://",
            "sing-box://",
            "nekobox://",
            "nekoray://",
            "clash://",
            "mihomo://",
            "stash://",
            "karing://",
            "happ://",
            "lumen://",
            "vpn://",
            "v2ray://",
            "v2rayn://",
            "v2rayng://",
            "mless://",
            "vless://",
            "vmess://",
            "trojan://",
            "ss://",
            "socks://",
            "socks4://",
            "socks4a://",
            "socks5://",
            "hysteria://",
            "hysteria2://",
            "hy2://",
            "tuic://",
            "naive://",
            "naiveproxy://",
            "wireguard://"
        )
        private val TOKEN_REGEX = Regex(
            """(?is)(hiddify://\S+|sing-box://\S+|nekobox://\S+|nekoray://\S+|clash://\S+|mihomo://\S+|stash://\S+|karing://\S+|happ://\S+|lumen://\S+|vpn://\S+|v2ray(?:n|ng)?://\S+|https?://\S+|mless://\S+|vless://\S+|vmess://\S+|trojan://\S+|ss://\S+|socks(?:4a?|5)?://\S+|hysteria://\S+|hysteria2://\S+|hy2://\S+|tuic://\S+|naive(?:proxy)?://\S+|wireguard://\S+)"""
        )
        private val SUPPORTED_PROFILE_REGEX = Regex(
            """(?i)(vless://|vmess://|trojan://|ss://|socks(?:4a?|5)?://|hysteria://|hysteria2://|hy2://|tuic://|naive(?:proxy)?://|wireguard://|\"protocol\"\s*:\s*\"(?:vless|vmess|trojan|shadowsocks|socks|hysteria|tuic|naiveproxy|naive)\"|\"type\"\s*:\s*\"(?:vless|vmess|trojan|shadowsocks|socks|hysteria2?|tuic|naiveproxy|naive)\")"""
        )
        private val HAPP_COMPATIBLE_USER_AGENTS = listOf(
            "Happ/4.1.10",
            "v2rayNG/1.8.38",
            "happ/4.1.10",
            "HiddifyNext/2.5.7",
            "NekoBox/1.3.8",
            "ClashMeta/2.11.5",
            "sing-box/1.12.0",
            "LumenVPN/1.0 Android",
        )
    }
}

private class UnsafeSubscriptionRedirectException(message: String) : IllegalArgumentException(message)

private fun Throwable.isConnectionStageFailure(): Boolean =
    this is java.net.SocketTimeoutException ||
        this is java.net.ConnectException ||
        this is java.net.NoRouteToHostException ||
        this is java.net.UnknownHostException ||
        this is IOException && message.orEmpty().contains("failed to connect", ignoreCase = true)

private object SubscriptionDns : Dns {
    private val doh: Dns by lazy {
        DnsOverHttps.Builder()
            .client(
                OkHttpClient.Builder()
                    .connectTimeout(10, TimeUnit.SECONDS)
                    .readTimeout(10, TimeUnit.SECONDS)
                    .callTimeout(12, TimeUnit.SECONDS)
                    .build()
            )
            .url("https://cloudflare-dns.com/dns-query".toHttpUrl())
            .bootstrapDnsHosts(
                InetAddress.getByName("1.1.1.1"),
                InetAddress.getByName("1.0.0.1"),
            )
            .build()
    }

    override fun lookup(hostname: String): List<InetAddress> {
        if (!LumenHttpSecurity.canAttachDeviceId(hostname)) return Dns.SYSTEM.lookup(hostname)
        val resolved = runCatching { doh.lookup(hostname) }
            .getOrElse { Dns.SYSTEM.lookup(hostname) }
        val sorted = resolved.sortedBy { if (it is Inet4Address) 0 else 1 }
        if (BuildConfig.DEBUG) {
            Log.d("SubscriptionResolver", "DNS host=$hostname count=${sorted.size} first=${sorted.firstOrNull()?.hostAddress.orEmpty()}")
        }
        return sorted
    }
}
