package tel.lumentech.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import tel.lumentech.vpn.data.ProfileFieldCodec
import tel.lumentech.vpn.data.toEntity
import tel.lumentech.vpn.data.toModel
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.SubscriptionProfile

class StorageMappingTest {
    @Test
    fun encryptsSubscriptionSourceAndSensitiveServerFieldsAtRest() {
        val subscription = SubscriptionProfile(
            id = "sub",
            name = "Lumen",
            source = "https://example.com/sub?token=secret",
            servers = emptyList(),
        )
        val server = ServerProfile(
            id = "server",
            subscriptionId = "sub",
            displayName = "RU",
            protocol = ProtocolType.VLESS,
            rawUri = "vless://uuid@example.com:443",
            host = "example.com",
            port = 443,
            username = "user",
            password = "secret",
            uuid = "uuid",
            method = "aes-256-gcm",
            transport = "grpc",
            security = "reality",
            sni = "secure.example.com",
            publicKey = "public-key",
            shortId = "short-id",
            path = "/grpc",
            serviceName = "grpc-service",
            extraJson = """{"password":"secret"}""",
        )

        val subscriptionEntity = subscription.toEntity(MarkerCodec)
        val serverEntity = server.toEntity(MarkerCodec)

        assertNotEquals(subscription.source, subscriptionEntity.source)
        assertNotEquals(server.rawUri, serverEntity.rawUri)
        assertNotEquals(server.host, serverEntity.host)
        assertNotEquals(server.username, serverEntity.username)
        assertNotEquals(server.password, serverEntity.password)
        assertNotEquals(server.uuid, serverEntity.uuid)
        assertNotEquals(server.method, serverEntity.method)
        assertNotEquals(server.transport, serverEntity.transport)
        assertNotEquals(server.security, serverEntity.security)
        assertNotEquals(server.sni, serverEntity.sni)
        assertNotEquals(server.publicKey, serverEntity.publicKey)
        assertNotEquals(server.shortId, serverEntity.shortId)
        assertNotEquals(server.path, serverEntity.path)
        assertNotEquals(server.serviceName, serverEntity.serviceName)
        assertNotEquals(server.extraJson, serverEntity.extraJson)
        assertEquals(subscription.source, subscriptionEntity.toModel(MarkerCodec).source)
        assertEquals(server, serverEntity.toModel(MarkerCodec))
    }

    private object MarkerCodec : ProfileFieldCodec {
        override fun encrypt(value: String): String = if (value.isBlank()) value else "enc:$value"
        override fun decrypt(value: String): String = value.removePrefix("enc:")
    }
}
