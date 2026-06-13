package tel.lumentech.vpn.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.MessageDigest
import java.util.UUID

class DeviceIdentityStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "device_identity",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun hwid(): String {
        prefs.getString(KEY_HWID, null)?.takeIf { it.isNotBlank() }?.let { return it }
        val installId = UUID.randomUUID().toString()
        val hwid = sha256Hex("lumen-android:$installId")
        prefs.edit().putString(KEY_HWID, hwid).apply()
        return hwid
    }

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private companion object {
        const val KEY_HWID = "hwid"
    }
}
