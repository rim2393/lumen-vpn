package tel.lumentech.vpn

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import tel.lumentech.vpn.subscription.LumenDeepLink
import tel.lumentech.vpn.subscription.SubscriptionSourceResolver

class SubscriptionSourceResolverTest {
    private val resolver = SubscriptionSourceResolver()

    @Test
    fun unwrapsHiddifyImportScheme() {
        val resolved = resolver.unwrap("hiddify://import/https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Dabc#Lumen")

        assertEquals("https://example.com/sub?token=abc", resolved.content)
        assertEquals("Lumen", resolved.name)
    }

    @Test
    fun unwrapsSingBoxRemoteProfileScheme() {
        val resolved = resolver.unwrap("sing-box://import-remote-profile?url=https%3A%2F%2Fexample.com%2Fsb.json#Office")

        assertEquals("https://example.com/sb.json", resolved.content)
        assertEquals("Office", resolved.name)
    }

    @Test
    fun unwrapsV2rayNgInstallSubscriptionScheme() {
        val resolved = resolver.unwrap(
            "v2rayng://install-sub?url=https%3A%2F%2Fexample.com%2Fsub%3Ftarget%3Dv2ray&name=Lumen"
        )

        assertEquals("https://example.com/sub?target=v2ray", resolved.content)
        assertEquals("Lumen", resolved.name)
    }

    @Test
    fun unwrapsV2rayNInstallSubscriptionScheme() {
        val resolved = resolver.unwrap(
            "v2rayn://install-sub?url=https%3A%2F%2Fexample.com%2Fsub%3Ftarget%3Dv2ray-base64#Desktop"
        )

        assertEquals("https://example.com/sub?target=v2ray-base64", resolved.content)
        assertEquals("Desktop", resolved.name)
    }

    @Test
    fun unwrapsStashAndNekoClientSchemes() {
        val cases = mapOf(
            "stash://install-config?url=https%3A%2F%2Fexample.com%2Fsub%3Ftarget%3Dstash#Stash" to
                "https://example.com/sub?target=stash",
            "mihomo://install-config?url=https%3A%2F%2Fexample.com%2Fsub%3Ftarget%3Dmihomo#Mihomo" to
                "https://example.com/sub?target=mihomo",
            "nekobox://import?url=https%3A%2F%2Fexample.com%2Fsub%3Ftarget%3Dnekobox#NekoBox" to
                "https://example.com/sub?target=nekobox",
            "nekoray://import?url=https%3A%2F%2Fexample.com%2Fsub%3Ftarget%3Dnekoray#NekoRay" to
                "https://example.com/sub?target=nekoray",
        )

        cases.forEach { (raw, expected) ->
            val resolved = resolver.unwrap(raw)
            assertEquals(expected, resolved.content)
        }
    }

    @Test
    fun unwrapsHappImportPathScheme() {
        val resolved = resolver.unwrap("happ://import/https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Da%2Bb#Mobile")

        assertEquals("https://example.com/sub?token=a+b", resolved.content)
        assertEquals("Mobile", resolved.name)
    }

    @Test
    fun unwrapsKaringImportPathScheme() {
        val resolved = resolver.unwrap("karing://import/https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Dabc#Mobile")

        assertEquals("https://example.com/sub?token=abc", resolved.content)
        assertEquals("Mobile", resolved.name)
    }

    @Test
    fun parsesLumenRemoteImportDeepLink() {
        val resolved = resolver.unwrap(
            "lumen://import/v1?url=https%3A%2F%2Fapi.lumentech.tel%2Fsub%2Ftoken%3Fformat%3Dsing-box&name=Bear"
        )

        assertEquals("https://api.lumentech.tel/sub/token?format=sing-box", resolved.content)
        assertEquals("Bear", resolved.name)
    }

    @Test
    fun parsesLumenInlineBase64UrlImportDeepLink() {
        val profile = "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&sni=site.com&pbk=pub&type=tcp#DE"
        val encoded = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(profile.toByteArray(StandardCharsets.UTF_8))

        val payload = LumenDeepLink.parse("lumen://import/v1?data=$encoded&name=Inline")!!

        assertEquals(profile, payload.content)
        assertEquals("Inline", payload.name)
    }

    @Test
    fun parsesLumenHttpsAppLink() {
        val profile = "hysteria2://pass@example.com:443?sni=site.com#HY2"
        val encodedProfile = URLEncoder.encode(profile, StandardCharsets.UTF_8.name())

        val payload = LumenDeepLink.parse("https://cabinet.lumentech.tel/app/import?uri=$encodedProfile&name=HY2")!!

        assertEquals(profile, payload.content)
        assertEquals("HY2", payload.name)
    }

    @Test
    fun acceptsThirdPartyImportDeepLinksAsRealImportPayloads() {
        val examples = mapOf(
            "hiddify://import/https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Dabc#Hiddify" to "Hiddify",
            "sing-box://import-remote-profile?url=https%3A%2F%2Fexample.com%2Fsing-box.json#SingBox" to "SingBox",
            "nekobox://import?url=https%3A%2F%2Fexample.com%2Fnekobox.json#NekoBox" to "NekoBox",
            "nekoray://import?url=https%3A%2F%2Fexample.com%2Fnekoray.json#NekoRay" to "NekoRay",
            "stash://install-config?url=https%3A%2F%2Fexample.com%2Fstash.yaml#Stash" to "Stash",
            "mihomo://install-config?url=https%3A%2F%2Fexample.com%2Fmihomo.yaml#Mihomo" to "Mihomo",
            "v2rayng://install-sub?url=https%3A%2F%2Fexample.com%2Fv2ray.txt&name=V2RayNG" to "V2RayNG",
            "karing://import/https%3A%2F%2Fexample.com%2Fsub#Karing" to "Karing",
            "happ://import/https%3A%2F%2Fexample.com%2Fsub#Happ" to "Happ",
            "vpn://imported-config" to "Amnezia VPN import",
            "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=tls#VLESS" to "VLESS",
            "vmess://eyJ2IjoiMiIsInBzIjoiVk1lc3MiLCJhZGQiOiJleGFtcGxlLmNvbSIsInBvcnQiOiI0NDMiLCJpZCI6IjExMTExMTExLTExMTEtMTExMS0xMTExLTExMTExMTExMTExMSIsImFpZCI6IjAiLCJuZXQiOiJ0Y3AiLCJ0eXBlIjoibm9uZSIsImhvc3QiOiIiLCJwYXRoIjoiIiwidGxzIjoidGxzIn0=" to "VMESS import",
            "trojan://pass@example.com:443?security=tls#Trojan" to "Trojan",
            "ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#SS" to "SS",
            "hysteria2://pass@example.com:443?sni=example.com#HY2" to "HY2",
            "hy2://pass@example.com:443?sni=example.com#HY2Alias" to "HY2Alias",
            "tuic://uuid:pass@example.com:443?sni=example.com#TUIC" to "TUIC",
            "naive://user:pass@example.com:443#Naive" to "Naive",
            "wireguard://example.com:51820?public_key=server&private_key=client&address=10.0.0.2/32#WG" to "WG",
        )

        examples.forEach { (raw, expectedName) ->
            val payload = LumenDeepLink.parse(raw) ?: error("Expected payload for $raw")

            assertEquals(raw, payload.source)
            assertEquals(raw, payload.content)
            assertEquals(expectedName, payload.name)
        }
    }

    @Test
    fun unwrapsThirdPartyDeepLinksAfterAndroidDispatch() {
        val resolved = resolver.unwrap("happ://import/https%3A%2F%2Fexample.com%2Fsub%3Ftoken%3Da%2Bb#Mobile")

        assertEquals("https://example.com/sub?token=a+b", resolved.content)
        assertEquals("Mobile", resolved.name)
    }

    @Test
    fun unwrapsInlineClashConfigQueryWithFormEncodedSpaces() {
        val clash = """
            proxies:
              - name: HY2
                type: hy2
                server: hy.example.com
                port: 443
                password: secret
        """.trimIndent()
        val encoded = URLEncoder.encode(clash, StandardCharsets.UTF_8.name())

        val resolved = resolver.unwrap("clash://install-config?url=$encoded#Clash")

        assertEquals(clash, resolved.content)
        assertEquals("Clash", resolved.name)
    }

    @Test
    fun fetchesRemoteSubscriptionUrlBeforeParsing() {
        val body = "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&sni=site.com&pbk=pub&type=tcp#RU"
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(fetchOverride = {
            requestedUrl = it
            body
        })

        val resolved = fetchingResolver.resolve("qr", "https://example.com/sub#QR")

        assertEquals("https://example.com/sub", requestedUrl)
        assertEquals("https://example.com/sub", resolved.source)
        assertEquals(body, resolved.content)
        assertEquals("QR", resolved.name)
    }

    @Test
    fun rejectsInsecureRemoteSubscriptionUrlBeforeFetching() {
        var fetched = false
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                fetched = true
                "vless://11111111-1111-1111-1111-111111111111@example.com:443#RU"
            }
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            fetchingResolver.resolve("qr", "http://example.com/sub#QR")
        }

        assertTrue(error.message.orEmpty().contains("HTTPS", ignoreCase = true))
        assertFalse(fetched)
    }

    @Test
    fun doesNotSendHwidToUntrustedRemoteSubscriptionHost() {
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrl = it
                "vless://11111111-1111-1111-1111-111111111111@example.com:443#RU"
            },
            hwidProvider = { "abc123" }
        )

        fetchingResolver.resolve("qr", "https://example.com/sub?token=x#QR")

        assertEquals("https://example.com/sub?token=x", requestedUrl)
        assertFalse(requestedUrl.contains("HWID", ignoreCase = true))
        assertFalse(requestedUrl.contains("abc123"))
    }

    @Test
    fun mayAppendHwidToTrustedLumenRemoteSubscriptionUrl() {
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrl = it
                "vless://11111111-1111-1111-1111-111111111111@example.com:443#RU"
            },
            hwidProvider = { "abc123" }
        )

        fetchingResolver.resolve("qr", "https://lumentech.tel/sub?token=x#QR")

        assertEquals("https://lumentech.tel/sub?token=x&HWID=abc123", requestedUrl)
    }

    @Test
    fun prefersNativeLumenManifestForTrustedHappPath() {
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrl = it
                """{"schemaVersion":"lumen.subscription-manifest.v1","nodes":[]}"""
            },
            hwidProvider = { "abc123" }
        )

        fetchingResolver.resolve("qr", "https://sub.lumentech.tel/sub/lumen_sub_abc/happ#QR")

        assertEquals("https://sub.lumentech.tel/sub/lumen_sub_abc/lumen-json?HWID=abc123", requestedUrl)
    }

    @Test
    fun prefersNativeLumenManifestForTrustedHappQueryTarget() {
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrl = it
                """{"schemaVersion":"lumen.subscription-manifest.v1","nodes":[]}"""
            },
            hwidProvider = { "abc123" }
        )

        fetchingResolver.resolve("qr", "https://panel.lumentech.tel/api/v1/subscriptions/public/lumen_sub_abc/render?target=happ#QR")

        assertEquals("https://panel.lumentech.tel/api/v1/subscriptions/public/lumen_sub_abc/render?target=lumen-json&HWID=abc123", requestedUrl)
    }

    @Test
    fun doesNotRewriteThirdPartyHappPathToLumenNativeManifest() {
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrl = it
                "vless://11111111-1111-1111-1111-111111111111@example.com:443#RU"
            },
            hwidProvider = { "abc123" }
        )

        fetchingResolver.resolve("qr", "https://example.com/sub/lumen_sub_abc/happ#QR")

        assertEquals("https://example.com/sub/lumen_sub_abc/happ", requestedUrl)
    }

    @Test
    fun choosesLumenNativeManifestOverHtmlAndRawOpenVpnBodies() {
        val html = "<!doctype html><html><body>${"x".repeat(5000)}</body></html>"
        val rawOpenVpn = """
            client
            dev tun
            proto tcp
            remote 127.0.0.1 1194
            socks-proxy 127.0.0.1 1080
        """.trimIndent()
        val manifest = """{"schemaVersion":"lumen.subscription-manifest.v1","nodes":[{"protocols":[{"type":"openvpn-shadowsocks"}]}]}"""

        assertEquals(manifest, resolver.chooseBestSubscriptionBody(listOf(html, rawOpenVpn, manifest)))
    }

    @Test
    fun mayAppendHwidToTrustedBearRemoteSubscriptionUrl() {
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrl = it
                "vless://11111111-1111-1111-1111-111111111111@example.com:443#RU"
            },
            hwidProvider = { "abc123" }
        )

        fetchingResolver.resolve("qr", "https://api.bearshits.ru/sub?token=x#QR")

        assertEquals("https://api.bearshits.ru/sub?token=x&HWID=abc123", requestedUrl)
    }

    @Test
    fun mayAppendHwidToCurrentProductionSubscriptionHosts() {
        val requestedUrls = mutableListOf<String>()
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrls += it
                "vless://11111111-1111-1111-1111-111111111111@example.com:443#RU"
            },
            hwidProvider = { "abc123" }
        )

        fetchingResolver.resolve("qr", "https://panel.lumentech.tel/api/v1/subscriptions/public/token/render?target=happ#QR")
        fetchingResolver.resolve("qr", "https://sub.lumentech.tel/sub/token/happ#QR")
        fetchingResolver.resolve("qr", "https://panel.89-185-85-184.sslip.io/api/v1/subscriptions/public/token/render?target=happ#QR")
        fetchingResolver.resolve("qr", "https://sub.89-185-85-184.sslip.io/sub/token/happ#QR")

        assertEquals(
            listOf(
                "https://panel.lumentech.tel/api/v1/subscriptions/public/token/render?target=lumen-json&HWID=abc123",
                "https://sub.lumentech.tel/sub/token/lumen-json?HWID=abc123",
                "https://panel.89-185-85-184.sslip.io/api/v1/subscriptions/public/token/render?target=lumen-json&HWID=abc123",
                "https://sub.89-185-85-184.sslip.io/sub/token/lumen-json?HWID=abc123",
            ),
            requestedUrls,
        )
    }

    @Test
    fun doesNotDuplicateExistingHwidParameter() {
        var requestedUrl = ""
        val fetchingResolver = SubscriptionSourceResolver(
            fetchOverride = {
                requestedUrl = it
                "vless://11111111-1111-1111-1111-111111111111@example.com:443#RU"
            },
            hwidProvider = { "new-value" }
        )

        fetchingResolver.resolve("qr", "https://lumentech.tel/sub?HWID=old#QR")

        assertEquals("https://lumentech.tel/sub?HWID=old", requestedUrl)
    }

    @Test
    fun keepsHwidOnSameTrustedHostRedirectWithoutRealNetwork() {
        val requestedUrls = mutableListOf<String>()
        val http = OkHttpClient.Builder()
            .addInterceptor(syntheticRedirectInterceptor(requestedUrls))
            .build()
        val fetchingResolver = SubscriptionSourceResolver(
            http = http,
            hwidProvider = { "abc123" }
        )

        val resolved = fetchingResolver.resolve("qr", "https://lumentech.tel/start#QR")

        assertEquals(
            listOf(
                "https://lumentech.tel/start?HWID=abc123",
                "https://lumentech.tel/next?HWID=abc123",
            ),
            requestedUrls.take(2),
        )
        assertEquals("vless://11111111-1111-1111-1111-111111111111@example.com:443#RU", resolved.content)
    }

    @Test
    fun blocksTrustedHwidRedirectToDifferentHostBeforeSecondRequest() {
        val requestedUrls = mutableListOf<String>()
        val http = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request()
                requestedUrls += request.url.toString()
                redirectResponse(request, "https://example.com/next")
            }
            .build()
        val fetchingResolver = SubscriptionSourceResolver(
            http = http,
            hwidProvider = { "abc123" }
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            fetchingResolver.resolve("qr", "https://lumentech.tel/start#QR")
        }

        assertTrue(error.message.orEmpty().contains("device ID", ignoreCase = true))
        assertEquals(listOf("https://lumentech.tel/start?HWID=abc123"), requestedUrls)
    }

    @Test
    fun extractsRawLinkFromQrText() {
        val resolved = resolver.unwrap("Добавить VPN: vless://id@example.com:443?security=tls#RU")

        assertTrue(resolved.content.startsWith("vless://"))
    }

    private fun syntheticRedirectInterceptor(requestedUrls: MutableList<String>): Interceptor =
        Interceptor { chain ->
            val request = chain.request()
            requestedUrls += request.url.toString()
            if (request.url.encodedPath == "/start") {
                redirectResponse(request, "/next")
            } else {
                Response.Builder()
                    .request(request)
                    .protocol(Protocol.HTTP_1_1)
                    .code(200)
                    .message("OK")
                    .body("vless://11111111-1111-1111-1111-111111111111@example.com:443#RU".toResponseBody(TEXT_PLAIN))
                    .build()
            }
        }

    private fun redirectResponse(request: okhttp3.Request, location: String): Response =
        Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(302)
            .message("Found")
            .header("Location", location)
            .body("".toResponseBody(TEXT_PLAIN))
            .build()

    private companion object {
        val TEXT_PLAIN = "text/plain".toMediaType()
    }
}
