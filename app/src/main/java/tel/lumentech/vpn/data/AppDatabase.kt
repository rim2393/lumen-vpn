package tel.lumentech.vpn.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.SubscriptionProfile

@Entity(tableName = "subscriptions")
data class SubscriptionEntity(
    @PrimaryKey val id: String,
    val name: String,
    val source: String,
    val updatedAt: Long,
)

@Entity(tableName = "servers")
data class ServerEntity(
    @PrimaryKey val id: String,
    val subscriptionId: String,
    val displayName: String,
    val protocol: String,
    val rawUri: String,
    val host: String,
    val port: Int,
    val username: String,
    val password: String,
    val uuid: String,
    val method: String,
    val transport: String,
    val security: String,
    val sni: String,
    val publicKey: String,
    val shortId: String,
    val path: String,
    val serviceName: String,
    val extraJson: String,
    val portCipher: String = "",
)

@Dao
interface LumenDao {
    @Query("SELECT * FROM subscriptions ORDER BY updatedAt DESC")
    fun subscriptions(): Flow<List<SubscriptionEntity>>

    @Query("SELECT * FROM subscriptions WHERE id = :id LIMIT 1")
    suspend fun subscriptionById(id: String): SubscriptionEntity?

    @Query("SELECT * FROM servers ORDER BY displayName ASC")
    fun servers(): Flow<List<ServerEntity>>

    @Query("SELECT * FROM servers WHERE subscriptionId = :subscriptionId ORDER BY displayName ASC")
    suspend fun serversBySubscription(subscriptionId: String): List<ServerEntity>

    @Query("SELECT * FROM servers WHERE id = :id LIMIT 1")
    suspend fun serverById(id: String): ServerEntity?

    @Query("SELECT * FROM servers")
    suspend fun allServersSnapshot(): List<ServerEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSubscription(subscription: SubscriptionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertServers(servers: List<ServerEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertServer(server: ServerEntity)

    @Query("DELETE FROM servers WHERE subscriptionId = :subscriptionId")
    suspend fun deleteServersForSubscription(subscriptionId: String)

    @Query("DELETE FROM subscriptions WHERE id = :subscriptionId")
    suspend fun deleteSubscription(subscriptionId: String)

    @Query("DELETE FROM servers WHERE id = :serverId")
    suspend fun deleteServer(serverId: String)
}

@Database(
    entities = [SubscriptionEntity::class, ServerEntity::class],
    version = 2,
    exportSchema = true
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun dao(): LumenDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE servers ADD COLUMN portCipher TEXT NOT NULL DEFAULT ''")
            }
        }
    }
}

fun SubscriptionProfile.toEntity(codec: ProfileFieldCodec = PlainProfileFieldCodec): SubscriptionEntity =
    SubscriptionEntity(id, name, codec.encrypt(source), updatedAt)

fun SubscriptionEntity.toModel(codec: ProfileFieldCodec = PlainProfileFieldCodec): SubscriptionProfile =
    SubscriptionProfile(id = id, name = name, source = codec.decrypt(source), servers = emptyList(), updatedAt = updatedAt)

fun ServerProfile.toEntity(codec: ProfileFieldCodec = PlainProfileFieldCodec): ServerEntity = ServerEntity(
    id = id,
    subscriptionId = subscriptionId,
    displayName = displayName,
    protocol = protocol.name,
    rawUri = codec.encrypt(rawUri),
    host = codec.encrypt(host),
    port = 0,
    username = codec.encrypt(username),
    password = codec.encrypt(password),
    uuid = codec.encrypt(uuid),
    method = codec.encrypt(method),
    transport = codec.encrypt(transport),
    security = codec.encrypt(security),
    sni = codec.encrypt(sni),
    publicKey = codec.encrypt(publicKey),
    shortId = codec.encrypt(shortId),
    path = codec.encrypt(path),
    serviceName = codec.encrypt(serviceName),
    extraJson = codec.encrypt(extraJson),
    portCipher = codec.encrypt(port.toString()),
)

fun ServerEntity.toModel(codec: ProfileFieldCodec = PlainProfileFieldCodec): ServerProfile = ServerProfile(
    id = id,
    subscriptionId = subscriptionId,
    displayName = displayName,
    protocol = runCatching { ProtocolType.valueOf(protocol) }.getOrDefault(ProtocolType.UNKNOWN),
    rawUri = codec.decrypt(rawUri),
    host = codec.decrypt(host),
    port = codec.decrypt(portCipher).toIntOrNull() ?: port,
    username = codec.decrypt(username),
    password = codec.decrypt(password),
    uuid = codec.decrypt(uuid),
    method = codec.decrypt(method),
    transport = codec.decrypt(transport),
    security = codec.decrypt(security),
    sni = codec.decrypt(sni),
    publicKey = codec.decrypt(publicKey),
    shortId = codec.decrypt(shortId),
    path = codec.decrypt(path),
    serviceName = codec.decrypt(serviceName),
    extraJson = codec.decrypt(extraJson),
)
