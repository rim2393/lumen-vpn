package org.amnezia.vpn.protocol.openvpn

import net.openvpn.ovpn3.ClientAPI_Config
import org.amnezia.vpn.protocol.BadConfigException
import org.amnezia.vpn.util.LibraryLoader.loadSharedLibrary
import org.json.JSONObject
import java.util.Base64

class OpenVpnOverCloak : OpenVpn() {
    override fun internalInit() {
        if (!isInitialized) {
            loadSharedLibrary(context, "ck-ovpn-plugin")
        }
        super.internalInit()
    }

    override fun parseConfig(config: JSONObject): ClientAPI_Config {
        val rawOpenVpnConfig = config.getJSONObject("openvpn_config_data").getString("config")
        val openVpnConfig = ClientAPI_Config()
        openVpnConfig.content = withCloakDirective(
            rawOpenVpnConfig,
            cloakConfig(config),
        )
        openVpnConfig.setUsePluggableTransports(true)
        if (!rawOpenVpnConfig.hasOpenVpnRemote()) {
            config.optString("hostName").takeIf { it.isNotBlank() }?.let(openVpnConfig::setServerOverride)
            config.optInt("port").takeIf { it in 1..65535 }?.let { openVpnConfig.setPortOverride(it.toString()) }
            openVpnConfig.setProtoOverride("tcp")
        }
        return openVpnConfig
    }

    private fun cloakConfig(config: JSONObject): String {
        return cloakJson(config).toString()
    }

    private fun cloakJson(config: JSONObject): JSONObject {
        val raw = config.optJSONObject("cloak_config_data")
            ?.optString("config")
            ?: config.optString("cloak_config")
        if (raw.isBlank()) {
            throw BadConfigException("OpenVPN over Cloak profile is incomplete: Cloak client JSON is missing.")
        }
        return runCatching { JSONObject(raw) }
            .getOrElse { throw BadConfigException("OpenVPN over Cloak profile has invalid Cloak JSON.", it) }
    }

    private fun withCloakDirective(openVpnConfig: String, cloakJson: String): String {
        val lines = openVpnConfig
            .lineSequence()
            .filterNot { it.trim().startsWith("cloak ", ignoreCase = true) }
            .toMutableList()
        lines.addIfDirectiveMissing("redirect-gateway", "redirect-gateway def1 bypass-dhcp")
        lines.addDnsFallbacksIfMissing()
        lines.addIfDirectiveMissing("block-ipv6", "block-ipv6")
        val encoded = Base64.getEncoder().encodeToString(cloakJson.toByteArray(Charsets.UTF_8))
        return "${lines.joinToString("\n").trimEnd()}\ncloak $encoded\n"
    }

    private fun String.hasOpenVpnRemote(): Boolean =
        lineSequence()
            .map { it.trim() }
            .any { line ->
                line.isNotEmpty() &&
                    !line.startsWith("#") &&
                    !line.startsWith(";") &&
                    line.startsWith("remote ", ignoreCase = true)
            }

    private fun MutableList<String>.addIfDirectiveMissing(prefix: String, directive: String) {
        if (any { it.trim().startsWith(prefix, ignoreCase = true) }) return
        add(directive)
    }

    private fun MutableList<String>.addDnsFallbacksIfMissing() {
        if (any { it.trim().startsWith("dhcp-option DNS", ignoreCase = true) }) return
        add("dhcp-option DNS 1.1.1.1")
        add("dhcp-option DNS 8.8.8.8")
    }

}
