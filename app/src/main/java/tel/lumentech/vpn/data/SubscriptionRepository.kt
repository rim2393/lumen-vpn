package tel.lumentech.vpn.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import tel.lumentech.vpn.model.SubscriptionProfile
import tel.lumentech.vpn.model.ImportResult
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.subscription.SubscriptionParser
import tel.lumentech.vpn.subscription.SubscriptionSourceResolver

class SubscriptionRepository(
    private val dao: LumenDao,
    private val fieldCodec: ProfileFieldCodec = PlainProfileFieldCodec,
    private val parser: SubscriptionParser = SubscriptionParser(),
    private val resolver: SubscriptionSourceResolver = SubscriptionSourceResolver(),
) {
    val servers: Flow<List<ServerProfile>> = dao.servers().map { list -> list.map { it.toModel(fieldCodec) } }
    val subscriptions: Flow<List<SubscriptionProfile>> = dao.subscriptions().map { list ->
        list.map { it.toModel(fieldCodec) }
    }

    suspend fun importManual(source: String, content: String, name: String): ImportResult = withContext(Dispatchers.IO) {
        val resolved = resolver.resolve(source, content)
        val result = parser.parse(
            source = resolved.source,
            content = resolved.content,
            name = resolved.name ?: name
        )
        dao.upsertSubscription(result.subscription.toEntity(fieldCodec))
        dao.deleteServersForSubscription(result.subscription.id)
        dao.upsertServers(result.subscription.servers.map { it.toEntity(fieldCodec) })
        result
    }

    suspend fun serverById(id: String): ServerProfile? = dao.serverById(id)?.toModel(fieldCodec)

    suspend fun rewriteServerMetadataAtRest() = withContext(Dispatchers.IO) {
        val rewritten = dao.allServersSnapshot().map { it.toModel(fieldCodec).toEntity(fieldCodec) }
        if (rewritten.isNotEmpty()) dao.upsertServers(rewritten)
    }

    suspend fun subscriptionById(id: String): SubscriptionProfile? = withContext(Dispatchers.IO) {
        val subscription = dao.subscriptionById(id)?.toModel(fieldCodec) ?: return@withContext null
        val servers = dao.serversBySubscription(id).map { it.toModel(fieldCodec) }
        subscription.copy(servers = servers)
    }

    suspend fun refreshSubscription(id: String): ImportResult = withContext(Dispatchers.IO) {
        val existing = dao.subscriptionById(id)?.toModel(fieldCodec) ?: error("Subscription not found")
        require(!existing.source.startsWith("http://", true)) {
            "Subscription URLs must use HTTPS"
        }
        require(existing.source.startsWith("https://", true)) {
            "Only remote URL subscriptions can be refreshed"
        }
        val resolved = resolver.resolve(existing.source, existing.source)
        val result = parser.parse(
            source = resolved.source,
            content = resolved.content,
            name = existing.name
        )
        val refreshedServers = result.subscription.servers.map { it.copy(subscriptionId = existing.id) }
        val refreshedSubscription = existing.copy(
            name = existing.name,
            source = existing.source,
            servers = refreshedServers,
            updatedAt = System.currentTimeMillis()
        )
        dao.upsertSubscription(refreshedSubscription.toEntity(fieldCodec))
        dao.deleteServersForSubscription(existing.id)
        dao.upsertServers(refreshedServers.map { it.toEntity(fieldCodec) })
        result.copy(subscription = refreshedSubscription)
    }

    suspend fun deleteSubscription(id: String) = withContext(Dispatchers.IO) {
        dao.deleteServersForSubscription(id)
        dao.deleteSubscription(id)
    }

    suspend fun deleteServer(id: String) = withContext(Dispatchers.IO) {
        dao.deleteServer(id)
    }

    suspend fun duplicateServer(id: String): ServerProfile = withContext(Dispatchers.IO) {
        val server = dao.serverById(id)?.toModel(fieldCodec) ?: error("Server not found")
        val copy = server.copy(
            id = "${server.id}-copy-${System.currentTimeMillis()}",
            displayName = "${server.displayName} copy",
        )
        dao.upsertServer(copy.toEntity(fieldCodec))
        copy
    }
}
