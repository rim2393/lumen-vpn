package tel.lumentech.vpn.desktop

import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path
import kotlin.system.exitProcess
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.security.SecretRedactor

fun main(args: Array<String>) {
    val input = args.firstOrNull()?.let(Path::of) ?: Path.of(".tmp", "live-subscriptions.txt")
    val connectSeconds = args.getOrNull(1)?.toLongOrNull()?.coerceIn(3, 120) ?: 12L
    if (!Files.exists(input)) {
        System.err.println("Missing input file: ${input.toAbsolutePath()}")
        exitProcess(2)
    }
    val ok = ElevatedTunnelQa(input, connectSeconds).run()
    if (!ok) exitProcess(1)
}

class ElevatedTunnelQa(
    private val input: Path,
    private val connectSeconds: Long,
) {
    private val store = DesktopStore(Path.of(".tmp", "elevated-desktop-store"))
    private val controller = DesktopRuntimeController(store)

    fun run(): Boolean {
        DesktopPaths.ensure()
        println("Lumen elevated tunnel QA")
        println("admin=${isAdmin()}")
        println("input=${input.toAbsolutePath()}")
        println("connectSeconds=$connectSeconds")
        if (!isAdmin()) {
            println("FAIL process is not elevated")
            return false
        }

        val tokens = extractTokens(Files.readString(input))
        println("tokens=${tokens.size}")
        if (tokens.isEmpty()) return fail("no subscription tokens found")

        var failures = 0
        tokens.forEachIndexed { index, token ->
            val label = "live-elevated-$index"
            val imported = runCatching { store.importSubscription(token, token, label) }.getOrElse {
                failures++
                println("IMPORT FAIL source=$index ${SecretRedactor.redact(it.message)}")
                return@forEachIndexed
            }
            println("IMPORT OK source=$index servers=$imported")
        }

        val servers = store.servers
        println("servers=${servers.size}")
        servers.forEachIndexed { index, server ->
            val backend = RuntimeSupport.backend(server)
            val prefix = "[$index/${servers.size}] ${RuntimeSupport.label(server.protocol)} backend=${backend.name} endpoint=${server.host}:${server.port}"
            if (backend == RuntimeBackend.UNSUPPORTED) {
                failures++
                println("$prefix FAIL unsupported")
                return@forEachIndexed
            }

            val validation = controller.validate(server.id)
            if (!validation.ok) {
                failures++
                println("$prefix FAIL validate ${SecretRedactor.redact(validation.message)}")
                return@forEachIndexed
            }

            println("$prefix START")
            val started = runCatching { controller.start(server.id, store.settings) }.getOrElse {
                failures++
                println("$prefix FAIL start ${SecretRedactor.redact(it.message)}")
                controller.stopQuietly()
                return@forEachIndexed
            }
            println("$prefix STATE ${started.status} ${SecretRedactor.redact(started.message)}")
            Thread.sleep(connectSeconds * 1000)
            val status = runCatching { controller.status() }.getOrNull()
            println("$prefix STATUS ${status?.status ?: "unknown"} ${SecretRedactor.redact(status?.message)}")
            if (status?.status == "error") {
                failures++
                println("$prefix FAIL status ${SecretRedactor.redact(status.message)}")
                controller.stopQuietly()
                Thread.sleep(1500)
                return@forEachIndexed
            }

            val network = networkCheck()
            if (network == null) {
                println("$prefix NETWORK OK")
            } else {
                failures++
                println("$prefix FAIL network ${SecretRedactor.redact(network)}")
            }
            controller.stopQuietly()
            Thread.sleep(1500)
        }

        println("summary servers=${servers.size} failures=$failures")
        return failures == 0
    }

    private fun fail(message: String): Boolean {
        println("FAIL $message")
        return false
    }

    private fun RuntimeController.stopQuietly() {
        runCatching { stop() }
    }

    private fun networkCheck(): String? {
        val javaIssue = javaNetworkCheck()
        if (javaIssue == null) return null
        return curlNetworkCheck()
    }

    private fun javaNetworkCheck(): String? =
        runCatching {
            val connection = URI("https://api.ipify.org?format=json").toURL().openConnection() as HttpURLConnection
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            connection.requestMethod = "GET"
            connection.setRequestProperty("User-Agent", "LumenVPN-ElevatedQA/1.0")
            val code = connection.responseCode
            val body = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()
                ?.readText()
                .orEmpty()
            if (code in 200..299 && body.contains("ip")) null else "HTTP $code $body"
        }.getOrElse { it.message ?: it::class.java.simpleName }

    private fun curlNetworkCheck(): String? =
        runCatching {
            val process = ProcessBuilder(
                "curl.exe",
                "--silent",
                "--show-error",
                "--max-time",
                "12",
                "https://api.ipify.org?format=json",
            )
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().readText()
            val code = process.waitFor()
            if (code == 0 && output.contains("ip")) null else "curl exit $code $output"
        }.getOrElse { "curl ${it.message ?: it::class.java.simpleName}" }

    private fun isAdmin(): Boolean =
        runCatching {
            val script = "[Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent() | " +
                "ForEach-Object { ${'$'}_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }"
            ProcessBuilder("powershell.exe", "-NoProfile", "-Command", script)
                .redirectErrorStream(true)
                .start()
                .inputStream
                .bufferedReader()
                .readText()
                .trim()
                .equals("true", ignoreCase = true)
        }.getOrDefault(false)

    private fun extractTokens(text: String): List<String> =
        text.lines()
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .filterNot { it.matches(Regex("""\d+(?:-\d+)?""")) }
            .flatMap { line -> TOKEN_REGEX.findAll(line).map { it.value.trimEnd(',', ';') }.toList() }

    companion object {
        private val TOKEN_REGEX = Regex(
            """(?is)(vpn://\S+|hiddify://\S+|sing-box://\S+|clash://\S+|happ://\S+|lumen://\S+|https?://\S+|vless://\S+|vmess://\S+|trojan://\S+|ss://\S+|socks(?:4a?|5)?://\S+|hysteria2://\S+|hy2://\S+|tuic://\S+|wireguard://\S+|ikev2://\S+|ipsec://\S+)"""
        )
    }
}
