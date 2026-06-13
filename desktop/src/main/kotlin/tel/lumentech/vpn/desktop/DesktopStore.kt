package tel.lumentech.vpn.desktop

import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.SubscriptionProfile
import tel.lumentech.vpn.subscription.SubscriptionParser
import tel.lumentech.vpn.subscription.SubscriptionSourceResolver

class DesktopStore(
    private val dir: Path = DesktopPaths.appData,
    private val parser: SubscriptionParser = SubscriptionParser(),
) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val dataFile = dir.resolve("profiles.json")
    private val settingsFile = dir.resolve("settings.json")
    private val hwidFile = dir.resolve("hwid.txt")
    private val resolver = SubscriptionSourceResolver(hwidProvider = ::hwid)

    var subscriptions: List<SubscriptionProfile> = emptyList()
        private set
    var settings: RuntimeSettings = RuntimeSettings()
        private set

    init {
        Files.createDirectories(dir)
        if (dir == DesktopPaths.appData) DesktopPaths.ensure()
        load()
    }

    val servers: List<ServerProfile>
        get() = subscriptions.flatMap { it.servers }.sortedBy { it.displayName.lowercase() }

    fun serverById(id: String): ServerProfile? = servers.firstOrNull { it.id == id }

    fun hwid(): String {
        if (Files.exists(hwidFile)) {
            Files.readString(hwidFile).trim().takeIf { it.isNotBlank() }?.let { return it }
        }
        val value = sha256Hex("lumen-windows:${UUID.randomUUID()}")
        Files.writeString(hwidFile, value)
        return value
    }

    fun importSubscription(source: String, content: String, name: String): Int {
        val resolved = resolver.resolve(source, content)
        val result = parser.parse(resolved.source, resolved.content, resolved.name ?: name)
        subscriptions = (subscriptions.filterNot { it.id == result.subscription.id } + result.subscription)
            .sortedByDescending { it.updatedAt }
        saveProfiles()
        return result.subscription.servers.size
    }

    fun refresh(id: String): Int {
        val subscription = subscriptions.firstOrNull { it.id == id } ?: error("Subscription not found")
        require(subscription.source.startsWith("http://", true) || subscription.source.startsWith("https://", true)) {
            "Only remote URL subscriptions can be refreshed"
        }
        return importSubscription(subscription.source, subscription.source, subscription.name)
    }

    fun deleteSubscription(id: String) {
        subscriptions = subscriptions.filterNot { it.id == id }
        saveProfiles()
    }

    fun deleteServer(id: String) {
        subscriptions = subscriptions.map { subscription ->
            subscription.copy(servers = subscription.servers.filterNot { it.id == id })
        }.filter { it.servers.isNotEmpty() }
        saveProfiles()
    }

    fun duplicateServer(id: String): ServerProfile {
        val subscription = subscriptions.firstOrNull { sub -> sub.servers.any { it.id == id } }
            ?: error("Server not found")
        val server = subscription.servers.first { it.id == id }
        val copy = server.copy(
            id = "${server.id}-copy-${System.currentTimeMillis()}",
            displayName = "${server.displayName} copy",
        )
        subscriptions = subscriptions.map {
            if (it.id == subscription.id) it.copy(servers = it.servers + copy) else it
        }
        saveProfiles()
        return copy
    }

    fun updateSettings(next: RuntimeSettings) {
        settings = next
        Files.writeString(settingsFile, json.encodeToString(next))
    }

    fun configPath(): Path = DesktopPaths.generatedConfigDir.also { Files.createDirectories(it) }

    private fun load() {
        subscriptions = runCatching {
            json.decodeFromString<ProfileFile>(Files.readString(dataFile)).subscriptions
        }.getOrDefault(emptyList())
        settings = runCatching {
            json.decodeFromString<RuntimeSettings>(Files.readString(settingsFile))
        }.getOrDefault(RuntimeSettings())
    }

    private fun saveProfiles() {
        Files.writeString(dataFile, json.encodeToString(ProfileFile(subscriptions)))
    }

    private fun sha256Hex(value: String): String =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    @Serializable
    private data class ProfileFile(val subscriptions: List<SubscriptionProfile> = emptyList())
}
