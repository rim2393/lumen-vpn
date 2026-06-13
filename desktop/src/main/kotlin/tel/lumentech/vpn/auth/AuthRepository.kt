package tel.lumentech.vpn.auth

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class AuthRepository(
    private val store: SecureTokenStore,
    private val baseUrl: String = System.getenv("LUMEN_PANEL_URL") ?: "https://panel.lumentech.tel",
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val mediaType = "application/json; charset=utf-8".toMediaType()

    fun loginEmail(email: String, password: String): DesktopAuthSession {
        val tokenPair = post<TokenPair>(
            path = "/api/v1/auth/login",
            body = mapOf("email" to email.trim(), "password" to password),
        )
        store.save(tokenPair.accessToken, tokenPair.refreshToken)
        return DesktopAuthSession(authenticated = true, user = me(tokenPair.accessToken))
    }

    fun registerEmail(email: String, password: String, username: String): DesktopAuthSession {
        val tokenPair = post<TokenPair>(
            path = "/api/v1/users/register",
            body = mapOf("email" to email.trim(), "password" to password, "username" to username),
        )
        store.save(tokenPair.accessToken, tokenPair.refreshToken)
        return DesktopAuthSession(authenticated = true, user = me(tokenPair.accessToken))
    }

    fun forgotPassword(email: String) {
        post<Unit>(
            path = "/api/v1/auth/password/forgot",
            body = mapOf("email" to email.trim()),
        )
    }

    fun telegramBotUrl(): String = "${baseUrl.trimEnd('/')}/api/v1/auth/telegram/login"

    fun logout() {
        val accessToken = store.accessToken()
        if (!accessToken.isNullOrBlank()) {
            runCatching {
                val request = Request.Builder()
                    .url("${baseUrl.trimEnd('/')}/api/v1/auth/logout")
                    .header("Authorization", "Bearer $accessToken")
                    .post(ByteArray(0).toRequestBody(null))
                    .build()
                client.newCall(request).execute().close()
            }
        }
        store.clear()
    }

    private fun me(accessToken: String): CabinetUser? {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/api/v1/auth/me")
            .header("Authorization", "Bearer $accessToken")
            .get()
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            return json.decodeFromString<CabinetUser>(response.body.string())
        }
    }

    private inline fun <reified T> post(path: String, body: Map<String, String>): T {
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}$path")
            .post(json.encodeToString(body).toRequestBody(mediaType))
            .build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Auth request failed with HTTP ${response.code}")
            }
            if (T::class == Unit::class) return Unit as T
            return json.decodeFromString<T>(response.body.string())
        }
    }
}

@Serializable
data class DesktopAuthSession(
    val authenticated: Boolean,
    val user: CabinetUser? = null,
)

@Serializable
private data class TokenPair(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
)
