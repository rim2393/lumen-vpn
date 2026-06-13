package tel.lumentech.vpn.desktop

import java.nio.file.Files
import java.nio.file.Path

object DesktopPaths {
    val appData: Path = envPath("APPDATA")?.resolve("LumenVPN")
        ?: Path.of(System.getProperty("user.home"), ".lumen-vpn")

    val programData: Path = envPath("ProgramData")?.resolve("LumenVPN")
        ?: appData

    val runtimeDir: Path = envPath("ProgramFiles")?.resolve("Lumen VPN")?.resolve("runtime")
        ?: appData.resolve("runtime-bin")

    val controlTokenFile: Path = appData.resolve("control.token")
    val profilesFile: Path = appData.resolve("profiles.json")
    val settingsFile: Path = appData.resolve("settings.json")
    val hwidFile: Path = appData.resolve("hwid.txt")
    val generatedConfigDir: Path = programData.resolve("runtime")
    val logDir: Path = programData.resolve("logs")

    fun ensure() {
        listOf(appData, programData, generatedConfigDir, logDir).forEach(Files::createDirectories)
        runCatching {
            val programFiles = System.getenv("ProgramFiles")?.takeIf { it.isNotBlank() }?.let(Path::of)
            if (programFiles == null || !runtimeDir.startsWith(programFiles)) {
                Files.createDirectories(runtimeDir)
            }
        }
    }

    private fun envPath(name: String): Path? =
        System.getenv(name)?.takeIf { it.isNotBlank() }?.let(Path::of)
}
