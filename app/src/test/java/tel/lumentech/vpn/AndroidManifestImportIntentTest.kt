package tel.lumentech.vpn

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidManifestImportIntentTest {
    @Test
    fun manifestRegistersThirdPartySubscriptionImportSchemes() {
        val schemes = manifestSchemes()
        val expected = setOf(
            "lumen",
            "hiddify",
            "v2ray",
            "v2rayn",
            "v2rayng",
            "clash",
            "clashmeta",
            "mihomo",
            "stash",
            "sing-box",
            "nekobox",
            "nekoray",
            "karing",
            "happ",
            "vpn",
            "mless",
            "vless",
            "vmess",
            "trojan",
            "ss",
            "socks",
            "socks4",
            "socks4a",
            "socks5",
            "hysteria",
            "hysteria2",
            "hy2",
            "tuic",
            "naive",
            "naiveproxy",
            "wireguard"
        )

        assertTrue(
            "Missing ACTION_VIEW import schemes: ${expected - schemes}",
            schemes.containsAll(expected)
        )
    }

    private fun manifestSchemes(): Set<String> {
        val manifest = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml")
        ).firstOrNull { it.isFile } ?: File("app/src/main/AndroidManifest.xml")
        require(manifest.isFile) { "AndroidManifest.xml not found at ${manifest.absolutePath}" }
        val document = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(manifest)
        val dataNodes = document.getElementsByTagName("data")
        return buildSet {
            for (index in 0 until dataNodes.length) {
                val node = dataNodes.item(index)
                val scheme = node.attributes?.getNamedItem("android:scheme")?.nodeValue
                if (!scheme.isNullOrBlank()) add(scheme)
            }
        }
    }
}
