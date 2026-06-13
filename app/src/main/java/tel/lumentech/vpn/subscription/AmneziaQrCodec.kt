package tel.lumentech.vpn.subscription

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.zip.InflaterInputStream

object AmneziaQrCodec {
    private const val QR_MAGIC = 1984
    private const val MAX_DECODED_BYTES = 5 * 1024 * 1024

    fun parseChunk(code: String): QrChunk? {
        val bytes = decodeBase64Url(code.trim()) ?: return null
        if (bytes.size < 8) return null
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
        val magic = buffer.short.toInt() and 0xffff
        if (magic != QR_MAGIC) return null
        val total = buffer.get().toInt() and 0xff
        val id = buffer.get().toInt() and 0xff
        if (total <= 0 || id >= total || buffer.remaining() < 4) return null
        val length = buffer.int
        if (length < 0 || length > buffer.remaining()) return null
        val data = ByteArray(length)
        buffer.get(data)
        return QrChunk(total, id, data)
    }

    fun decodeQrPayloadToText(bytes: ByteArray): String? {
        decodeQtCompressed(bytes)?.let { return it }
        bytes.toUtf8StrictOrNull()?.let { text ->
            decodeNativeConfig(text)?.let { return it }
            return text
        }
        return null
    }

    fun decodeNativeConfig(value: String): String? {
        val normalized = value.trim().removePrefix("vpn://").trim()
        if (!looksLikeBase64Url(normalized)) return null
        val decoded = decodeBase64Url(normalized) ?: return null
        decoded.toUtf8StrictOrNull()?.takeIf { it.trim().startsWith("{") || it.trim().startsWith("[") }?.let {
            return it
        }
        return decodeQtCompressed(decoded)
    }

    fun decodeQtCompressed(bytes: ByteArray): String? {
        if (bytes.isEmpty()) return null
        inflate(bytes, 4)?.let { return it.toUtf8StrictOrNull() }
        return inflate(bytes, 0)?.toUtf8StrictOrNull()
    }

    private fun inflate(bytes: ByteArray, offset: Int): ByteArray? {
        if (bytes.size <= offset) return null
        return runCatching {
            InflaterInputStream(ByteArrayInputStream(bytes, offset, bytes.size - offset)).use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    total += read
                    require(total <= MAX_DECODED_BYTES) { "Decoded Amnezia config is too large" }
                    output.write(buffer, 0, read)
                }
                output.toByteArray().takeIf { it.isNotEmpty() }
            }
        }.getOrNull()
    }

    private fun decodeBase64Url(value: String): ByteArray? {
        val cleaned = value
            .removePrefix("vpn://")
            .trim()
            .replace("\\s".toRegex(), "")
        if (cleaned.isBlank()) return null
        val padded = cleaned + "=".repeat((4 - cleaned.length % 4) % 4)
        return runCatching { Base64.getUrlDecoder().decode(padded) }.getOrNull()
    }

    private fun looksLikeBase64Url(value: String): Boolean =
        value.length >= 16 && value.all { it.isLetterOrDigit() || it == '-' || it == '_' || it == '=' }

    private fun ByteArray.toUtf8StrictOrNull(): String? =
        try {
            StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(this))
                .toString()
        } catch (_: CharacterCodingException) {
            null
        }

    data class QrChunk(val total: Int, val id: Int, val data: ByteArray)
}

class AmneziaQrChunkAccumulator {
    private var total = 0
    private val chunks = sortedMapOf<Int, ByteArray>()

    val expectedTotal: Int get() = total
    val received: Int get() = chunks.size

    fun accept(chunk: AmneziaQrCodec.QrChunk): ByteArray? {
        if (total != chunk.total) {
            total = chunk.total
            chunks.clear()
        }
        chunks[chunk.id] = chunk.data
        if (chunks.size != total) return null
        return ByteArrayOutputStream().use { output ->
            for (id in 0 until total) {
                output.write(chunks[id] ?: return null)
            }
            output.toByteArray()
        }
    }
}
