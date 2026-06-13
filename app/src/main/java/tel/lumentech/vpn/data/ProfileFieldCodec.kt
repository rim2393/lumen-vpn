package tel.lumentech.vpn.data

interface ProfileFieldCodec {
    fun encrypt(value: String): String
    fun decrypt(value: String): String
}

object PlainProfileFieldCodec : ProfileFieldCodec {
    override fun encrypt(value: String): String = value
    override fun decrypt(value: String): String = value
}
