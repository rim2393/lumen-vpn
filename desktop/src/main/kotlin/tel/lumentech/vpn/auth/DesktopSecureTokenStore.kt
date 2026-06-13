package tel.lumentech.vpn.auth

import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class SecureTokenStore(private val file: Path = DesktopAuthPaths.tokensFile()) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }

    fun save(accessToken: String, refreshToken: String) {
        Files.createDirectories(file.parent)
        Files.writeString(file, json.encodeToString(TokenFile(accessToken, refreshToken)))
    }

    fun accessToken(): String? = read().access

    fun refreshToken(): String? = read().refresh

    fun hasSession(): Boolean = !accessToken().isNullOrBlank()

    fun clear() {
        Files.deleteIfExists(file)
    }

    private fun read(): TokenFile =
        runCatching {
            json.decodeFromString<TokenFile>(Files.readString(file))
        }.getOrDefault(TokenFile())

    @Serializable
    private data class TokenFile(val access: String? = null, val refresh: String? = null)
}

private object DesktopAuthPaths {
    fun tokensFile(): Path =
        Path.of(System.getProperty("user.home"), ".lumen-vpn", "tokens.json")
}
