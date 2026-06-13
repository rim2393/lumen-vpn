package tel.lumentech.vpn.desktop

import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.client.j2se.BufferedImageLuminanceSource
import com.google.zxing.common.HybridBinarizer
import java.io.File
import javax.imageio.ImageIO

object QrImageImporter {
    fun decode(file: File): String {
        val image = ImageIO.read(file) ?: error("Unsupported image file")
        val bitmap = BinaryBitmap(HybridBinarizer(BufferedImageLuminanceSource(image)))
        return MultiFormatReader().decode(bitmap).text
    }
}
