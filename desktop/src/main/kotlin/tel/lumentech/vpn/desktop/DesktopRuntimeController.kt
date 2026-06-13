package tel.lumentech.vpn.desktop

import java.io.File
import java.net.ServerSocket
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.runtime.SingBoxConfigFactory
import tel.lumentech.vpn.security.SecretRedactor

class DesktopRuntimeController(
    private val store: DesktopStore,
    private val binaries: RuntimeBinaries = RuntimeBinaries(),
    private val configFactory: SingBoxConfigFactory = SingBoxConfigFactory(),
    private val paths: DesktopPaths = DesktopPaths,
) : RuntimeController {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val processes = mutableListOf<Process>()
    private var activeAmneziaTunnelName: String? = null
    private var active = RuntimeState("stopped")

    override fun start(profileId: String, settings: RuntimeSettings): RuntimeState {
        stop()
        val profile = store.serverById(profileId) ?: error("Server not found")
        validateProfile(profile).takeIf { !it.ok }?.let { error(it.message) }
        paths.ensure()
        val backend = RuntimeSupport.backend(profile)
        active = RuntimeState("starting", backend.name, profile.id, "Starting ${profile.displayName}")
        when (backend) {
            RuntimeBackend.XRAY_CORE -> startSingBox(profile, settings)
            RuntimeBackend.SING_BOX -> startSingBox(profile, settings)
            RuntimeBackend.AMNEZIAWG -> startAmneziaWg(profile)
            RuntimeBackend.OPENVPN -> startOpenVpn(profile)
            RuntimeBackend.OPENVPN_CLOAK -> startOpenVpnCloak(profile)
            RuntimeBackend.OPENVPN_SHADOWSOCKS -> startOpenVpnShadowsocks(profile, settings)
            RuntimeBackend.ANDROID_IKEV2 -> startWindowsIkev2(profile)
            RuntimeBackend.UNSUPPORTED -> error(RuntimeSupport.unsupportedRuntimeMessage(profile.protocol))
        }
        active = RuntimeState("running", backend.name, profile.id, "Connected with ${profile.displayName}")
        return active
    }

    override fun stop(): RuntimeState {
        processes.asReversed().forEach { process ->
            runCatching {
                process.destroy()
                if (!process.waitFor(3, TimeUnit.SECONDS)) process.destroyForcibly()
            }
        }
        processes.clear()
        activeAmneziaTunnelName?.let { tunnelName ->
            runCatching {
                runOneShot(
                    listOf(binaries.amneziaWg.toString(), "/uninstalltunnelservice", tunnelName),
                    paths.logDir.resolve("amneziawg.log")
                )
            }
            activeAmneziaTunnelName = null
        }
        if (active.backend == RuntimeBackend.ANDROID_IKEV2.name && active.profileId.isNotBlank()) {
            runCatching { rasdial("/disconnect") }
        }
        active = RuntimeState("stopped", message = "Stopped")
        return active
    }

    override fun status(): RuntimeState {
        if (active.status == "running" && processes.any { !it.isAlive }) {
            active = RuntimeState("error", active.backend, active.profileId, "Runtime process exited")
        }
        return active
    }

    override fun logs(): String {
        val files = listOf("sing-box.log", "openvpn.log", "cloak.log", "ipsec.log")
            .map { paths.logDir.resolve(it) }
            .filter(Files::exists)
        return SecretRedactor.redact(files.joinToString("\n\n") { file ->
            "== ${file.fileName} ==\n${Files.readString(file).takeLast(32_000)}"
        })
    }

    override fun validate(profileId: String): RuntimeValidation {
        val profile = store.serverById(profileId) ?: return RuntimeValidation(false, "UNKNOWN", "Server not found")
        return validateProfile(profile)
    }

    private fun validateProfile(profile: ServerProfile): RuntimeValidation {
        val backend = RuntimeSupport.backend(profile)
        val issue = RuntimeSupport.validationIssue(profile)
        if (issue != null) return RuntimeValidation(false, backend.name, issue)
        val binaryIssue = when (backend) {
            RuntimeBackend.XRAY_CORE -> binaries.requireExisting(binaries.singBox, "sing-box.exe")
            RuntimeBackend.SING_BOX -> binaries.requireExisting(binaries.singBox, "sing-box.exe")
            RuntimeBackend.AMNEZIAWG -> binaries.requireExisting(binaries.amneziaWg, "amneziawg.exe")
            RuntimeBackend.OPENVPN -> binaries.requireExisting(binaries.openVpn, "openvpn.exe")
            RuntimeBackend.OPENVPN_CLOAK -> binaries.requireExisting(binaries.openVpn, "openvpn.exe")
                ?: binaries.requireExisting(binaries.cloak, "cloak.exe")
            RuntimeBackend.OPENVPN_SHADOWSOCKS -> binaries.requireExisting(binaries.openVpn, "openvpn.exe")
                ?: binaries.requireExisting(binaries.singBox, "sing-box.exe")
            RuntimeBackend.ANDROID_IKEV2 -> null
            RuntimeBackend.UNSUPPORTED -> RuntimeSupport.unsupportedRuntimeMessage(profile.protocol)
        }
        return RuntimeValidation(binaryIssue == null, backend.name, binaryIssue.orEmpty())
    }

    private fun startSingBox(profile: ServerProfile, settings: RuntimeSettings) {
        val configFile = paths.generatedConfigDir.resolve("sing-box-${profile.id}.json")
        Files.writeString(configFile, configFactory.build(profile, settings))
        startProcess(
            listOf(binaries.singBox.toString(), "run", "-c", configFile.toString()),
            paths.logDir.resolve("sing-box.log")
        )
    }

    private fun startAmneziaWg(profile: ServerProfile) {
        val tunnelName = "lumen-awg-${profile.id.take(8)}"
        val configFile = paths.generatedConfigDir.resolve("$tunnelName.conf")
        Files.writeString(configFile, profile.rawUri)
        val code = runOneShot(
            listOf(binaries.amneziaWg.toString(), "/installtunnelservice", configFile.toString()),
            paths.logDir.resolve("amneziawg.log")
        )
        require(code == 0) { "AmneziaWG tunnel service install failed with exit code $code" }
        activeAmneziaTunnelName = tunnelName
    }

    private fun startOpenVpn(profile: ServerProfile, cloakLocalPort: Int? = null) {
        val configFile = writeOpenVpnConfig(profile, cloakLocalPort)
        startProcess(
            listOf(binaries.openVpn.toString(), "--config", configFile.toString()),
            paths.logDir.resolve("openvpn.log")
        )
    }

    private fun startOpenVpnCloak(profile: ServerProfile) {
        val localPort = freeLoopbackPort()
        val cloakConfig = paths.generatedConfigDir.resolve("cloak-${profile.id}.json")
        Files.writeString(cloakConfig, profile.extraJson)
        startProcess(
            listOf(binaries.cloak.toString(), "-c", cloakConfig.toString(), "-l", localPort.toString()),
            paths.logDir.resolve("cloak.log")
        )
        startOpenVpn(profile, cloakLocalPort = localPort)
    }

    private fun startOpenVpnShadowsocks(profile: ServerProfile, settings: RuntimeSettings) {
        val proxyPort = 10808
        startShadowsocksBridge(profile, proxyPort)
        val configFile = writeOpenVpnConfig(
            profile.copy(rawUri = profile.rawUri + "\n\nsocks-proxy 127.0.0.1 $proxyPort\n")
        )
        startProcess(
            listOf(binaries.openVpn.toString(), "--config", configFile.toString()),
            paths.logDir.resolve("openvpn.log")
        )
    }

    private fun startShadowsocksBridge(profile: ServerProfile, proxyPort: Int) {
        val outbound = runCatching { json.parseToJsonElement(profile.extraJson).jsonObject }.getOrElse {
            error("OpenVPN over Shadowsocks profile has invalid Shadowsocks outbound JSON")
        }
        require(outbound.string("type").equals("shadowsocks", true) || profile.extraJson.contains("shadowsocks", true)) {
            "OpenVPN over Shadowsocks profile has no Shadowsocks outbound JSON"
        }
        val amendedOutbound = buildJsonObject {
            outbound.forEach { (key, value) -> put(key, value) }
            put("type", "shadowsocks")
            put("tag", "proxy")
        }
        val config = buildJsonObject {
            put("log", buildJsonObject { put("level", "info"); put("timestamp", true) })
            put("inbounds", buildJsonArray {
                add(buildJsonObject {
                    put("type", "mixed")
                    put("tag", "mixed-in")
                    put("listen", "127.0.0.1")
                    put("listen_port", proxyPort)
                })
            })
            put("outbounds", buildJsonArray {
                add(amendedOutbound)
                add(buildJsonObject { put("type", "direct"); put("tag", "direct") })
            })
            put("route", buildJsonObject { put("final", "proxy") })
        }
        val configFile = paths.generatedConfigDir.resolve("ss-bridge-${profile.id}.json")
        Files.writeString(configFile, json.encodeToString(JsonObject.serializer(), config))
        startProcess(
            listOf(binaries.singBox.toString(), "run", "-c", configFile.toString()),
            paths.logDir.resolve("sing-box.log")
        )
    }

    private fun startWindowsIkev2(profile: ServerProfile) {
        val name = "Lumen-${profile.id.take(8)}"
        val script = paths.generatedConfigDir.resolve("ipsec-${profile.id}.ps1")
        Files.writeString(
            script,
            """
            ${'$'}ErrorActionPreference = "Stop"
            ${'$'}name = "$name"
            ${'$'}server = "${profile.host}"
            if (-not (Get-VpnConnection -Name ${'$'}name -ErrorAction SilentlyContinue)) {
              Add-VpnConnection -Name ${'$'}name -ServerAddress ${'$'}server -TunnelType Ikev2 -AuthenticationMethod Eap -EncryptionLevel Required -Force
            }
            rasdial ${'$'}name "${profile.username}" "${profile.password}"
            """.trimIndent()
        )
        startProcess(
            listOf("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script.toString()),
            paths.logDir.resolve("ipsec.log")
        )
    }

    private fun writeOpenVpnConfig(profile: ServerProfile, cloakLocalPort: Int? = null): Path {
        val configFile = paths.generatedConfigDir.resolve("openvpn-${profile.id}.ovpn")
        Files.writeString(configFile, normalizeOpenVpnConfig(profile.rawUri, cloakLocalPort))
        return configFile
    }

    private fun normalizeOpenVpnConfig(raw: String, cloakLocalPort: Int?): String {
        val dnsNormalized = raw
            .replace("\$PRIMARY_DNS", "1.1.1.1")
            .replace("\$SECONDARY_DNS", "8.8.8.8")
        if (cloakLocalPort == null) return dnsNormalized
        val lines = dnsNormalized.lines().toMutableList()
        val remoteIndex = lines.indexOfFirst { it.trim().startsWith("remote ", ignoreCase = true) }
        val localRemote = "remote 127.0.0.1 $cloakLocalPort"
        if (remoteIndex >= 0) {
            lines[remoteIndex] = localRemote
        } else {
            lines.add(localRemote)
        }
        return lines.joinToString(System.lineSeparator())
    }

    private fun openVpnRemoteLocalPort(raw: String): Int? =
        raw.lineSequence()
            .map { it.trim().split(Regex("""\s+""")) }
            .firstOrNull { parts ->
                parts.size >= 3 &&
                    parts[0].equals("remote", ignoreCase = true) &&
                    parts[1].let { it == "127.0.0.1" || it.equals("localhost", ignoreCase = true) }
            }
            ?.getOrNull(2)
            ?.toIntOrNull()

    private fun freeLoopbackPort(): Int =
        ServerSocket(0).use { it.localPort }

    private fun JsonObject.string(name: String): String =
        (this[name])?.jsonPrimitive?.contentOrNull.orEmpty()

    private fun startProcess(command: List<String>, logFile: Path) {
        Files.createDirectories(logFile.parent)
        val process = ProcessBuilder(command)
            .directory(paths.generatedConfigDir.toFile())
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.appendTo(logFile.toFile()))
            .start()
        processes += process
    }

    private fun runOneShot(command: List<String>, logFile: Path): Int {
        Files.createDirectories(logFile.parent)
        val process = ProcessBuilder(command)
            .directory(paths.generatedConfigDir.toFile())
            .redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.appendTo(logFile.toFile()))
            .start()
        return process.waitFor()
    }

    private fun rasdial(arg: String) {
        startProcess(listOf("rasdial.exe", arg), paths.logDir.resolve("ipsec.log"))
    }
}

data class RuntimeBinaries(
    val singBox: Path = runtimeBinary("sing-box.exe"),
    val amneziaWg: Path = runtimeBinary("amneziawg.exe"),
    val openVpn: Path = runtimeBinary("openvpn.exe"),
    val cloak: Path = runtimeBinary("cloak.exe"),
) {
    fun requireExisting(path: Path, display: String): String? =
        if (Files.exists(path)) null else "$display was not found at ${path.toAbsolutePath()}"

    companion object {
        private fun runtimeBinary(name: String): Path {
            val envName = name.substringBefore(".").uppercase().replace("-", "_") + "_EXE"
            return System.getenv(envName)?.takeIf { it.isNotBlank() }?.let(Path::of)
                ?: runtimeCandidates(name).firstOrNull(Files::exists)
                ?: DesktopPaths.runtimeDir.resolve(name)
        }

        private fun runtimeCandidates(name: String): List<Path> {
            val jar = RuntimeBinaries::class.java.protectionDomain.codeSource.location.toURI()
            val location = Path.of(jar)
            val appHome = if (Files.isRegularFile(location)) {
                location.parent?.parent
            } else {
                location
            }
            val cwd = Path.of("").toAbsolutePath()
            return listOfNotNull(
                appHome?.resolve("runtime")?.resolve(name),
                cwd.resolve("desktop").resolve("build").resolve("install").resolve("lumen-vpn").resolve("runtime").resolve(name),
                cwd.resolve("desktop").resolve("packaging").resolve("runtime").resolve(name),
                cwd.resolve("packaging").resolve("runtime").resolve(name),
            )
        }
    }
}
