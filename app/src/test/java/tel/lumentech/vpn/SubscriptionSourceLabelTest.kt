package tel.lumentech.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import tel.lumentech.vpn.security.SubscriptionSourceLabel

class SubscriptionSourceLabelTest {
    @Test
    fun hidesSubscriptionPathQueryAndToken() {
        val label = SubscriptionSourceLabel.safeLabel(
            "https://panel.lumentech.tel/api/v1/subscriptions/public/lumen_sub_secret?token=very-secret#fragment"
        )

        assertEquals("https://panel.lumentech.tel", label)
        assertFalse(label.contains("lumen_sub_secret"))
        assertFalse(label.contains("token"))
        assertFalse(label.contains("very-secret"))
    }

    @Test
    fun proxyLinksRenderAsProtocolProfilesOnly() {
        assertEquals("vless profile", SubscriptionSourceLabel.safeLabel("vless://uuid@example.com:443?security=reality#RU"))
        assertEquals("trojan profile", SubscriptionSourceLabel.safeLabel("trojan://password@example.com:443#node"))
        assertEquals("hy2 profile", SubscriptionSourceLabel.safeLabel("hy2://password@example.com:443#node"))
    }

    @Test
    fun localSourcesRemainReadable() {
        assertEquals("qr", SubscriptionSourceLabel.safeLabel("qr"))
        assertEquals("file", SubscriptionSourceLabel.safeLabel("file"))
        assertEquals("manual", SubscriptionSourceLabel.safeLabel("manual"))
    }
}
