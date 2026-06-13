package tel.lumentech.vpn.desktop

import kotlinx.serialization.Serializable
import tel.lumentech.vpn.data.RuntimeSettings

interface RuntimeController {
    fun start(profileId: String, settings: RuntimeSettings): RuntimeState
    fun stop(): RuntimeState
    fun status(): RuntimeState
    fun logs(): String
    fun validate(profileId: String): RuntimeValidation
}

@Serializable
data class RuntimeState(
    val status: String,
    val backend: String = "",
    val profileId: String = "",
    val message: String = "",
)

@Serializable
data class RuntimeValidation(
    val ok: Boolean,
    val backend: String,
    val message: String = "",
)
