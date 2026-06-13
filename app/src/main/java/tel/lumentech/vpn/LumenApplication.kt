package tel.lumentech.vpn

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import androidx.room.Room
import tel.lumentech.vpn.data.AndroidKeystoreFieldCodec
import tel.lumentech.vpn.data.AppDatabase
import tel.lumentech.vpn.data.DeviceIdentityStore
import tel.lumentech.vpn.data.Preferences
import tel.lumentech.vpn.data.SubscriptionRepository
import tel.lumentech.vpn.subscription.SubscriptionSourceResolver
import tel.lumentech.vpn.update.UpdateRepository

class LumenApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannels()
        val db = Room.databaseBuilder(this, AppDatabase::class.java, "lumen.db")
            .addMigrations(AppDatabase.MIGRATION_1_2)
            .build()
        val profileFieldCodec = AndroidKeystoreFieldCodec()
        val deviceIdentity = DeviceIdentityStore(this)
        container = AppContainer(
            app = this,
            database = db,
            deviceIdentity = deviceIdentity,
            preferences = Preferences(this),
            subscriptions = SubscriptionRepository(
                dao = db.dao(),
                fieldCodec = profileFieldCodec,
                resolver = SubscriptionSourceResolver(hwidProvider = deviceIdentity::hwid),
            ),
            updates = UpdateRepository(this),
            connectivity = getSystemService(ConnectivityManager::class.java),
            wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager,
            notification = getSystemService(NotificationManager::class.java),
        )
    }

    private fun createChannels() {
        val channel = NotificationChannel(
            VPN_CHANNEL_ID,
            getString(R.string.vpn_channel_name),
            NotificationManager.IMPORTANCE_LOW
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val VPN_CHANNEL_ID = "lumen_vpn"
        lateinit var instance: LumenApplication
            private set
    }
}

data class AppContainer(
    val app: LumenApplication,
    val database: AppDatabase,
    val deviceIdentity: DeviceIdentityStore,
    val preferences: Preferences,
    val subscriptions: SubscriptionRepository,
    val updates: UpdateRepository,
    val connectivity: ConnectivityManager,
    val wifi: WifiManager,
    val notification: NotificationManager,
)
