package tel.lumentech.vpn.desktop

import java.nio.file.Files
import kotlin.io.path.createTempDirectory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.subscription.SubscriptionParser

class DesktopRuntimeControllerTest {
    private val parser = SubscriptionParser()

    @Test
    fun keepsAndroidConnectableSetScopedToSingBoxProtocols() {
        val openVpn = openVpnServer()

        assertFalse(RuntimeSupport.isConnectable(openVpn))
        assertTrue(RuntimeSupport.isWindowsConnectable(openVpn))
        assertEquals(RuntimeBackend.OPENVPN, RuntimeSupport.backend(openVpn))
    }

    @Test
    fun reportsStandaloneCloakAsIncompleteCompoundProfile() {
        val cloak = parser.parse(
            "cloak",
            """
            {
              "RemoteHost": "203.0.113.10",
              "RemotePort": "443",
              "PublicKey": "public-key",
              "UID": "uid-value"
            }
            """.trimIndent()
        ).subscription.servers.single()

        val issue = RuntimeSupport.validationIssue(cloak).orEmpty()

        assertEquals(ProtocolType.OPENVPN_CLOAK, cloak.protocol)
        assertTrue(issue.contains("both .ovpn config and Cloak"))
    }

    @Test
    fun validatesOpenVpnWhenBinaryExists() {
        val dir = createTempDirectory("lumen-runtime-test")
        val store = DesktopStore(dir)
        store.importSubscription("ovpn", openVpnConfig(), "OpenVPN")
        val binary = dir.resolve("openvpn.exe")
        Files.writeString(binary, "mock")
        val controller = DesktopRuntimeController(
            store = store,
            binaries = RuntimeBinaries(
                singBox = dir.resolve("sing-box.exe"),
                openVpn = binary,
                cloak = dir.resolve("cloak.exe")
            )
        )

        val validation = controller.validate(store.servers.single().id)

        assertTrue(validation.ok)
        assertEquals(RuntimeBackend.OPENVPN.name, validation.backend)
    }

    @Test
    fun validationRequiresBundledRuntimeBinary() {
        val dir = createTempDirectory("lumen-runtime-test")
        val store = DesktopStore(dir)
        store.importSubscription("ovpn", openVpnConfig(), "OpenVPN")
        val controller = DesktopRuntimeController(
            store = store,
            binaries = RuntimeBinaries(
                singBox = dir.resolve("sing-box.exe"),
                openVpn = dir.resolve("openvpn.exe"),
                cloak = dir.resolve("cloak.exe")
            )
        )

        val validation = controller.validate(store.servers.single().id)

        assertFalse(validation.ok)
        assertTrue(validation.message.contains("openvpn.exe was not found"))
    }

    private fun openVpnServer(): ServerProfile =
        parser.parse("ovpn", openVpnConfig(), "OpenVPN").subscription.servers.single()

    private fun openVpnConfig(): String =
        """
        client
        dev tun
        proto udp
        remote 198.51.100.30 1194
        <ca>
        demo
        </ca>
        """.trimIndent()
}
