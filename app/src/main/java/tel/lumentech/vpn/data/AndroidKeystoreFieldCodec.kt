package tel.lumentech.vpn.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class AndroidKeystoreFieldCodec : ProfileFieldCodec {
    private val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    override fun encrypt(value: String): String {
        if (value.isBlank() || value.startsWith(PREFIX)) return value
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        val packed = ByteBuffer.allocate(iv.size + encrypted.size)
            .put(iv)
            .put(encrypted)
            .array()
        return PREFIX + Base64.encodeToString(packed, Base64.NO_WRAP)
    }

    override fun decrypt(value: String): String {
        if (!value.startsWith(PREFIX)) return value
        return runCatching {
            val packed = Base64.decode(value.removePrefix(PREFIX), Base64.NO_WRAP)
            require(packed.size > IV_BYTES)
            val iv = packed.copyOfRange(0, IV_BYTES)
            val encrypted = packed.copyOfRange(IV_BYTES, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
        }.getOrDefault("")
    }

    private fun secretKey(): SecretKey {
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "lumen_profile_field_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val PREFIX = "enc:v1:"
        private const val IV_BYTES = 12
        private const val TAG_BITS = 128
    }
}
