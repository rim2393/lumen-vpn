package tel.lumentech.vpn

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.zip.Deflater
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.runtime.SingBoxConfigFactory
import tel.lumentech.vpn.runtime.XrayConfigFactory
import tel.lumentech.vpn.security.SecretRedactor
import tel.lumentech.vpn.subscription.SubscriptionParser

class SubscriptionParserTest {
    private val parser = SubscriptionParser()

    @Test
    fun parsesVlessRealityLink() {
        val result = parser.parse(
            "test",
            "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&sni=site.com&pbk=pub&sid=abc&type=tcp#RU"
        )
        val server = result.subscription.servers.single()
        assertEquals(ProtocolType.VLESS, server.protocol)
        assertEquals("example.com", server.host)
        assertEquals("site.com", server.sni)
        assertEquals("pub", server.publicKey)
    }

    @Test
    fun parsesCommaSeparatedLumenBundle() {
        val result = parser.parse(
            "lumen-bundle",
            listOf(
                "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&sni=site.com&pbk=pub&sid=abc&type=tcp#Xray",
                "hysteria2://pass@example.org:443?sni=hy.example.org#HY2",
                "tuic://uuid:pass@example.net:443?sni=tuic.example.net#TUIC"
            ).joinToString(","),
            "Lumen bundle"
        )

        assertEquals(3, result.subscription.servers.size)
        assertTrue(result.subscription.servers.any { it.protocol == ProtocolType.VLESS })
        assertTrue(result.subscription.servers.any { it.protocol == ProtocolType.HYSTERIA2 })
        assertTrue(result.subscription.servers.any { it.protocol == ProtocolType.TUIC })
    }

    @Test
    fun parsesNativeLumenManifest() {
        val result = parser.parse(
            "lumen-json",
            """
            {
              "schemaVersion": "lumen.subscription-manifest.v1",
              "provider": { "name": "Lumen" },
              "subscription": { "id": "lumen_sub_test" },
              "nodes": [
                {
                  "id": "node-1",
                  "displayName": "DE 01",
                  "protocols": [
                    {
                      "id": "vless-reality",
                      "type": "vless-reality",
                      "endpoint": { "host": "de.example.com", "port": 443, "transport": "tcp" },
                      "security": {
                        "type": "reality",
                        "serverName": "www.microsoft.com",
                        "publicKey": "pub",
                        "shortId": "abcd",
                        "fingerprint": "chrome"
                      },
                      "flow": "xtls-rprx-vision",
                      "credentials": {
                        "uuid": "11111111-1111-4111-8111-111111111111",
                        "password": "trojan-pass",
                        "shadowsocksPassword": "ss-pass",
                        "hysteriaPassword": "hy2-pass",
                        "wireguardPrivateKey": "wg-private",
                        "wireguardPublicKey": "wg-public"
                      },
                      "rendererHints": { "name": "Lumen DE" }
                    },
                    {
                      "id": "hysteria2",
                      "type": "hysteria2",
                      "endpoint": { "host": "hy.example.com", "port": 8443, "transport": "udp" },
                      "security": { "type": "tls", "serverName": "hy.example.com" },
                      "credentials": { "hysteriaPassword": "hy2-pass" },
                      "rendererHints": { "name": "Lumen HY2" }
                    },
                    {
                      "id": "hysteria2-obfs",
                      "type": "hysteria2-obfs",
                      "endpoint": { "host": "hy-obfs.example.com", "port": 8444, "transport": "udp" },
                      "security": { "type": "tls", "serverName": "hy-obfs.example.com" },
                      "credentials": {
                        "hysteriaPassword": "hy2-obfs-pass",
                        "hysteriaObfsPassword": "hy2-obfs-mask"
                      },
                      "rendererHints": { "name": "Lumen HY2 Obfs", "obfs": "salamander" }
                    },
                    {
                      "id": "naiveproxy",
                      "type": "naiveproxy",
                      "endpoint": { "host": "naive.example.com", "port": 8445, "transport": "tcp" },
                      "security": { "type": "tls", "serverName": "naive.example.com" },
                      "credentials": {
                        "username": "lumen_sub_test",
                        "password": "naive-pass"
                      },
                      "rendererHints": { "name": "Lumen Naive" }
                    }
                  ]
                }
              ]
            }
            """.trimIndent(),
            "Lumen native"
        )

        val servers = result.subscription.servers
        assertEquals(4, servers.size)
        val vless = servers.first { it.protocol == ProtocolType.VLESS }
        assertEquals(result.subscription.id, vless.subscriptionId)
        assertEquals("de.example.com", vless.host)
        assertEquals("11111111-1111-4111-8111-111111111111", vless.uuid)
        assertEquals("reality", vless.security)
        assertEquals("pub", vless.publicKey)
        assertTrue(RuntimeSupport.isConnectable(vless))

        val hysteria2 = servers.first { it.protocol == ProtocolType.HYSTERIA2 }
        assertEquals("hy2-pass", hysteria2.password)
        assertTrue(RuntimeSupport.isConnectable(hysteria2))

        val hysteria2Obfs = servers.first { it.host == "hy-obfs.example.com" }
        assertEquals(ProtocolType.HYSTERIA2, hysteria2Obfs.protocol)
        assertEquals("hy2-obfs-pass", hysteria2Obfs.password)
        val obfsConfig = SingBoxConfigFactory().build(hysteria2Obfs)
        assertTrue(obfsConfig.contains("\"obfs\""))
        assertTrue(obfsConfig.contains("\"password\": \"hy2-obfs-mask\""))

        val naive = servers.first { it.protocol == ProtocolType.NAIVE }
        assertEquals("naive.example.com", naive.host)
        assertEquals("lumen_sub_test", naive.username)
        assertEquals("naive-pass", naive.password)
        assertEquals(RuntimeBackend.SING_BOX, RuntimeSupport.backend(naive))
        assertTrue(RuntimeSupport.isConnectable(naive))
        val naiveConfig = SingBoxConfigFactory().build(naive)
        assertTrue(naiveConfig.contains("\"type\": \"naive\""))
        assertTrue(naiveConfig.contains("\"username\": \"lumen_sub_test\""))
        assertTrue(naiveConfig.contains("\"server_name\": \"naive.example.com\""))
    }

    @Test
    fun nativeLumenVlessRealityUsesXrayCoreConfig() {
        val server = parser.parse(
            "lumen-json",
            """
            {
              "schemaVersion": "lumen.subscription-manifest.v1",
              "subscription": { "id": "lumen_sub_test" },
              "nodes": [
                {
                  "id": "node-1",
                  "displayName": "RU 01",
                  "protocols": [
                    {
                      "id": "vless-reality",
                      "type": "vless-reality",
                      "endpoint": { "host": "ru.example.com", "port": 443, "transport": "tcp" },
                      "security": {
                        "type": "reality",
                        "serverName": "www.microsoft.com",
                        "publicKey": "reality-public-key",
                        "shortId": "abcd",
                        "fingerprint": "chrome",
                        "spiderX": "/"
                      },
                      "flow": "xtls-rprx-vision",
                      "credentials": {
                        "uuid": "11111111-1111-4111-8111-111111111111"
                      },
                      "rendererHints": { "name": "RU Reality" }
                    }
                  ]
                }
              ]
            }
            """.trimIndent(),
            "Lumen native"
        ).subscription.servers.single()

        assertEquals(ProtocolType.VLESS, server.protocol)
        assertEquals(RuntimeBackend.XRAY_CORE, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))

        val config = JSONObject(XrayConfigFactory().build(server).fullJsonConfig)
        val outbound = config.getJSONArray("outbounds").getJSONObject(0)
        val user = outbound
            .getJSONObject("settings")
            .getJSONArray("vnext")
            .getJSONObject(0)
            .getJSONArray("users")
            .getJSONObject(0)
        val stream = outbound.getJSONObject("streamSettings")
        val reality = stream.getJSONObject("realitySettings")

        assertEquals("vless", outbound.getString("protocol"))
        assertEquals("tcp", stream.getString("network"))
        assertEquals("reality", stream.getString("security"))
        assertEquals("11111111-1111-4111-8111-111111111111", user.getString("id"))
        assertEquals("xtls-rprx-vision", user.getString("flow"))
        assertEquals("www.microsoft.com", reality.getString("serverName"))
        assertEquals("reality-public-key", reality.getString("publicKey"))
        assertEquals("abcd", reality.getString("shortId"))
    }

    @Test
    fun parsesProdClientCompatibilityRenderFamilies() {
        val raw = "vless://11111111-1111-4111-8111-111111111111@node.example.test:443" +
            "?security=reality&sni=www.example.com&pbk=reality-public-key&sid=a1b2c3d4&type=tcp&flow=xtls-rprx-vision#Lumen%20Reality"
        val v2rayBase64 = Base64.getEncoder().encodeToString(raw.toByteArray(Charsets.UTF_8))
        val mihomo = """
            proxies:
              - name: "Lumen Reality"
                type: "vless"
                server: "node.example.test"
                port: 443
                uuid: "11111111-1111-4111-8111-111111111111"
                tls: true
                network: "tcp"
                servername: "www.example.com"
                reality-opts:
                  public-key: "reality-public-key"
                  short-id: "a1b2c3d4"
            proxy-groups:
              - name: Lumen
                type: select
                proxies:
                  - "Lumen Reality"
            rules:
              - MATCH,Lumen
        """.trimIndent()
        val singBox = """
            {
              "outbounds": [
                {
                  "tag": "Lumen Reality",
                  "type": "vless",
                  "server": "node.example.test",
                  "server_port": 443,
                  "uuid": "11111111-1111-4111-8111-111111111111",
                  "flow": "xtls-rprx-vision",
                  "tls": {
                    "enabled": true,
                    "server_name": "www.example.com",
                    "utls": { "enabled": true, "fingerprint": "chrome" },
                    "reality": {
                      "enabled": true,
                      "public_key": "reality-public-key",
                      "short_id": "a1b2c3d4"
                    }
                  }
                }
              ]
            }
        """.trimIndent()
        val xray = """
            {
              "outbounds": [
                {
                  "tag": "Lumen Reality",
                  "protocol": "vless",
                  "settings": {
                    "vnext": [
                      {
                        "address": "node.example.test",
                        "port": 443,
                        "users": [
                          {
                            "id": "11111111-1111-4111-8111-111111111111",
                            "flow": "xtls-rprx-vision"
                          }
                        ]
                      }
                    ]
                  },
                  "streamSettings": {
                    "network": "tcp",
                    "security": "reality",
                    "realitySettings": {
                      "serverName": "www.example.com",
                      "publicKey": "reality-public-key",
                      "shortId": "a1b2c3d4",
                      "fingerprint": "chrome"
                    }
                  }
                }
              ]
            }
        """.trimIndent()
        val lumen = """
            {
              "schemaVersion": "lumen.subscription-manifest.v1",
              "provider": { "name": "Lumen" },
              "subscription": { "id": "lumen_sub_pr006" },
              "nodes": [
                {
                  "id": "node-1",
                  "displayName": "Lumen Reality",
                  "protocols": [
                    {
                      "id": "vless-reality",
                      "type": "vless-reality",
                      "endpoint": { "host": "node.example.test", "port": 443, "transport": "tcp" },
                      "security": {
                        "type": "reality",
                        "serverName": "www.example.com",
                        "publicKey": "reality-public-key",
                        "shortId": "a1b2c3d4",
                        "fingerprint": "chrome"
                      },
                      "flow": "xtls-rprx-vision",
                      "credentials": { "uuid": "11111111-1111-4111-8111-111111111111" },
                      "rendererHints": { "name": "Lumen Reality" }
                    }
                  ]
                }
              ]
            }
        """.trimIndent()

        val bodies = mapOf(
            "happ" to raw,
            "hiddify" to raw,
            "v2ray" to raw,
            "v2rayng" to raw,
            "v2ray-base64" to v2rayBase64,
            "mihomo" to mihomo,
            "stash" to mihomo,
            "clash" to mihomo,
            "sing-box" to singBox,
            "nekobox" to singBox,
            "nekoray" to singBox,
            "amnezia" to xray,
            "xray-json" to xray,
            "lumen-json" to lumen,
        )

        bodies.forEach { (source, body) ->
            val subscription = parser.parse(source, body, "PR-006 $source").subscription
            val server = subscription.servers.single()
            assertEquals("PR-006 $source", subscription.name)
            assertEquals(ProtocolType.VLESS, server.protocol)
            assertEquals("node.example.test", server.host)
            assertEquals(443, server.port)
            assertEquals("www.example.com", server.sni)
            assertEquals("reality-public-key", server.publicKey)
            assertTrue("$source should be connectable", RuntimeSupport.isConnectable(server))
        }
    }

    @Test
    fun nativeLumenVlessTcpUsesXrayCoreConfig() {
        val server = parseNativeLumenServer(
            type = "vless-tcp",
            security = """{ "type": "none" }""",
            credentials = """{ "uuid": "11111111-1111-4111-8111-111111111111" }"""
        )

        assertEquals(ProtocolType.VLESS, server.protocol)
        assertEquals(RuntimeBackend.XRAY_CORE, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))

        val outbound = JSONObject(XrayConfigFactory().build(server).fullJsonConfig)
            .getJSONArray("outbounds")
            .getJSONObject(0)
        val stream = outbound.getJSONObject("streamSettings")

        assertEquals("vless", outbound.getString("protocol"))
        assertEquals("tcp", stream.getString("network"))
        assertEquals("none", stream.getString("security"))
        assertFalse(stream.has("tlsSettings"))
        assertFalse(stream.has("realitySettings"))
    }

    @Test
    fun nativeLumenVlessTcpTlsUsesXrayCoreConfig() {
        val server = parseNativeLumenServer(
            type = "vless-tcp-tls",
            security = """{ "type": "tls", "serverName": "live.lumen.local", "alpn": ["h2", "http/1.1"] }""",
            credentials = """{ "uuid": "11111111-1111-4111-8111-111111111111" }"""
        )

        assertEquals(ProtocolType.VLESS, server.protocol)
        assertEquals(RuntimeBackend.XRAY_CORE, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))

        val tls = JSONObject(XrayConfigFactory().build(server).fullJsonConfig)
            .getJSONArray("outbounds")
            .getJSONObject(0)
            .getJSONObject("streamSettings")
            .getJSONObject("tlsSettings")

        assertEquals("live.lumen.local", tls.getString("serverName"))
        assertTrue(tls.getJSONArray("alpn").length() > 0)
        assertFalse(tls.has("allowInsecure"))
    }

    @Test
    fun nativeLumenVlessTcpTlsMapsPinnedPeerCertForModernXray() {
        val server = parseNativeLumenServer(
            type = "vless-tcp-tls",
            security = """{ "type": "tls", "serverName": "live.lumen.local", "pinnedPeerCertSha256": "0123456789abcdef" }""",
            credentials = """{ "uuid": "11111111-1111-4111-8111-111111111111" }"""
        )

        val tls = JSONObject(XrayConfigFactory().build(server).fullJsonConfig)
            .getJSONArray("outbounds")
            .getJSONObject(0)
            .getJSONObject("streamSettings")
            .getJSONObject("tlsSettings")

        assertFalse(tls.has("allowInsecure"))
        assertEquals("0123456789abcdef", tls.getString("pinnedPeerCertSha256"))
    }

    @Test
    fun nativeLumenTrojanTcpTlsUsesSingBoxConfig() {
        val server = parseNativeLumenServer(
            type = "trojan-tcp-tls",
            security = """{ "type": "tls", "serverName": "live.lumen.local" }""",
            credentials = """{ "password": "trojan-pass" }"""
        )

        assertEquals(ProtocolType.TROJAN, server.protocol)
        assertEquals(RuntimeBackend.SING_BOX, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))

        val outbound = JSONObject(SingBoxConfigFactory().build(server))
            .getJSONArray("outbounds")
            .getJSONObject(0)
        val tls = outbound.getJSONObject("tls")

        assertEquals("trojan", outbound.getString("type"))
        assertEquals("trojan-pass", outbound.getString("password"))
        assertTrue(tls.getBoolean("enabled"))
        assertEquals("live.lumen.local", tls.getString("server_name"))
    }

    @Test
    fun nativeLumenTrojanTcpRealityUsesSingBoxRealityConfig() {
        val server = parseNativeLumenServer(
            type = "trojan-tcp-reality",
            security = """
                {
                  "type": "reality",
                  "serverName": "www.cloudflare.com",
                  "publicKey": "reality-public-key",
                  "shortId": "a1b2c3d4",
                  "fingerprint": "chrome"
                }
            """.trimIndent(),
            credentials = """{ "password": "trojan-pass" }"""
        )

        assertEquals(ProtocolType.TROJAN, server.protocol)
        assertEquals(RuntimeBackend.SING_BOX, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))

        val reality = JSONObject(SingBoxConfigFactory().build(server))
            .getJSONArray("outbounds")
            .getJSONObject(0)
            .getJSONObject("tls")
            .getJSONObject("reality")

        assertTrue(reality.getBoolean("enabled"))
        assertEquals("reality-public-key", reality.getString("public_key"))
        assertEquals("a1b2c3d4", reality.getString("short_id"))
    }

    @Test
    fun trojanRuntimeValidationRejectsIncompleteProfiles() {
        val missingPassword = parseNativeLumenServer(
            type = "trojan-tcp-tls",
            security = """{ "type": "tls", "serverName": "live.lumen.local" }""",
            credentials = "{}"
        )
        val missingHost = missingPassword.copy(host = "")
        val invalidPort = missingPassword.copy(port = 0, password = "trojan-pass")

        assertFalse(RuntimeSupport.isConnectable(missingPassword))
        assertFalse(RuntimeSupport.isConnectable(missingHost))
        assertFalse(RuntimeSupport.isConnectable(invalidPort))
    }

    @Test
    fun nativeLumenShadowsocks2022UsesDedicatedPasswordAndMethodHint() {
        val server = parseNativeLumenServer(
            type = "shadowsocks-2022",
            security = """{ "type": "none" }""",
            credentials = """
                {
                  "password": "generic-password-must-not-be-used",
                  "shadowsocksPassword": "base64-2022-key"
                }
            """.trimIndent(),
            rendererHints = """
                {
                  "name": "SS 2022",
                  "method": "2022-blake3-aes-128-gcm"
                }
            """.trimIndent()
        )

        assertEquals(ProtocolType.SHADOWSOCKS, server.protocol)
        assertEquals(RuntimeBackend.SING_BOX, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))
        assertEquals("base64-2022-key", server.password)
        assertEquals("2022-blake3-aes-128-gcm", server.method)

        val outbound = JSONObject(SingBoxConfigFactory().build(server))
            .getJSONArray("outbounds")
            .getJSONObject(0)

        assertEquals("shadowsocks", outbound.getString("type"))
        assertEquals("85.192.60.8", outbound.getString("server"))
        assertEquals(18449, outbound.getInt("server_port"))
        assertEquals("2022-blake3-aes-128-gcm", outbound.getString("method"))
        assertEquals("base64-2022-key", outbound.getString("password"))
    }

    @Test
    fun nativeLumenShadowsocksV2rayPluginPreservesPluginFields() {
        val server = parseNativeLumenServer(
            type = "shadowsocks-v2ray-plugin",
            security = """{ "type": "none" }""",
            credentials = """
                {
                  "shadowsocksPassword": "ss-plugin-password"
                }
            """.trimIndent(),
            rendererHints = """
                {
                  "name": "SS Plugin",
                  "method": "aes-256-gcm",
                  "plugin": "v2ray-plugin",
                  "pluginOpts": "path=/ss;host=cdn.example.test"
                }
            """.trimIndent()
        )

        assertEquals(ProtocolType.SHADOWSOCKS, server.protocol)
        assertTrue(RuntimeSupport.isConnectable(server))
        val extra = JSONObject(server.extraJson)
        assertEquals("v2ray-plugin", extra.getString("plugin"))
        assertEquals("path=/ss;host=cdn.example.test", extra.getString("plugin_opts"))

        val outbound = JSONObject(SingBoxConfigFactory().build(server))
            .getJSONArray("outbounds")
            .getJSONObject(0)

        assertEquals("shadowsocks", outbound.getString("type"))
        assertEquals("aes-256-gcm", outbound.getString("method"))
        assertEquals("ss-plugin-password", outbound.getString("password"))
        assertEquals("v2ray-plugin", outbound.getString("plugin"))
        assertEquals("path=/ss;host=cdn.example.test", outbound.getString("plugin_opts"))
    }

    @Test
    fun nativeLumenWireGuardMaterializesNativeConfig() {
        val server = parseNativeLumenServer(
            type = "wireguard-native",
            endpoint = """{ "host": "wg.lumen.local", "port": 51820, "transport": "udp" }""",
            credentials = """
                {
                  "wireguardPrivateKey": "client-private-key",
                  "wireguardPublicKey": "server-public-key",
                  "presharedKey": "pre-shared-key"
                }
            """.trimIndent(),
            rendererHints = """
                {
                  "name": "WG Native",
                  "address": "10.66.0.2/32",
                  "allowedIps": "0.0.0.0/0, ::/0",
                  "mtu": "1280",
                  "persistentKeepalive": "25"
                }
            """.trimIndent()
        )

        assertEquals(ProtocolType.WIREGUARD, server.protocol)
        assertEquals(RuntimeBackend.AMNEZIAWG, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(server.rawUri.contains("[Interface]"))
        assertTrue(server.rawUri.contains("PrivateKey = client-private-key"))
        assertTrue(server.rawUri.contains("PublicKey = server-public-key"))
        assertTrue(server.rawUri.contains("Endpoint = wg.lumen.local:51820"))

        val config = JSONObject(SingBoxConfigFactory().build(server))
        val endpoint = config.getJSONArray("endpoints").getJSONObject(0)
        val peer = endpoint.getJSONArray("peers").getJSONObject(0)

        assertEquals("wireguard", endpoint.getString("type"))
        assertEquals("client-private-key", endpoint.getString("private_key"))
        assertEquals("server-public-key", peer.getString("public_key"))
        assertEquals("wg.lumen.local", peer.getString("address"))
        assertEquals(51820, peer.getInt("port"))
    }

    @Test
    fun nativeLumenAmneziaWireGuardMaterializesNativeConfig() {
        val server = parseNativeLumenServer(
            type = "wireguard-amneziawg",
            endpoint = """{ "host": "awg.lumen.local", "port": 51821, "transport": "udp" }""",
            security = """{ "type": "none", "publicKey": "server-public-key" }""",
            credentials = """
                {
                  "wireguardPrivateKey": "client-private-key",
                  "wireguardPublicKey": "client-public-key"
                }
            """.trimIndent(),
            rendererHints = """
                {
                  "name": "AWG Native",
                  "address": "10.77.0.2/32",
                  "allowedIps": "0.0.0.0/0",
                  "Jc": "4",
                  "Jmin": "40",
                  "Jmax": "70",
                  "S1": "60",
                  "H1": "123456789"
                }
            """.trimIndent()
        )

        assertEquals(ProtocolType.AMNEZIA_WG, server.protocol)
        assertEquals(RuntimeBackend.AMNEZIAWG, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(server.rawUri.contains("PublicKey = server-public-key"))
        assertFalse(server.rawUri.contains("PublicKey = client-public-key"))
        assertTrue(server.rawUri.contains("Jc = 4"))
        assertTrue(server.rawUri.contains("Jmin = 40"))
        assertTrue(server.rawUri.contains("Jmax = 70"))
        assertTrue(server.rawUri.contains("S1 = 60"))
        assertTrue(server.rawUri.contains("H1 = 123456789"))
    }

    @Test
    fun nativeLumenAmneziaWireGuardDropsNonpositiveIntegerOptions() {
        val server = parseNativeLumenServer(
            type = "wireguard-amneziawg",
            endpoint = """{ "host": "awg.lumen.local", "port": 51821, "transport": "udp" }""",
            security = """{ "type": "none", "publicKey": "server-public-key" }""",
            credentials = """
                {
                  "wireguardPrivateKey": "client-private-key",
                  "wireguardPublicKey": "client-public-key"
                }
            """.trimIndent(),
            rendererHints = """
                {
                  "name": "AWG Native",
                  "address": "10.77.0.2/32",
                  "allowedIps": "0.0.0.0/0",
                  "Jc": "4",
                  "Jmin": "0",
                  "Jmax": "-1",
                  "S1": "60"
                }
            """.trimIndent()
        )

        assertEquals(ProtocolType.AMNEZIA_WG, server.protocol)
        assertTrue(server.rawUri.contains("S1 = 60"))
        assertFalse(server.rawUri.contains("Jc ="))
        assertFalse(server.rawUri.contains("Jmin ="))
        assertFalse(server.rawUri.contains("Jmax ="))
    }

    @Test
    fun parsesShadowsocksLink() {
        val result = parser.parse("test", "ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#SS")
        val server = result.subscription.servers.single()
        assertEquals(ProtocolType.SHADOWSOCKS, server.protocol)
        assertEquals("aes-256-gcm", server.method)
        assertEquals("pass", server.password)
    }

    @Test
    fun parsesAndBuildsSocksRuntime() {
        val server = parser.parse("test", "socks5://user:pass@example.com:1080#SOCKS").subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.SOCKS, server.protocol)
        assertTrue(config.contains("\"type\": \"socks\""))
        assertTrue(config.contains("\"version\": \"5\""))
        assertTrue(config.contains("\"username\": \"user\""))
    }

    @Test
    fun parsesAndBuildsHttpProxyRuntime() {
        val server = parser.parse("test", "http://user:pass@example.com:8080#HTTP").subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.HTTP_PROXY, server.protocol)
        assertEquals("example.com", server.host)
        assertEquals(8080, server.port)
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(config.contains("\"type\": \"http\""))
        assertTrue(config.contains("\"username\": \"user\""))
        assertTrue(config.contains("\"password\": \"pass\""))
    }

    @Test
    fun parsesAndBuildsNaiveProxyRuntimeFromHttpsUri() {
        val server = parser.parse("test", "https://user:pass@example.com:8443?sni=edge.example.com#Naive").subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.NAIVE, server.protocol)
        assertEquals("example.com", server.host)
        assertEquals(8443, server.port)
        assertEquals("edge.example.com", server.sni)
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(config.contains("\"type\": \"naive\""))
        assertTrue(config.contains("\"username\": \"user\""))
        assertTrue(config.contains("\"password\": \"pass\""))
        assertTrue(config.contains("\"server_name\": \"edge.example.com\""))
    }

    @Test
    fun parsesWireGuardConfig() {
        val result = parser.parse(
            "wg",
            """
            [Interface]
            PrivateKey = priv
            Address = 10.0.0.2/32
            [Peer]
            PublicKey = peer
            Endpoint = 203.0.113.1:51820
            AllowedIPs = 0.0.0.0/0
            """.trimIndent()
        )
        val server = result.subscription.servers.single()
        assertEquals(ProtocolType.WIREGUARD, server.protocol)
        assertEquals("203.0.113.1", server.host)
    }

    @Test
    fun parsesWireGuardUriIntoNativeConfigBeforeMarkingConnectable() {
        val server = parser.parse(
            "wg-uri",
            "wireguard://client-private@example.com:51820?public_key=peer-public&address=10.0.0.2/32&allowed_ips=0.0.0.0/0,::/0#WG"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.WIREGUARD, server.protocol)
        assertEquals("WG", server.displayName)
        assertEquals("example.com", server.host)
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(server.rawUri.contains("[Interface]"))
        assertTrue(server.rawUri.contains("PrivateKey = client-private"))
        assertTrue(server.rawUri.contains("PublicKey = peer-public"))
        assertTrue(config.contains("\"type\": \"wireguard\""))
        assertTrue(config.contains("\"public_key\": \"peer-public\""))
    }

    @Test
    fun rejectsIncompleteWireGuardUriAsNotConnectable() {
        val server = parser.parse(
            "wg-uri",
            "wireguard://example.com:51820?public_key=peer-public#WG"
        ).subscription.servers.single()

        assertEquals(ProtocolType.WIREGUARD, server.protocol)
        assertFalse(RuntimeSupport.isConnectable(server))
        assertEquals(
            "WireGuard profile is incomplete: native .conf body is missing.",
            RuntimeSupport.validationIssue(server)
        )
    }

    @Test
    fun buildsAmneziaWireGuardRuntimeFields() {
        val server = parser.parse(
            "awg",
            """
            [Interface]
            PrivateKey = priv
            Address = 10.0.0.2/32
            Jc = 3
            Jmin = 40
            Jmax = 70
            S1 = 0
            S2 = 0
            H1 = 1
            H2 = 2
            H3 = 3
            H4 = 4
            [Peer]
            PublicKey = peer
            PresharedKey = psk
            Endpoint = 203.0.113.1:51820
            AllowedIPs = 0.0.0.0/0, ::/0
            Reserved = 1, 2, 3
            """.trimIndent()
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.AMNEZIA_WG, server.protocol)
        assertTrue(config.contains("\"type\": \"awg\""))
        assertTrue(config.contains("\"address\": \"203.0.113.1\""))
        assertTrue(config.contains("\"port\": 51820"))
        assertTrue(config.contains("\"peers\""))
        assertTrue(config.contains("\"preshared_key\": \"psk\""))
        assertTrue(config.contains("\"jc\": 3"))
        assertTrue(config.contains("\"h4\": \"4\""))
    }

    @Test
    fun buildsVlessRealityRuntimeWithFlowAndPacketEncoding() {
        val server = parser.parse(
            "test",
            "vless://11111111-1111-1111-1111-111111111111@example.com:443?security=reality&sni=site.com&pbk=pub&sid=abc&type=tcp&flow=xtls-rprx-vision&packet_encoding=xudp#RU"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"flow\": \"xtls-rprx-vision\""))
        assertTrue(config.contains("\"packet_encoding\": \"xudp\""))
    }

    @Test
    fun buildsVlessXhttpTransportWithoutConvertingItToHttpUpgrade() {
        val server = parser.parse(
            "test",
            "vless://11111111-1111-1111-1111-111111111111@203.0.113.10:443?security=reality&sni=site.com&pbk=pub&sid=abc&type=xhttp&mode=stream-up&host=front.example&path=%2Fxhttp#XHTTP"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals("site.com", server.sni)
        assertTrue(config.contains("\"type\": \"xhttp\""))
        assertTrue(config.contains("\"mode\": \"stream-up\""))
        assertTrue(config.contains("\"host\": \"front.example\""))
        assertTrue(config.contains("\"path\": \"/xhttp\""))
        assertFalse(config.contains("\"type\": \"httpupgrade\""))
    }

    @Test
    fun vlessUriHostQueryIsNotTreatedAsTlsServerName() {
        val server = parser.parse(
            "test",
            "vless://11111111-1111-1111-1111-111111111111@203.0.113.10:443?security=tls&type=xhttp&host=front.example&path=%2Fxhttp#HostHeaderOnly"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals("", server.sni)
        assertTrue(config.contains("\"type\": \"xhttp\""))
        assertTrue(config.contains("\"host\": \"front.example\""))
        assertFalse(config.contains("\"server_name\": \"front.example\""))
    }

    @Test
    fun buildsVlessWsTransportFromClashNestedHeaders() {
        val server = parser.parse(
            "clash",
            """
            proxies:
              - name: WS
                type: vless
                server: example.com
                port: 443
                uuid: 11111111-1111-1111-1111-111111111111
                tls: true
                servername: sni.example
                network: ws
                ws-opts:
                  path: /socket
                  headers:
                    Host: front.example
            """.trimIndent()
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"type\": \"ws\""))
        assertTrue(config.contains("\"path\": \"/socket\""))
        assertTrue(config.contains("\"Host\": \"front.example\""))
        assertTrue(config.contains("\"server_name\": \"sni.example\""))
    }

    @Test
    fun convertsSupportedClashAliasesIntoRealRuntimeProfiles() {
        val servers = parser.parse(
            "clash",
            """
            proxies:
              - name: HY2
                type: hy2
                server: hy.example.com
                port: 443
                password: hy-secret
                sni: hy.example.com
                obfs: salamander
                obfs-password: mask
              - name: TUIC
                type: tuic
                server: tuic.example.com
                port: 443
                uuid: 11111111-1111-1111-1111-111111111111
                password: tuic-secret
                sni: tuic.example.com
                congestion-controller: bbr
                udp-relay-mode: native
              - name: SOCKS4A
                type: socks4a
                server: socks.example.com
                port: 1080
                username: u
                password: p
            """.trimIndent()
        ).subscription.servers

        val hy2 = servers.single { it.displayName == "HY2" }
        val tuic = servers.single { it.displayName == "TUIC" }
        val socks = servers.single { it.displayName == "SOCKS4A" }
        val hy2Config = SingBoxConfigFactory().build(hy2)
        val tuicConfig = SingBoxConfigFactory().build(tuic)
        val socksConfig = SingBoxConfigFactory().build(socks)

        assertEquals(ProtocolType.HYSTERIA2, hy2.protocol)
        assertTrue(RuntimeSupport.isConnectable(hy2))
        assertTrue(hy2Config.contains("\"type\": \"hysteria2\""))
        assertTrue(hy2Config.contains("\"password\": \"mask\""))
        assertEquals(ProtocolType.TUIC, tuic.protocol)
        assertTrue(RuntimeSupport.isConnectable(tuic))
        assertTrue(tuicConfig.contains("\"congestion_control\": \"bbr\""))
        assertTrue(tuicConfig.contains("\"udp_relay_mode\": \"native\""))
        assertEquals(ProtocolType.SOCKS, socks.protocol)
        assertTrue(RuntimeSupport.isConnectable(socks))
        assertTrue(socksConfig.contains("\"version\": \"4a\""))
    }

    @Test
    fun buildsVlessRealityGrpcFromXrayJson() {
        val server = parser.parse(
            "xray-grpc",
            """
            {
              "outbounds": [{
                "tag": "Reality gRPC",
                "protocol": "vless",
                "settings": {
                  "vnext": [{
                    "address": "example.com",
                    "port": 443,
                    "users": [{
                      "id": "11111111-1111-1111-1111-111111111111",
                      "flow": "xtls-rprx-vision",
                      "packetEncoding": "xudp"
                    }]
                  }]
                },
                "streamSettings": {
                  "network": "grpc",
                  "security": "reality",
                  "realitySettings": {
                    "serverName": "site.example",
                    "publicKey": "pub",
                    "shortId": ["abc"],
                    "fingerprint": "chrome"
                  },
                  "grpcSettings": {"serviceName": "grpc-service"}
                }
              }]
            }
            """.trimIndent()
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"type\": \"grpc\""))
        assertTrue(config.contains("\"service_name\": \"grpc-service\""))
        assertTrue(config.contains("\"flow\": \"xtls-rprx-vision\""))
        assertTrue(config.contains("\"packet_encoding\": \"xudp\""))
        assertTrue(config.contains("\"public_key\": \"pub\""))
    }

    @Test
    fun buildsVlessHttpTransportFromXrayJson() {
        val server = parser.parse(
            "xray-http",
            """
            {
              "outbounds": [{
                "tag": "H2",
                "protocol": "vless",
                "settings": {
                  "vnext": [{
                    "address": "example.com",
                    "port": 443,
                    "users": [{"id": "11111111-1111-1111-1111-111111111111"}]
                  }]
                },
                "streamSettings": {
                  "network": "h2",
                  "security": "tls",
                  "tlsSettings": {"serverName": "site.example", "alpn": ["h2"]},
                  "httpSettings": {
                    "host": ["front.example"],
                    "path": "/h2"
                  }
                }
              }]
            }
            """.trimIndent()
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"type\": \"http\""))
        assertTrue(config.contains("\"host\": ["))
        assertTrue(config.contains("\"front.example\""))
        assertTrue(config.contains("\"path\": \"/h2\""))
        assertTrue(config.contains("\"alpn\": ["))
    }

    @Test
    fun buildsHysteria2RuntimeWithObfs() {
        val server = parser.parse(
            "test",
            "hysteria2://secret@example.com:443?sni=site.com&obfs=salamander&obfs-password=mask#HY2"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"type\": \"hysteria2\""))
        assertTrue(config.contains("\"obfs\""))
        assertTrue(config.contains("\"password\": \"mask\""))
    }

    @Test
    fun parsesLegacyHysteriaJsonOutbound() {
        val content = """
            {
              "outbounds": [
                {
                  "type": "hysteria",
                  "tag": "НОВЫЙ ПРОТОКОЛ",
                  "server": "hy.example.com",
                  "server_port": 443,
                  "auth_str": "secret",
                  "tls": { "enabled": true, "server_name": "site.com" }
                }
              ]
            }
        """.trimIndent()
        val server = parser.parse("test", content).subscription.servers.single()
        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.HYSTERIA, server.protocol)
        assertEquals("hy.example.com", server.host)
        assertEquals(443, server.port)
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(config.contains("\"type\": \"hysteria\""))
        assertTrue(config.contains("\"auth_str\": \"secret\""))
    }

    @Test
    fun keepsLegacyHysteriaWhenMixedWithXrayJson() {
        val content = """
            {
              "outbounds": [
                {
                  "protocol": "vless",
                  "tag": "VLESS",
                  "settings": {
                    "vnext": [
                      {
                        "address": "vless.example.com",
                        "port": 443,
                        "users": [ { "id": "00000000-0000-4000-8000-000000000000" } ]
                      }
                    ]
                  },
                  "streamSettings": { "network": "tcp", "security": "tls" }
                },
                {
                  "type": "hysteria",
                  "tag": "НОВЫЙ ПРОТОКОЛ",
                  "server": "hy.example.com",
                  "server_port": 443,
                  "auth_str": "secret",
                  "tls": { "enabled": true }
                }
              ]
            }
        """.trimIndent()

        val servers = parser.parse("test", content).subscription.servers

        assertEquals(2, servers.size)
        assertTrue(servers.any { it.protocol == ProtocolType.VLESS })
        assertTrue(servers.any { it.protocol == ProtocolType.HYSTERIA })
    }

    @Test
    fun parsesMixedUriAndSingleHysteriaJsonLine() {
        val content = """
            vless://00000000-0000-4000-8000-000000000000@vless.example.com:443?encryption=none&type=tcp&security=reality&pbk=public&sid=1&sni=site.com#VLESS
            {"type":"hysteria","tag":"NEW PROTOCOL","server":"hy.example.com","server_port":443,"auth_str":"secret","tls":{"enabled":true,"server_name":"site.com"}}
        """.trimIndent()

        val servers = parser.parse("test", content).subscription.servers

        assertEquals(2, servers.size)
        assertTrue(servers.any { it.protocol == ProtocolType.VLESS })
        assertTrue(servers.any { it.protocol == ProtocolType.HYSTERIA && it.displayName == "NEW PROTOCOL" })
    }

    @Test
    fun parsesSingleSingBoxHysteriaOutboundObject() {
        val content = """{"type":"hysteria","tag":"NEW PROTOCOL","server":"hy.example.com","server_port":443,"auth_str":"secret","tls":{"enabled":true,"server_name":"site.com"}}"""

        val server = parser.parse("test", content).subscription.servers.single()

        assertEquals(ProtocolType.HYSTERIA, server.protocol)
        assertEquals("NEW PROTOCOL", server.displayName)
        assertEquals("hy.example.com", server.host)
    }

    @Test
    fun parsesXrayHappHysteriaOutboundAndSelectsXrayRuntime() {
        val content = """
            [
              {
                "remarks": "NEW PROTOCOL",
                "outbounds": [
                  {
                    "tag": "proxy",
                    "protocol": "hysteria",
                    "settings": {
                      "version": 2,
                      "address": "hy.example.com",
                      "port": 443
                    },
                    "streamSettings": {
                      "network": "hysteria",
                      "security": "tls",
                      "hysteriaSettings": { "version": 2 },
                      "tlsSettings": {
                        "serverName": "site.com",
                        "fingerprint": "chrome",
                        "alpn": ["h3"]
                      }
                    }
                  }
                ]
              }
            ]
        """.trimIndent()

        val server = parser.parse("test", content).subscription.servers.single()

        assertEquals(ProtocolType.HYSTERIA, server.protocol)
        assertEquals("NEW PROTOCOL", server.displayName)
        assertEquals("hy.example.com", server.host)
        assertEquals(443, server.port)
        assertEquals("hysteria", server.transport)
        assertEquals("tls", server.security)
        assertEquals(RuntimeBackend.XRAY_CORE, RuntimeSupport.backend(server))
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(server.extraJson.contains("\"protocol\":\"hysteria\""))
        assertTrue(server.extraJson.contains("\"network\":\"hysteria\""))
    }

    @Test
    fun buildsHysteria2DefaultPortAndUserpassAuth() {
        val server = parser.parse(
            "test",
            "hy2://user:pass@example.com?sni=site.com#HY2"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.HYSTERIA2, server.protocol)
        assertEquals("example.com", server.host)
        assertEquals(443, server.port)
        assertTrue(config.contains("\"password\": \"user:pass\""))
        assertTrue(config.contains("\"server_port\": 443"))
    }

    @Test
    fun buildsHysteria2MportHopIntervalAndTlsPin() {
        val server = parser.parse(
            "test",
            "hysteria2://secret@example.com:443?sni=site.com&mport=443,8443-8450&hop-interval=30s&pinSHA256=abc123&insecure=1#HY2"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"server_ports\": ["))
        assertTrue(config.contains("\"443\""))
        assertTrue(config.contains("\"8443:8450\""))
        assertTrue(config.contains("\"hop_interval\": \"30s\""))
        assertTrue(config.contains("\"certificate_public_key_sha256\": ["))
        assertTrue(config.contains("\"abc123\""))
        assertTrue(config.contains("\"insecure\": true"))
    }

    @Test
    fun buildsHysteria2AuthorityMultiPortWithoutConflictingServerPort() {
        val server = parser.parse(
            "test",
            "hysteria2://secret@example.com:123,5000-6000/?sni=site.com#HY2"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals("example.com", server.host)
        assertEquals(123, server.port)
        assertTrue(config.contains("\"server_ports\": ["))
        assertTrue(config.contains("\"5000:6000\""))
        val hysteriaOutbound = config.substringAfter("\"type\": \"hysteria2\"").substringBefore("\"type\": \"direct\"")
        assertFalse(hysteriaOutbound.contains("\"server_port\":"))
    }

    @Test
    fun rejectsHysteria2WithoutAuth() {
        val server = parser.parse(
            "test",
            "hysteria2://example.com:443?sni=site.com#HY2"
        ).subscription.servers.single()

        assertFalse(RuntimeSupport.isConnectable(server))
        assertThrows(IllegalArgumentException::class.java) {
            SingBoxConfigFactory().build(server)
        }
    }

    @Test
    fun buildsTuicRuntimeWithUdpRelayMode() {
        val server = parser.parse(
            "test",
            "tuic://11111111-1111-1111-1111-111111111111:secret@example.com:443?sni=site.com&udp_relay_mode=quic&congestion_control=bbr#TUIC"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"type\": \"tuic\""))
        assertTrue(config.contains("\"udp_relay_mode\": \"quic\""))
        assertTrue(config.contains("\"congestion_control\": \"bbr\""))
    }

    @Test
    fun parsesCloakJsonConfig() {
        val result = parser.parse(
            "cloak",
            """
            {
              "BrowserSig": "chrome",
              "EncryptionMethod": "aes-gcm",
              "NumConn": 1,
              "ProxyMethod": "shadowsocks",
              "PublicKey": "public-key",
              "RemoteHost": "203.0.113.10",
              "RemotePort": "443",
              "ServerName": "tile.openstreetmap.org",
              "Transport": "direct",
              "UID": "uid-value"
            }
            """.trimIndent()
        )
        val server = result.subscription.servers.single()
        assertEquals(ProtocolType.OPENVPN_CLOAK, server.protocol)
        assertEquals("203.0.113.10", server.host)
        assertEquals("tile.openstreetmap.org", server.sni)
    }

    @Test
    fun parsesXrayJsonConfig() {
        val result = parser.parse(
            "xray",
            """
            {
              "outbounds": [{
                "tag": "RU Reality",
                "protocol": "vless",
                "settings": {
                  "vnext": [{
                    "address": "example.com",
                    "port": 443,
                    "users": [{"id": "11111111-1111-1111-1111-111111111111", "encryption": "none"}]
                  }]
                },
                "streamSettings": {
                  "network": "tcp",
                  "security": "reality",
                  "realitySettings": {"serverName": "site.com", "publicKey": "pub", "shortId": ["abc"]}
                }
              }]
            }
            """.trimIndent()
        )
        val server = result.subscription.servers.single()
        assertEquals(ProtocolType.VLESS, server.protocol)
        assertEquals("example.com", server.host)
        assertEquals("pub", server.publicKey)
    }

    @Test
    fun parsesAmneziaVpnUrlWithSsxrayContainer() {
        val xrayJson = """
            {
              "outbounds": [{
                "tag": "FR Shadowsocks",
                "protocol": "shadowsocks",
                "settings": {
                  "servers": [{
                    "address": "198.51.100.10",
                    "port": 443,
                    "method": "aes-256-gcm",
                    "password": "demo-pass"
                  }]
                }
              }]
            }
        """.trimIndent()
        val amneziaJson = """
            {
              "description": "La France",
              "hostName": "198.51.100.10",
              "containers": [{
                "container": "amnezia-ssxray",
                "ssxray": {
                  "last_config": ${xrayJson.jsonLiteral()},
                  "isThirdPartyConfig": true
                }
              }]
            }
        """.trimIndent()
        val server = parser.parse("qr", "vpn://${qCompressBase64Url(amneziaJson)}")
            .subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.SHADOWSOCKS, server.protocol)
        assertEquals("198.51.100.10", server.host)
        assertTrue(config.contains("\"type\": \"shadowsocks\""))
        assertTrue(config.contains("\"server_port\": 443"))
    }

    @Test
    fun parsesAmneziaVpnUrlWithSnakeCaseAwgContainer() {
        val awgJson = """
            {
              "hostName": "198.51.100.20",
              "port": 34314,
              "client_priv_key": "client-private",
              "server_pub_key": "server-public",
              "psk_key": "peer-shared",
              "client_ip": "10.8.0.2/32",
              "allowed_ips": "0.0.0.0/0, ::/0",
              "Jc": "3",
              "Jmin": "40",
              "Jmax": "70",
              "S1": "0",
              "S2": "0",
              "H1": "1",
              "H2": "2",
              "H3": "3",
              "H4": "4"
            }
        """.trimIndent()
        val amneziaJson = """
            {
              "description": "AWG Demo",
              "containers": [{
                "container": "amnezia-awg",
                "awg": {
                  "last_config": ${awgJson.jsonLiteral()}
                }
              }]
            }
        """.trimIndent()

        val server = parser.parse("qr", "vpn://${qCompressBase64Url(amneziaJson)}")
            .subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertEquals(ProtocolType.AMNEZIA_WG, server.protocol)
        assertEquals("198.51.100.20", server.host)
        assertTrue(config.contains("\"type\": \"awg\""))
        assertTrue(config.contains("\"preshared_key\": \"peer-shared\""))
    }

    @Test
    fun parsesRawOpenVpnConfigAsOpenVpnProfile() {
        val server = parser.parse(
            "ovpn",
            """
            client
            dev tun
            proto udp
            remote 198.51.100.30 1194
            <ca>
            demo
            </ca>
            """.trimIndent()
        ).subscription.servers.single()

        assertEquals(ProtocolType.OPENVPN, server.protocol)
        assertEquals("198.51.100.30", server.host)
        assertTrue(RuntimeSupport.isConnectable(server))
        assertTrue(RuntimeSupport.isWindowsConnectable(server))
        assertThrows(IllegalArgumentException::class.java) {
            SingBoxConfigFactory().build(server)
        }
    }

    @Test
    fun parsesOpenVpnCloakCompoundProfile() {
        val server = parser.parse(
            "compound-cloak",
            """
            {
              "name": "Cloak Compound",
              "openvpn_config": ${openVpnConfig().jsonLiteral()},
              "cloak": {
                "RemoteHost": "203.0.113.10",
                "RemotePort": "443",
                "PublicKey": "public-key",
                "UID": "uid-value",
                "ProxyMethod": "openvpn",
                "ServerName": "front.example"
              }
            }
            """.trimIndent()
        ).subscription.servers.single()

        assertEquals(ProtocolType.OPENVPN_CLOAK, server.protocol)
        assertEquals("203.0.113.10", server.host)
        assertTrue(server.rawUri.contains("client"))
        assertTrue(server.extraJson.contains("RemoteHost"))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun parsesAmneziaOpenVpnCloakFromLastConfigContainer() {
        val openVpnLastConfig = """{"config":${openVpnConfig().jsonLiteral()},"block_outside_dns":false}"""
        val server = parser.parse(
            "amnezia-openvpn-cloak",
            """
            {
              "description": "Server 1",
              "hostName": "46.226.166.94",
              "containers": [
                {
                  "container": "openvpn",
                  "openvpn": {
                    "last_config": ${openVpnLastConfig.jsonLiteral()}
                  }
                },
                {
                  "container": "cloak",
                  "cloak": {
                    "RemoteHost": "46.226.166.94",
                    "RemotePort": "443",
                    "PublicKey": "public-key",
                    "UID": "uid-value",
                    "ProxyMethod": "openvpn",
                    "ServerName": "tile.openstreetmap.org"
                  }
                }
              ]
            }
            """.trimIndent()
        ).subscription.servers.single()

        assertEquals(ProtocolType.OPENVPN_CLOAK, server.protocol)
        assertEquals("46.226.166.94", server.host)
        assertEquals(443, server.port)
        assertTrue(server.rawUri.contains("client"))
        assertTrue(server.extraJson.contains("RemoteHost"))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun parsesOpenVpnShadowsocksCompoundProfile() {
        val server = parser.parse(
            "compound-ss",
            """
            {
              "openvpn_config": ${openVpnConfig().jsonLiteral()},
              "proxy": {
                "type": "shadowsocks",
                "server": "198.51.100.40",
                "server_port": 8388,
                "method": "aes-256-gcm",
                "password": "secret"
              }
            }
            """.trimIndent()
        ).subscription.servers.single()

        assertEquals(ProtocolType.OPENVPN_SHADOWSOCKS, server.protocol)
        assertEquals("198.51.100.40", server.host)
        assertTrue(server.extraJson.contains("shadowsocks"))
        assertTrue(RuntimeSupport.isConnectable(server))

        val bridge = XrayConfigFactory().buildOpenVpnShadowsocksBridge(
            profile = server,
            targetHost = "198.51.100.30",
            targetPort = 1194,
            localBridgePort = 39194,
        )
        val config = JSONObject(bridge.fullJsonConfig)
        val inbound = config.getJSONArray("inbounds").getJSONObject(0)
        val outbound = config.getJSONArray("outbounds").getJSONObject(0)
        assertEquals("dokodemo-door", inbound.getString("protocol"))
        assertEquals("127.0.0.1", inbound.getString("listen"))
        assertEquals(39194, inbound.getInt("port"))
        assertEquals("198.51.100.30", inbound.getJSONObject("settings").getString("address"))
        assertEquals("shadowsocks", outbound.getString("protocol"))
        assertEquals("198.51.100.40", outbound.getJSONObject("settings").getJSONArray("servers").getJSONObject(0).getString("address"))
    }

    @Test
    fun parsesLumenNativeOpenVpnShadowsocksManifest() {
        val server = parser.parse(
            "lumen-ovpn-ss",
            """
            {
              "schemaVersion": "lumen.subscription-manifest.v1",
              "subscription": { "id": "sub-1" },
              "provider": { "name": "Lumen" },
              "nodes": [
                {
                  "displayName": "node-01",
                  "protocols": [
                    {
                      "id": "openvpn-ss",
                      "type": "openvpn-shadowsocks",
                      "adapter": "openvpn-shadowsocks",
                      "endpoint": {
                        "host": "198.51.100.40",
                        "port": 28443,
                        "transport": "tcp",
                        "network": "public"
                      },
                      "security": { "type": "tls" },
                      "credentials": {
                        "username": "user",
                        "shadowsocksPassword": "ss-pass"
                      },
                      "rendererHints": {
                        "name": "OpenVPN over SS",
                        "method": "aes-256-gcm",
                        "openvpnRemoteHost": "127.0.0.1",
                        "openvpnRemotePort": 24194,
                        "caCert": "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----"
                      }
                    }
                  ]
                }
              ]
            }
            """.trimIndent(),
            "Lumen native"
        ).subscription.servers.single()

        assertEquals(ProtocolType.OPENVPN_SHADOWSOCKS, server.protocol)
        assertEquals("198.51.100.40", server.host)
        assertEquals(28443, server.port)
        assertEquals("aes-256-gcm", server.method)
        assertEquals("ss-pass", server.password)
        assertTrue(server.rawUri.contains("remote 127.0.0.1 24194"))
        assertFalse(server.rawUri.contains("socks-proxy"))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun parsesIkev2UriProfile() {
        val server = parser.parse("ikev2", "ikev2://user:pass@example.com:500#IKE").subscription.servers.single()

        assertEquals(ProtocolType.IPSEC, server.protocol)
        assertEquals("example.com", server.host)
        assertEquals("user", server.username)
        assertEquals("pass", server.password)
        assertFalse(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun parsesStrongSwanIkev2EapProfileAsAndroidConnectable() {
        val ca = "-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----"
        val encodedCa = Base64.getEncoder().encodeToString(ca.toByteArray(Charsets.UTF_8))
        val server = parser.parse(
            "ikev2-sswan",
            """
            {
              "uuid": "ikev2-test",
              "name": "IKEv2 Live",
              "type": "ikev2-eap",
              "remote": {
                "addr": "vpn.example.com",
                "port": 500,
                "id": "vpn.example.com",
                "cert": "$encodedCa"
              },
              "local": {
                "eap_id": "user-1",
                "shared_secret": "pass-1"
              },
              "mtu": 1400,
              "dns-servers": ["1.1.1.1", "8.8.8.8"]
            }
            """.trimIndent()
        ).subscription.servers.single()

        assertEquals(ProtocolType.IPSEC, server.protocol)
        assertEquals(RuntimeBackend.ANDROID_IKEV2, RuntimeSupport.backend(server))
        assertEquals("vpn.example.com", server.host)
        assertEquals(500, server.port)
        assertEquals("user-1", server.username)
        assertEquals("pass-1", server.password)
        assertTrue(server.extraJson.contains("ikev2_ca_cert"))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun buildsSingBoxConfig() {
        val server = parser.parse(
            "test",
            "trojan://secret@example.com:443?sni=example.com#Trojan"
        ).subscription.servers.single()
        val config = SingBoxConfigFactory().build(server)
        assertTrue(config.contains("\"type\": \"tun\""))
        assertTrue(config.contains("\"type\": \"trojan\""))
        assertTrue(config.contains("\"server\": \"example.com\""))
    }

    @Test
    fun buildsSingBoxConfigWithRoutingAndDnsSettings() {
        val server = parser.parse(
            "test",
            "trojan://secret@example.com:443?sni=example.com#Trojan"
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(
            server,
            RuntimeSettings(
                dnsMode = "quad9",
                bypassPrivateNetworks = true,
                strictRoute = true,
                ipv6 = true,
                sniff = false,
            )
        )

        assertTrue(config.contains("\"tag\": \"quad9\""))
        assertTrue(config.contains("\"type\": \"https\""))
        assertTrue(config.contains("\"detour\": \"proxy\""))
        assertTrue(config.contains("\"address\": ["))
        assertTrue(config.contains("\"fdfe:dcba:9876::1/126\""))
        assertTrue(config.contains("\"strict_route\": true"))
        assertFalse(config.contains("\"action\": \"sniff\""))
        assertTrue(config.contains("\"port\": 53"))
        assertTrue(config.contains("\"action\": \"hijack-dns\""))
        assertTrue(config.contains("\"ip_cidr\""))
        assertTrue(config.contains("\"outbound\": \"direct\""))
    }

    @Test
    fun rawSingBoxConfigGetsTunDnsHijackAndFinalRoute() {
        val server = parser.parse(
            "raw",
            """
            {
              "outbounds": [
                {"type": "custom-test", "tag": "node", "server": "example.com", "server_port": 443}
              ]
            }
            """.trimIndent()
        ).subscription.servers.single()

        val config = SingBoxConfigFactory().build(server)

        assertTrue(config.contains("\"type\": \"tun\""))
        assertTrue(config.contains("\"port\": 53"))
        assertTrue(config.contains("\"action\": \"hijack-dns\""))
        assertTrue(config.contains("\"final\": \"node\""))
        assertTrue(config.contains("\"tag\": \"cloudflare\""))
        assertTrue(config.contains("\"detour\": \"proxy\""))
        assertTrue(config.contains("\"strategy\": \"ipv4_only\""))
    }

    @Test
    fun unsupportedCloakProfileDoesNotBuildDirectConfig() {
        val server = parser.parse(
            "cloak",
            """
            {
              "BrowserSig": "chrome",
              "EncryptionMethod": "aes-gcm",
              "ProxyMethod": "shadowsocks",
              "PublicKey": "public-key",
              "RemoteHost": "203.0.113.10",
              "RemotePort": "443",
              "ServerName": "tile.openstreetmap.org",
              "UID": "uid-value"
            }
            """.trimIndent()
        ).subscription.servers.single()

        val error = assertThrows(IllegalArgumentException::class.java) {
            SingBoxConfigFactory().build(server)
        }

        assertTrue(error.message.orEmpty().contains("OpenVPN over Cloak"))
    }

    @Test
    fun redactsSecrets() {
        val redacted = SecretRedactor.redact(
            """
            vless://uuid@example.com password=abc token=def
            auth=hysteria-secret auth_str=hysteria-secret-2
            {"auth":"hysteria-json-secret","auth_str":"hysteria-json-secret-2"}
            wireguard://private@example.com
            mihomo://install-config?url=https%3A%2F%2Fsub.example.test%2Ftoken
            stash://install-config?url=https%3A%2F%2Fsub.example.test%2Ftoken
            nekobox://import-remote-profile/https%3A%2F%2Fsub.example.test%2Ftoken
            nekoray://import-remote-profile/https%3A%2F%2Fsub.example.test%2Ftoken
            v2rayng://install-sub?url=https%3A%2F%2Fsub.example.test%2Ftoken
            https://panel.example.test/api/v1/subscriptions/public/lumen_sub_secret/render?target=happ
            https://sub.example.test/sub/lumen_sub_secret/happ
            PrivateKey = private-value
            PresharedKey = psk-value
            """.trimIndent()
        )
        assertTrue(redacted.contains("vless://<redacted>"))
        assertTrue(redacted.contains("wireguard://<redacted>"))
        assertTrue(redacted.contains("mihomo://<redacted>"))
        assertTrue(redacted.contains("stash://<redacted>"))
        assertTrue(redacted.contains("nekobox://<redacted>"))
        assertTrue(redacted.contains("nekoray://<redacted>"))
        assertTrue(redacted.contains("v2rayng://<redacted>"))
        assertTrue(redacted.contains("https://panel.example.test/api/v1/subscriptions/public/<redacted>/render?target=happ"))
        assertTrue(redacted.contains("https://sub.example.test/sub/<redacted>/happ"))
        assertTrue(redacted.contains("password=<redacted>"))
        assertTrue(redacted.contains("token=<redacted>"))
        assertTrue(redacted.contains("auth=<redacted>"))
        assertTrue(redacted.contains("auth_str=<redacted>"))
        assertTrue(redacted.contains("\"auth\":\"<redacted>\""))
        assertTrue(redacted.contains("\"auth_str\":\"<redacted>\""))
        assertTrue(redacted.contains("PrivateKey = <redacted>"))
        assertTrue(redacted.contains("PresharedKey = <redacted>"))
    }

    private fun String.jsonLiteral(): String =
        "\"" + replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\r", "\\r")
            .replace("\n", "\\n") + "\""

    private fun parseNativeLumenServer(
        type: String,
        security: String = "{}",
        credentials: String,
        endpoint: String = """{ "host": "85.192.60.8", "port": 18449, "transport": "tcp" }""",
        rendererHints: String = """{ "name": "$type live" }""",
    ) = parser.parse(
        "lumen-json",
        """
        {
          "schemaVersion": "lumen.subscription-manifest.v1",
          "subscription": { "id": "lumen_sub_test" },
          "nodes": [
            {
              "id": "node-1",
              "displayName": "Live node",
              "protocols": [
                {
                  "id": "$type",
                  "type": "$type",
                  "endpoint": $endpoint,
                  "security": $security,
                  "credentials": $credentials,
                  "rendererHints": $rendererHints
                }
              ]
            }
          ]
        }
        """.trimIndent(),
        "Lumen native"
    ).subscription.servers.single()

    private fun openVpnConfig(): String =
        """
        client
        dev tun
        proto tcp
        remote 198.51.100.30 1194
        <ca>
        demo
        </ca>
        """.trimIndent()

    private fun qCompressBase64Url(text: String): String {
        val input = text.toByteArray()
        val deflater = Deflater(8)
        deflater.setInput(input)
        deflater.finish()
        val compressed = ByteArrayOutputStream()
        val buffer = ByteArray(256)
        while (!deflater.finished()) {
            compressed.write(buffer, 0, deflater.deflate(buffer))
        }
        val output = ByteBuffer.allocate(4 + compressed.size())
            .order(ByteOrder.BIG_ENDIAN)
            .putInt(input.size)
            .put(compressed.toByteArray())
            .array()
        return Base64.getUrlEncoder().withoutPadding().encodeToString(output)
    }
}
