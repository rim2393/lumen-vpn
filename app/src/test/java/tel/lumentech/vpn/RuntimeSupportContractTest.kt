package tel.lumentech.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.runtime.SingBoxConfigFactory
import tel.lumentech.vpn.runtime.XrayConfigFactory
import tel.lumentech.vpn.subscription.SubscriptionParser

class RuntimeSupportContractTest {
    private val parser = SubscriptionParser()

    @Test
    fun vlessRealityFromSubscriptionIsConnectableThroughXray() {
        val server = parser.parse(
            source = "unit-vless",
            content = "vless://11111111-1111-4111-8111-111111111111@node.example.test:443" +
                "?security=reality&sni=www.microsoft.com&pbk=reality-public-key&sid=abcd&type=tcp&flow=xtls-rprx-vision#Lumen%20Reality",
        ).subscription.servers.single()

        assertEquals(ProtocolType.VLESS, server.protocol)
        assertEquals(RuntimeBackend.XRAY_CORE, RuntimeSupport.backend(server))
        assertNull(RuntimeSupport.validationIssue(server))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun rawXrayOutboundIsConnectableWithoutDuplicatedUuidFields() {
        val server = profile(
            protocol = ProtocolType.XRAY,
            displayName = "Raw Xray",
            host = "node.example.test",
            port = 443,
            rawUri = """
                {
                  "outbounds": [
                    {
                      "tag": "proxy",
                      "protocol": "vless",
                      "settings": {
                        "vnext": [
                          {
                            "address": "node.example.test",
                            "port": 443,
                            "users": [
                              { "id": "11111111-1111-4111-8111-111111111111", "encryption": "none" }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertEquals(RuntimeBackend.XRAY_CORE, RuntimeSupport.backend(server))
        assertNull(RuntimeSupport.validationIssue(server))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun rawSingBoxNaiveOutboundIsConnectable() {
        val server = profile(
            protocol = ProtocolType.NAIVE,
            displayName = "Raw Naive",
            host = "naive.example.test",
            port = 443,
            rawUri = """
                {
                  "outbounds": [
                    {
                      "type": "naive",
                      "tag": "Raw Naive",
                      "server": "naive.example.test",
                      "server_port": 443,
                      "username": "lumen-user",
                      "password": "lumen-password"
                    }
                  ]
                }
            """.trimIndent(),
        )

        assertEquals(RuntimeBackend.SING_BOX, RuntimeSupport.backend(server))
        assertNull(RuntimeSupport.validationIssue(server))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun wireGuardConfUsesAmneziaWireGuardBackend() {
        val server = profile(
            protocol = ProtocolType.WIREGUARD,
            displayName = "WireGuard",
            rawUri = """
                [Interface]
                PrivateKey = client-private-key
                Address = 10.9.0.2/32
                DNS = 1.1.1.1

                [Peer]
                PublicKey = peer-public-key
                Endpoint = wg.example.test:51820
                AllowedIPs = 0.0.0.0/0, ::/0
            """.trimIndent(),
        )

        assertEquals(RuntimeBackend.AMNEZIAWG, RuntimeSupport.backend(server))
        assertNull(RuntimeSupport.validationIssue(server))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun openVpnProfileIsConnectableWhenOvpnBodyIsPresent() {
        val server = profile(
            protocol = ProtocolType.OPENVPN,
            displayName = "OpenVPN",
            rawUri = tcpOpenVpnProfile(),
        )

        assertEquals(RuntimeBackend.OPENVPN, RuntimeSupport.backend(server))
        assertNull(RuntimeSupport.validationIssue(server))
        assertTrue(RuntimeSupport.isConnectable(server))
    }

    @Test
    fun openVpnOverShadowsocksRequiresTcpBridge() {
        val tcpServer = profile(
            protocol = ProtocolType.OPENVPN_SHADOWSOCKS,
            displayName = "OpenVPN SS TCP",
            host = "ss.example.test",
            port = 8388,
            method = "2022-blake3-aes-128-gcm",
            password = "bridge-password",
            rawUri = tcpOpenVpnProfile(),
            extraJson = """{"shadowsocks":{"localPort":1081}}""",
        )
        val udpServer = tcpServer.copy(displayName = "OpenVPN SS UDP", rawUri = udpOpenVpnProfile())

        assertEquals(RuntimeBackend.OPENVPN_SHADOWSOCKS, RuntimeSupport.backend(tcpServer))
        assertNull(RuntimeSupport.validationIssue(tcpServer))
        assertTrue(RuntimeSupport.isConnectable(tcpServer))

        val issue = RuntimeSupport.validationIssue(udpServer).orEmpty()
        assertFalse(RuntimeSupport.isConnectable(udpServer))
        assertTrue(issue.contains("TCP", ignoreCase = true))
    }

    @Test
    fun ikev2RequiresRootCaBeforeConnect() {
        val missingCa = profile(
            protocol = ProtocolType.IPSEC,
            displayName = "IKEv2 missing CA",
            host = "ike.example.test",
            username = "user",
            password = "password",
        )
        val withCa = missingCa.copy(
            displayName = "IKEv2",
            extraJson = """{"ikev2_ca_cert":"-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"}""",
        )

        assertEquals(RuntimeBackend.ANDROID_IKEV2, RuntimeSupport.backend(missingCa))
        assertFalse(RuntimeSupport.isConnectable(missingCa))
        assertTrue(RuntimeSupport.validationIssue(missingCa).orEmpty().contains("root CA", ignoreCase = true))
        assertNull(RuntimeSupport.validationIssue(withCa))
        assertTrue(RuntimeSupport.isConnectable(withCa))
    }

    @Test
    fun routingScreenSettingsReachRuntimeConfigs() {
        val xrayServer = parser.parse(
            source = "unit-routing-vless",
            content = "vless://11111111-1111-4111-8111-111111111111@node.example.test:443" +
                "?security=reality&sni=www.microsoft.com&pbk=reality-public-key&sid=abcd&type=tcp&flow=xtls-rprx-vision#Lumen%20Reality",
        ).subscription.servers.single()
        val singBoxServer = parser.parse(
            source = "unit-routing-trojan",
            content = "trojan://secret@trojan.example.test:443?sni=trojan.example.test#Trojan",
        ).subscription.servers.single()
        val settings = RuntimeSettings(
            directDomains = listOf("direct.example.test"),
            proxyDomains = listOf("proxy.example.test"),
            blockDomains = listOf("block.example.test"),
            directIps = listOf("198.51.100.0/24"),
            proxyIps = listOf("203.0.113.10/32"),
            blockIps = listOf("192.0.2.0/24"),
            ruleSetUrls = listOf("https://rules.example.test/geosite.srs"),
        )

        val xrayConfig = XrayConfigFactory().build(xrayServer, settings).fullJsonConfig
        val singBoxConfig = SingBoxConfigFactory().build(singBoxServer, settings)

        assertTrue(xrayConfig.contains("direct.example.test"))
        assertTrue(xrayConfig.contains("proxy.example.test"))
        assertTrue(xrayConfig.contains("block.example.test"))

        assertTrue(singBoxConfig.contains("direct.example.test"))
        assertTrue(singBoxConfig.contains("proxy.example.test"))
        assertTrue(singBoxConfig.contains("block.example.test"))
        assertTrue(singBoxConfig.contains("198.51.100.0/24"))
        assertTrue(singBoxConfig.contains("203.0.113.10/32"))
        assertTrue(singBoxConfig.contains("192.0.2.0/24"))
        assertTrue(singBoxConfig.contains("https://rules.example.test/geosite.srs"))
    }

    private fun profile(
        protocol: ProtocolType,
        displayName: String,
        rawUri: String = "",
        host: String = "",
        port: Int = 0,
        username: String = "",
        password: String = "",
        method: String = "",
        extraJson: String = "{}",
    ): ServerProfile = ServerProfile(
        id = "srv-${displayName.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')}",
        subscriptionId = "sub-runtime-contract",
        displayName = displayName,
        protocol = protocol,
        rawUri = rawUri,
        host = host,
        port = port,
        username = username,
        password = password,
        method = method,
        extraJson = extraJson,
    )

    private fun tcpOpenVpnProfile(): String = """
        client
        dev tun
        proto tcp-client
        remote vpn.example.test 1194
        resolv-retry infinite
        nobind
    """.trimIndent()

    private fun udpOpenVpnProfile(): String = """
        client
        dev tun
        proto udp
        remote vpn.example.test 1194
        resolv-retry infinite
        nobind
    """.trimIndent()
}
