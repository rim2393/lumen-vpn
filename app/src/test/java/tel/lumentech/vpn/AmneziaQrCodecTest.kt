package tel.lumentech.vpn

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import java.util.zip.Deflater
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import tel.lumentech.vpn.subscription.AmneziaQrChunkAccumulator
import tel.lumentech.vpn.subscription.AmneziaQrCodec

class AmneziaQrCodecTest {
    @Test
    fun decodesVpnUrlWithQtCompressedJson() {
        val json = """{"description":"Demo","containers":[]}"""
        val vpnUrl = "vpn://${qCompressBase64Url(json)}"

        val decoded = AmneziaQrCodec.decodeNativeConfig(vpnUrl)

        assertEquals(json, decoded)
    }

    @Test
    fun collectsAmneziaMultiPartQrChunks() {
        val first = makeQrChunk(total = 2, id = 0, data = "hello ".toByteArray())
        val second = makeQrChunk(total = 2, id = 1, data = "world".toByteArray())
        val accumulator = AmneziaQrChunkAccumulator()

        assertEquals(null, accumulator.accept(AmneziaQrCodec.parseChunk(first)!!))
        val complete = accumulator.accept(AmneziaQrCodec.parseChunk(second)!!)

        assertNotNull(complete)
        assertEquals("hello world", complete!!.decodeToString())
        assertTrue(AmneziaQrCodec.parseChunk(first)!!.total == 2)
    }

    private fun makeQrChunk(total: Int, id: Int, data: ByteArray): String {
        val bytes = ByteBuffer.allocate(8 + data.size)
            .order(ByteOrder.BIG_ENDIAN)
            .putShort(1984.toShort())
            .put(total.toByte())
            .put(id.toByte())
            .putInt(data.size)
            .put(data)
            .array()
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun qCompressBase64Url(text: String): String {
        val input = text.toByteArray()
        val deflater = Deflater(8)
        deflater.setInput(input)
        deflater.finish()
        val compressed = ByteArrayOutputStream()
        val buffer = ByteArray(256)
        while (!deflater.finished()) {
            compressed.write(buffer, 0, deflater.deflate(buffer))
        }
        val output = ByteBuffer.allocate(4 + compressed.size())
            .order(ByteOrder.BIG_ENDIAN)
            .putInt(input.size)
            .put(compressed.toByteArray())
            .array()
        return Base64.getUrlEncoder().withoutPadding().encodeToString(output)
    }
}
