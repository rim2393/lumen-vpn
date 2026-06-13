package tel.lumentech.vpn.auth

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class CabinetUser(
    val id: String? = null,
    val email: String? = null,
    val username: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("telegram_id") val telegramId: String? = null,
)
