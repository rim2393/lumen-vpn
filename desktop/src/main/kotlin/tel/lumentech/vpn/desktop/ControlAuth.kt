package tel.lumentech.vpn.desktop

import java.nio.file.Files
import java.security.SecureRandom
import java.util.Base64

object ControlAuth {
    fun token(): String {
        DesktopPaths.ensure()
        if (Files.exists(DesktopPaths.controlTokenFile)) {
            Files.readString(DesktopPaths.controlTokenFile).trim().takeIf { it.isNotBlank() }?.let { return it }
        }
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        val value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
        Files.writeString(DesktopPaths.controlTokenFile, value)
        return value
    }

    fun isAuthorized(header: String?): Boolean =
        header == "Bearer ${token()}"
}
