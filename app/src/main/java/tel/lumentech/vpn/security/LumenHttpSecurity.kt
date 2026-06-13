package tel.lumentech.vpn.security

import java.util.Locale
import okhttp3.CertificatePinner

object LumenHttpSecurity {
    private const val LETS_ENCRYPT_E7_PIN = "sha256/y7xVm0TVJNahMr2sZydE2jQH8SquXV9yLF9seROHHHU="

    val certificatePinner: CertificatePinner = CertificatePinner.Builder()
        .add(
            "lumentech.tel",
            "sha256/mLiQVW1AlLveGLV61vbWLZ9SzkxLkdC9JQ3kpH72/PM=",
            LETS_ENCRYPT_E7_PIN,
        )
        .add(
            "cabinet.lumentech.tel",
            "sha256/vpEExKfky6Yo2WNuj8FiDjbjciToh0scj4sCsRAhgzI=",
            LETS_ENCRYPT_E7_PIN,
        )
        .add(
            "api.bearshits.ru",
            "sha256/Ya2Igjszt7Ahcz9rMiXpVwZ2EFWDNBByiqYYquqX1W4=",
            LETS_ENCRYPT_E7_PIN,
        )
        .build()

    fun canAttachDeviceId(host: String): Boolean =
        host.lowercase(Locale.US) in DEVICE_ID_HOSTS

    private val DEVICE_ID_HOSTS = setOf(
        "lumentech.tel",
        "cabinet.lumentech.tel",
        "panel.lumentech.tel",
        "sub.lumentech.tel",
        "panel.test.lumentech.tel",
        "sub.test.lumentech.tel",
        "api.bearshits.ru",
        "panel.89-185-85-184.sslip.io",
        "sub.89-185-85-184.sslip.io",
    )
}
