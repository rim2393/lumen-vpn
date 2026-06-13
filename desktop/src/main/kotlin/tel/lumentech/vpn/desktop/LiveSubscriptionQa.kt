package tel.lumentech.vpn.desktop

import java.nio.file.Files
import java.nio.file.Path
import kotlin.system.exitProcess
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.RuntimeBackend
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.runtime.SingBoxConfigFactory
import tel.lumentech.vpn.security.SecretRedactor
import tel.lumentech.vpn.subscription.SubscriptionParser
import tel.lumentech.vpn.subscription.SubscriptionSourceResolver

fun main(args: Array<String>) {
    val input = args.firstOrNull()?.let(Path::of) ?: Path.of(".tmp", "live-subscriptions.txt")
    if (!Files.exists(input)) {
        System.err.println("Missing input file: ${input.toAbsolutePath()}")
        System.err.println("Create it with one subscription/link per line. Labels like 1, 2, 4-12 are ignored.")
        exitProcess(2)
    }
    val qa = LiveSubscriptionQa(input)
    val ok = qa.run()
    if (!ok) exitProcess(1)
}

class LiveSubscriptionQa(private val input: Path) {
    private val parser = SubscriptionParser()
    private val store = DesktopStore()
    private val resolver = SubscriptionSourceResolver(hwidProvider = store::hwid)
    private val configFactory = SingBoxConfigFactory()
    private val runtimeBinaries = RuntimeBinaries()
    private val settings = RuntimeSettings()

    fun run(): Boolean {
        DesktopPaths.ensure()
        val tokens = extractTokens(Files.readString(input))
        println("Lumen live subscription QA")
        println("input=${input.toAbsolutePath()}")
        println("tokens=${tokens.size}")
        if (tokens.isEmpty()) {
            println("FAIL no subscription tokens found")
            return false
        }

        var failures = 0
        var totalServers = 0
        val backendCounts = linkedMapOf<String, Int>()

        tokens.forEachIndexed { index, token ->
            println("")
            println("[$index] source=${sourceKind(token)}")
            val result = runCatching {
                val resolved = resolver.resolve("live-$index", token)
                parser.parse(resolved.source, resolved.content, resolved.name ?: "live-$index")
            }
            val importResult = result.getOrElse {
                failures++
                println("  IMPORT FAIL ${SecretRedactor.redact(it.message)}")
                return@forEachIndexed
            }

            println("  imported=${importResult.subscription.servers.size} warnings=${importResult.warnings.size}")
            importResult.warnings.forEach { println("  warning=${SecretRedactor.redact(it)}") }
            totalServers += importResult.subscription.servers.size

            importResult.subscription.servers.forEach { server ->
                val backend = RuntimeSupport.backend(server)
                backendCounts[backend.name] = (backendCounts[backend.name] ?: 0) + 1
                val issue = RuntimeSupport.validationIssue(server)
                val prefix = "  ${RuntimeSupport.label(server.protocol)} backend=${backend.name} endpoint=${server.host}:${server.port}"
                if (issue != null) {
                    failures++
                    println("$prefix FAIL ${SecretRedactor.redact(issue)}")
                    return@forEach
                }
                when (backend) {
                    RuntimeBackend.SING_BOX -> {
                        val check = checkSingBox(server.id, configFactory.build(server, settings))
                        if (check == null) {
                            println("$prefix OK sing-box-check")
                        } else {
                            failures++
                            println("$prefix FAIL ${SecretRedactor.redact(check)}")
                        }
                    }
                    RuntimeBackend.AMNEZIAWG -> {
                        val missing = runtimeBinaries.requireExisting(runtimeBinaries.amneziaWg, "amneziawg.exe")
                        if (missing == null) println("$prefix OK runtime-present") else {
                            failures++
                            println("$prefix FAIL $missing")
                        }
                    }
                    RuntimeBackend.OPENVPN,
                    RuntimeBackend.OPENVPN_CLOAK,
                    RuntimeBackend.OPENVPN_SHADOWSOCKS -> {
                        val missing = runtimeBinaries.requireExisting(runtimeBinaries.openVpn, "openvpn.exe")
                            ?: if (backend == RuntimeBackend.OPENVPN_CLOAK) {
                                runtimeBinaries.requireExisting(runtimeBinaries.cloak, "cloak.exe")
                            } else if (backend == RuntimeBackend.OPENVPN_SHADOWSOCKS) {
                                runtimeBinaries.requireExisting(runtimeBinaries.singBox, "sing-box.exe")
                            } else {
                                null
                            }
                        if (missing == null) println("$prefix OK runtime-present") else {
                            failures++
                            println("$prefix FAIL $missing")
                        }
                    }
                    RuntimeBackend.WINDOWS_IKEV2 -> println("$prefix OK windows-ikev2-profile")
                    RuntimeBackend.UNSUPPORTED -> {
                        failures++
                        println("$prefix FAIL unsupported")
                    }
                }
            }
        }

        println("")
        println("summary tokens=${tokens.size} servers=$totalServers failures=$failures backends=$backendCounts")
        return failures == 0
    }

    private fun extractTokens(text: String): List<String> =
        text.lines()
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .filterNot { it.matches(Regex("""\d+(?:-\d+)?""")) }
            .flatMap { line ->
                TOKEN_REGEX.findAll(line).map { it.value.trimEnd(',', ';') }.toList()
            }

    private fun sourceKind(token: String): String = when {
        token.startsWith("vpn://", true) -> "vpn"
        token.startsWith("http://", true) || token.startsWith("https://", true) -> "remote-url"
        else -> "inline"
    }

    private fun checkSingBox(id: String, config: String): String? {
        val binaryIssue = runtimeBinaries.requireExisting(runtimeBinaries.singBox, "sing-box.exe")
        if (binaryIssue != null) return binaryIssue
        val configFile = DesktopPaths.generatedConfigDir.resolve("qa-$id.json")
        Files.writeString(configFile, config)
        val process = ProcessBuilder(runtimeBinaries.singBox.toString(), "check", "-c", configFile.toString())
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.bufferedReader().readText()
        val code = process.waitFor()
        return if (code == 0) null else output.ifBlank { "sing-box check failed with exit code $code" }
    }

    companion object {
        private val TOKEN_REGEX = Regex(
            """(?is)(vpn://\S+|hiddify://\S+|sing-box://\S+|clash://\S+|happ://\S+|lumen://\S+|https?://\S+|vless://\S+|vmess://\S+|trojan://\S+|ss://\S+|socks(?:4a?|5)?://\S+|hysteria2://\S+|hy2://\S+|tuic://\S+|wireguard://\S+|ikev2://\S+|ipsec://\S+)"""
        )
    }
}
