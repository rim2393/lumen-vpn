package tel.lumentech.vpn

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import tel.lumentech.vpn.update.UpdateRepository

class UpdateRepositoryTest {
    private val validApkSha256 = "0".repeat(64)

    @Test
    fun manifestParsingAcceptsNewerHttpsUpdate() {
        val manifest = UpdateRepository.parseManifestJson(
            """
            {
              "versionCode": 7,
              "versionName": "1.2.3",
              "apkUrl": "https://lumentech.tel/static/downloads/android/lumen-vpn.apk",
              "apkSha256": "$validApkSha256",
              "sizeBytes": 123,
              "mandatory": true,
              "releaseNotes": "Security fixes"
            }
            """.trimIndent()
        )

        val update = with(UpdateRepository) { manifest.toAvailableUpdate(currentVersionCode = 6) }

        assertNotNull(update)
        assertEquals(7L, update?.versionCode)
        assertEquals("1.2.3", update?.versionName)
        assertEquals(validApkSha256, update?.apkSha256)
        assertEquals(123L, update?.sizeBytes)
        assertEquals(true, update?.mandatory)
    }

    @Test
    fun manifestParsingIgnoresCurrentOrOlderVersion() {
        val manifest = UpdateRepository.parseManifestJson(
            """
            {
              "versionCode": 2,
              "versionName": "1.0.1",
              "apkUrl": "https://lumentech.tel/static/downloads/android/lumen-vpn.apk"
            }
            """.trimIndent()
        )

        val update = with(UpdateRepository) { manifest.toAvailableUpdate(currentVersionCode = 2) }

        assertNull(update)
    }

    @Test
    fun manifestParsingRejectsNonHttpsApkUrls() {
        val manifest = UpdateRepository.parseManifestJson(
            """
            {
              "versionCode": 3,
              "versionName": "1.0.2",
              "apkUrl": "http://lumentech.tel/static/downloads/android/lumen-vpn.apk",
              "apkSha256": "$validApkSha256"
            }
            """.trimIndent()
        )

        assertThrows(IllegalArgumentException::class.java) {
            with(UpdateRepository) { manifest.toAvailableUpdate(currentVersionCode = 2) }
        }
    }

    @Test
    fun manifestParsingRejectsAvailableUpdateWithoutApkSha256() {
        val manifest = UpdateRepository.parseManifestJson(
            """
            {
              "versionCode": 3,
              "versionName": "1.0.2",
              "apkUrl": "https://lumentech.tel/static/downloads/android/lumen-vpn.apk",
              "apkSha256": "   "
            }
            """.trimIndent()
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            with(UpdateRepository) { manifest.toAvailableUpdate(currentVersionCode = 2) }
        }

        assertTrue(error.message.orEmpty().contains("apkSha256"))
        assertTrue(error.message.orEmpty().contains("required", ignoreCase = true))
    }

    @Test
    fun manifestParsingRejectsAvailableUpdateWithInvalidApkSha256() {
        val manifest = UpdateRepository.parseManifestJson(
            """
            {
              "versionCode": 3,
              "versionName": "1.0.2",
              "apkUrl": "https://lumentech.tel/static/downloads/android/lumen-vpn.apk",
              "apkSha256": "not-a-sha256"
            }
            """.trimIndent()
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            with(UpdateRepository) { manifest.toAvailableUpdate(currentVersionCode = 2) }
        }

        assertTrue(error.message.orEmpty().contains("apkSha256"))
        assertTrue(error.message.orEmpty().contains("64-character SHA-256 hex", ignoreCase = true))
    }

    @Test
    fun relativeApkUrlsResolveAgainstManifestUrlAndRemainHttps() {
        val resolved = UpdateRepository.resolveApkUrl(
            manifestUrl = "https://lumentech.tel/static/downloads/android/update.json",
            apkUrl = "lumen-vpn-universal-release.apk",
        )

        assertEquals("https://lumentech.tel/static/downloads/android/lumen-vpn-universal-release.apk", resolved)
    }

    @Test
    fun sha256HexMatchesKnownDigest() {
        val temp = File.createTempFile("lumen-update", ".bin")
        try {
            temp.writeText("abc")

            assertEquals(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                UpdateRepository.sha256Hex(temp),
            )
        } finally {
            temp.delete()
        }
    }
}
