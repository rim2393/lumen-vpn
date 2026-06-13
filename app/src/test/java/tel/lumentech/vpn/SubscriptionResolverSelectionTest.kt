package tel.lumentech.vpn

import org.junit.Assert.assertEquals
import org.junit.Test
import tel.lumentech.vpn.subscription.SubscriptionSourceResolver

class SubscriptionResolverSelectionTest {
    @Test
    fun choosesRichestHappJsonResponseOverShortUriList() {
        val shortList = """
            vless://11111111-1111-1111-1111-111111111111@example.com:443#VLESS
            ss://YWVzLTEyOC1nY206cGFzcw@example.net:443#SS
        """.trimIndent()
        val jsonWithHysteria = """
            [
              {
                "remarks": "NEW PROTOCOL",
                "outbounds": [
                  {
                    "protocol": "hysteria",
                    "settings": { "version": 2, "address": "hy.example.com", "port": 443 },
                    "streamSettings": { "network": "hysteria", "security": "tls" }
                  }
                ]
              }
            ]
        """.trimIndent()

        val selected = SubscriptionSourceResolver()
            .chooseBestSubscriptionBody(listOf(shortList, jsonWithHysteria))

        assertEquals(jsonWithHysteria, selected)
    }
}
