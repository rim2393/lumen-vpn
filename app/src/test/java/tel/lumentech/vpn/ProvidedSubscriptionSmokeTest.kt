package tel.lumentech.vpn

import java.net.InetSocketAddress
import java.net.Socket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.runtime.SingBoxConfigFactory
import tel.lumentech.vpn.subscription.AmneziaQrCodec
import tel.lumentech.vpn.subscription.SubscriptionParser
import tel.lumentech.vpn.subscription.SubscriptionSourceResolver

class ProvidedSubscriptionSmokeTest {
    private val parser = SubscriptionParser()
    private val configFactory = SingBoxConfigFactory()
    private val resolver = SubscriptionSourceResolver()

    @Test
    fun providedCloakJsonImportsAndEndpointIsReachable() {
        val sample = env("LUMEN_SAMPLE_CLOAK_JSON")
        assumeTrue(sample.isNotBlank())

        val result = parser.parse("provided-cloak", sample, "Provided Cloak")
        val server = result.subscription.servers.single()

        assertEquals(ProtocolType.OPENVPN_CLOAK, server.protocol)
        assertEquals("46.226.166.94", server.host)
        assertEquals(443, server.port)
        assertTrue("Cloak endpoint TCP connect failed", tcpReachable(server.host, server.port))
    }

    @Test
    fun providedVpnUrlDecodesImportsAndBuildsRuntimeConfig() {
        val sample = env("LUMEN_SAMPLE_VPN_URL")
        assumeTrue(sample.isNotBlank())

        val decoded = AmneziaQrCodec.decodeNativeConfig(sample)
        assertFalse("vpn:// decoded payload is empty", decoded.isNullOrBlank())

        val result = parser.parse("provided-vpn", decoded!!, "Provided Amnezia")
        assertTrue("No supported servers parsed from vpn://", result.subscription.servers.isNotEmpty())

        val connectableServers = result.subscription.servers.filter {
            it.protocol in setOf(
                ProtocolType.VLESS,
                ProtocolType.VMESS,
                ProtocolType.TROJAN,
                ProtocolType.SHADOWSOCKS,
                ProtocolType.SOCKS,
                ProtocolType.HYSTERIA,
                ProtocolType.HYSTERIA2,
                ProtocolType.TUIC,
                ProtocolType.NAIVE,
                ProtocolType.WIREGUARD,
                ProtocolType.AMNEZIA_WG,
                ProtocolType.SING_BOX,
                ProtocolType.XRAY
            )
        }
        assertTrue("vpn:// decoded but no runtime-connectable server was found", connectableServers.isNotEmpty())

        val config = configFactory.build(connectableServers.first())
        assertTrue(config.contains("\"type\": \"tun\""))
        assertTrue(config.contains("\"tag\": \"proxy\""))
    }

    @Test
    fun providedVpnUrlContainsCompleteOpenVpnCloakProfile() {
        val sample = env("LUMEN_SAMPLE_VPN_URL")
        assumeTrue(sample.isNotBlank())

        val decoded = AmneziaQrCodec.decodeNativeConfig(sample)
        assertFalse("vpn:// decoded payload is empty", decoded.isNullOrBlank())

        val result = parser.parse("provided-vpn", decoded!!, "Provided Amnezia")
        val completeCloak = result.subscription.servers.firstOrNull {
            it.protocol == ProtocolType.OPENVPN_CLOAK && RuntimeSupport.isConnectable(it)
        }

        assertTrue("vpn:// has no complete OpenVPN over Cloak profile", completeCloak != null)
    }

    @Test
    fun providedRemoteUrlFetchesImportsAndBuildsRuntimeConfig() {
        val sample = env("LUMEN_SAMPLE_REMOTE_URL")
        assumeTrue(sample.isNotBlank())

        val resolved = resolver.resolve("provided-url", sample)
        assertFalse("Remote subscription body is empty", resolved.content.isBlank())

        val result = parser.parse(resolved.source, resolved.content, resolved.name ?: "Provided remote")
        assertTrue("No supported servers parsed from remote URL", result.subscription.servers.isNotEmpty())

        val server = result.subscription.servers.first()
        val config = configFactory.build(server)
        assertTrue(config.contains("\"type\": \"tun\""))
        assertTrue(config.contains("\"tag\": \"proxy\""))
    }

    private fun env(name: String): String = System.getenv(name).orEmpty().trim()

    private fun tcpReachable(host: String, port: Int): Boolean =
        runCatching {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(host, port), 4_000)
            }
        }.isSuccess
}
