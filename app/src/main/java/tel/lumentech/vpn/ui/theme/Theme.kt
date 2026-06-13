package tel.lumentech.vpn.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val LumenScheme = darkColorScheme(
    primary = Color(0xFF41F0DB),
    onPrimary = Color.Black,
    background = Color(0xFF020504),
    surface = Color(0xFF06110F),
    onBackground = Color(0xFFD9FFF7),
    onSurface = Color(0xFFD9FFF7),
)

@Composable
fun LumenTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = LumenScheme, content = content)
}
