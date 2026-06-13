package tel.lumentech.vpn.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("lumen_preferences")

class Preferences(private val context: Context) {
    private val selectedServerKey = stringPreferencesKey("selected_server")
    private val splitModeKey = stringPreferencesKey("split_mode")
    private val splitAppsKey = stringPreferencesKey("split_apps")
    private val languageKey = stringPreferencesKey("language")
    private val systemProxyKey = booleanPreferencesKey("system_proxy")
    private val dnsModeKey = stringPreferencesKey("dns_mode")
    private val customDnsKey = stringPreferencesKey("custom_dns")
    private val bypassPrivateNetworksKey = booleanPreferencesKey("bypass_private_networks")
    private val strictRouteKey = booleanPreferencesKey("strict_route")
    private val ipv6Key = booleanPreferencesKey("ipv6")
    private val sniffKey = booleanPreferencesKey("sniff")
    private val finalOutboundKey = stringPreferencesKey("final_outbound")
    private val directDomainsKey = stringPreferencesKey("route_direct_domains")
    private val proxyDomainsKey = stringPreferencesKey("route_proxy_domains")
    private val blockDomainsKey = stringPreferencesKey("route_block_domains")
    private val directIpsKey = stringPreferencesKey("route_direct_ips")
    private val proxyIpsKey = stringPreferencesKey("route_proxy_ips")
    private val blockIpsKey = stringPreferencesKey("route_block_ips")
    private val ruleSetUrlsKey = stringPreferencesKey("route_ruleset_urls")

    val selectedServerId: Flow<String?> = context.dataStore.data.map { it[selectedServerKey] }
    val splitMode: Flow<String> = context.dataStore.data.map { it[splitModeKey] ?: "exclude" }
    val splitApps: Flow<List<String>> = context.dataStore.data.map {
        it[splitAppsKey]?.split("\n")?.filter(String::isNotBlank).orEmpty()
    }
    val systemProxyEnabled: Flow<Boolean> = context.dataStore.data.map { it[systemProxyKey] ?: false }
    val runtimeSettings: Flow<RuntimeSettings> = context.dataStore.data.map {
        RuntimeSettings(
            splitMode = it[splitModeKey] ?: "exclude",
            splitApps = it[splitAppsKey]?.split("\n")?.filter(String::isNotBlank).orEmpty(),
            language = normalizeLanguage(it[languageKey]),
            dnsMode = it[dnsModeKey] ?: "cloudflare",
            customDns = it[customDnsKey].orEmpty(),
            bypassPrivateNetworks = it[bypassPrivateNetworksKey] ?: true,
            strictRoute = it[strictRouteKey] ?: false,
            ipv6 = it[ipv6Key] ?: false,
            sniff = it[sniffKey] ?: true,
            systemProxy = it[systemProxyKey] ?: false,
            finalOutbound = it[finalOutboundKey] ?: "proxy",
            directDomains = it[directDomainsKey].toLines(),
            proxyDomains = it[proxyDomainsKey].toLines(),
            blockDomains = it[blockDomainsKey].toLines(),
            directIps = it[directIpsKey].toLines(),
            proxyIps = it[proxyIpsKey].toLines(),
            blockIps = it[blockIpsKey].toLines(),
            ruleSetUrls = it[ruleSetUrlsKey].toLines(),
        )
    }

    suspend fun setSelectedServer(id: String?) {
        context.dataStore.edit {
            if (id == null) it.remove(selectedServerKey) else it[selectedServerKey] = id
        }
    }

    suspend fun setSplit(mode: String, apps: List<String>) {
        context.dataStore.edit {
            it[splitModeKey] = mode
            it[splitAppsKey] = apps.joinToString("\n")
        }
    }

    suspend fun setSystemProxy(enabled: Boolean) {
        context.dataStore.edit { it[systemProxyKey] = enabled }
    }

    suspend fun setRuntimeSettings(settings: RuntimeSettings) {
        context.dataStore.edit {
            it[splitModeKey] = settings.splitMode
            it[splitAppsKey] = settings.splitApps.distinct().sorted().joinToString("\n")
            it[languageKey] = normalizeLanguage(settings.language)
            it[dnsModeKey] = settings.dnsMode
            it[customDnsKey] = settings.customDns.trim()
            it[bypassPrivateNetworksKey] = settings.bypassPrivateNetworks
            it[strictRouteKey] = settings.strictRoute
            it[ipv6Key] = settings.ipv6
            it[sniffKey] = settings.sniff
            it[systemProxyKey] = settings.systemProxy
            it[finalOutboundKey] = settings.finalOutbound
            it[directDomainsKey] = settings.directDomains.toPrefString()
            it[proxyDomainsKey] = settings.proxyDomains.toPrefString()
            it[blockDomainsKey] = settings.blockDomains.toPrefString()
            it[directIpsKey] = settings.directIps.toPrefString()
            it[proxyIpsKey] = settings.proxyIps.toPrefString()
            it[blockIpsKey] = settings.blockIps.toPrefString()
            it[ruleSetUrlsKey] = settings.ruleSetUrls.toPrefString()
        }
    }

    private fun String?.toLines(): List<String> =
        orEmpty().lines().map { it.trim() }.filter { it.isNotBlank() }.distinct()

    private fun List<String>.toPrefString(): String =
        map { it.trim() }.filter { it.isNotBlank() }.distinct().joinToString("\n")

    private fun normalizeLanguage(language: String?): String =
        when (language?.trim()?.lowercase()) {
            "en" -> "en"
            "auto" -> "auto"
            else -> "ru"
        }
}

data class RuntimeSettings(
    val splitMode: String = "exclude",
    val splitApps: List<String> = emptyList(),
    val language: String = "ru",
    val dnsMode: String = "cloudflare",
    val customDns: String = "",
    val bypassPrivateNetworks: Boolean = true,
    val strictRoute: Boolean = false,
    val ipv6: Boolean = false,
    val sniff: Boolean = true,
    val systemProxy: Boolean = false,
    val finalOutbound: String = "proxy",
    val directDomains: List<String> = emptyList(),
    val proxyDomains: List<String> = emptyList(),
    val blockDomains: List<String> = emptyList(),
    val directIps: List<String> = emptyList(),
    val proxyIps: List<String> = emptyList(),
    val blockIps: List<String> = emptyList(),
    val ruleSetUrls: List<String> = emptyList(),
)
