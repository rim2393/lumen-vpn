package tel.lumentech.vpn.desktop

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import tel.lumentech.vpn.data.RuntimeSettings

fun main() {
    WindowsControlService().startBlocking()
}

class WindowsControlService(
    private val host: String = "127.0.0.1",
    private val port: Int = 17652,
    private val store: DesktopStore = DesktopStore(),
    private val controller: RuntimeController = DesktopRuntimeController(store),
) {
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }
    private val server: HttpServer = HttpServer.create(InetSocketAddress(host, port), 0)

    init {
        route("GET", "/status") { controller.status() }
        route("POST", "/connect") { exchange ->
            val request = json.decodeFromString<ConnectRequest>(exchange.bodyText())
            val settings = request.settings ?: store.settings
            store.updateSettings(settings)
            controller.start(request.profileId, settings)
        }
        route("POST", "/disconnect") { controller.stop() }
        route("GET", "/logs") { mapOf("logs" to controller.logs()) }
        route("POST", "/settings") { exchange ->
            val settings = json.decodeFromString<RuntimeSettings>(exchange.bodyText())
            store.updateSettings(settings)
            mapOf("ok" to true)
        }
        route("POST", "/validate") { exchange ->
            val request = json.decodeFromString<ProfileRequest>(exchange.bodyText())
            controller.validate(request.profileId)
        }
    }

    fun startBlocking() {
        DesktopPaths.ensure()
        server.start()
        println("Lumen Windows control service listening on http://$host:$port")
        Thread.currentThread().join()
    }

    fun start() {
        DesktopPaths.ensure()
        server.start()
    }

    fun stop() {
        controller.stop()
        server.stop(0)
    }

    private inline fun <reified T> route(method: String, path: String, crossinline block: (HttpExchange) -> T) {
        server.createContext(path) { exchange ->
            runCatching {
                require(exchange.requestMethod.equals(method, ignoreCase = true)) { "Method not allowed" }
                require(ControlAuth.isAuthorized(exchange.requestHeaders.getFirst("Authorization"))) { "Unauthorized" }
                exchange.respond(200, json.encodeToString(block(exchange)))
            }.onFailure {
                exchange.respond(if (it.message == "Unauthorized") 401 else 400, json.encodeToString(ErrorResponse(it.message ?: "error")))
            }
        }
    }
}

class WindowsServiceClient(
    private val baseUrl: String = "http://127.0.0.1:17652",
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val token = ControlAuth.token()

    fun status(): RuntimeState = request("GET", "/status", null)

    fun connect(profileId: String, settings: RuntimeSettings): RuntimeState =
        request("POST", "/connect", json.encodeToString(ConnectRequest(profileId, settings)))

    fun disconnect(): RuntimeState = request("POST", "/disconnect", "")

    fun logs(): String = request<Map<String, String>>("GET", "/logs", null)["logs"].orEmpty()

    fun validate(profileId: String): RuntimeValidation =
        request("POST", "/validate", json.encodeToString(ProfileRequest(profileId)))

    private inline fun <reified T> request(method: String, path: String, body: String?): T {
        val connection = java.net.URI("$baseUrl$path").toURL().openConnection() as java.net.HttpURLConnection
        connection.requestMethod = method
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.setRequestProperty("Content-Type", "application/json")
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toByteArray()) }
        }
        val code = connection.responseCode
        val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
            ?.bufferedReader()
            ?.readText()
            .orEmpty()
        if (code !in 200..299) error(text.ifBlank { "HTTP $code" })
        return json.decodeFromString(text)
    }
}

@Serializable
data class ConnectRequest(val profileId: String, val settings: RuntimeSettings? = null)

@Serializable
data class ProfileRequest(val profileId: String)

@Serializable
data class ErrorResponse(val error: String)

private fun HttpExchange.bodyText(): String =
    requestBody.bufferedReader().use { it.readText() }

private fun HttpExchange.respond(code: Int, text: String) {
    val bytes = text.toByteArray()
    responseHeaders.set("Content-Type", "application/json; charset=utf-8")
    sendResponseHeaders(code, bytes.size.toLong())
    responseBody.use { it.write(bytes) }
}
