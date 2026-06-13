package tel.lumentech.vpn.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import tel.lumentech.vpn.BuildConfig
import tel.lumentech.vpn.security.LumenHttpSecurity

@Serializable
data class UpdateManifest(
    val versionCode: Long,
    val versionName: String = "",
    val apkUrl: String,
    val apkSha256: String = "",
    val sizeBytes: Long = 0,
    val mandatory: Boolean = false,
    val releaseNotes: String = "",
)

data class AppUpdateInfo(
    val versionCode: Long,
    val versionName: String,
    val apkUrl: String,
    val apkSha256: String,
    val sizeBytes: Long,
    val mandatory: Boolean,
    val releaseNotes: String,
)

data class DownloadedUpdate(
    val versionCode: Long,
    val versionName: String,
    val filePath: String,
    val sizeBytes: Long,
    val sha256: String,
)

enum class AppUpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Downloaded,
    Installing,
    UpToDate,
    Error,
}

data class AppUpdateState(
    val status: AppUpdateStatus = AppUpdateStatus.Idle,
    val available: AppUpdateInfo? = null,
    val downloaded: DownloadedUpdate? = null,
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val lastCheckedAt: Long = 0,
    val permissionRequired: Boolean = false,
    val error: String = "",
)

class UpdateRepository(
    private val context: Context,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .certificatePinner(LumenHttpSecurity.certificatePinner)
        .build(),
    private val manifestUrl: String = DEFAULT_MANIFEST_URL,
) {
    suspend fun check(currentVersionCode: Long = BuildConfig.VERSION_CODE.toLong()): AppUpdateInfo? =
        withContext(Dispatchers.IO) {
            val safeManifestUrl = requireHttpsUrl(manifestUrl)
            val request = Request.Builder()
                .url(safeManifestUrl)
                .header("Cache-Control", "no-cache")
                .get()
                .build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("Update check failed: HTTP ${response.code}")
                val body = response.body.string()
                val manifest = parseManifestJson(body)
                manifest.copy(apkUrl = resolveApkUrl(safeManifestUrl, manifest.apkUrl))
                    .toAvailableUpdate(currentVersionCode)
            }
        }

    suspend fun download(
        info: AppUpdateInfo,
        onProgress: (downloadedBytes: Long, totalBytes: Long) -> Unit,
    ): DownloadedUpdate = withContext(Dispatchers.IO) {
        val safeUrl = requireHttpsUrl(info.apkUrl)
        requireValidSha256(info.apkSha256)
        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        val target = File(updatesDir, "lumen-vpn-${info.versionCode}.apk")
        val temp = File(updatesDir, "${target.name}.download")

        runCatching {
            temp.delete()
            target.delete()

            val request = Request.Builder().url(safeUrl).get().build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("Update download failed: HTTP ${response.code}")
                val body = response.body
                val responseLength = body.contentLength()
                val expectedTotal = when {
                    info.sizeBytes > 0 -> info.sizeBytes
                    responseLength > 0 -> responseLength
                    else -> 0L
                }
                if (expectedTotal > MAX_APK_BYTES) error("Update APK is too large")
                body.byteStream().use { input ->
                    temp.outputStream().use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        var downloaded = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            downloaded += read
                            if (downloaded > MAX_APK_BYTES) error("Update APK is too large")
                            output.write(buffer, 0, read)
                            onProgress(downloaded, expectedTotal)
                        }
                    }
                }
            }

            if (info.sizeBytes > 0 && temp.length() != info.sizeBytes) {
                error("Downloaded APK size mismatch")
            }
            val actualSha = sha256Hex(temp)
            if (!actualSha.equals(info.apkSha256, ignoreCase = true)) {
                error("Downloaded APK checksum mismatch")
            }
            if (!temp.renameTo(target)) {
                temp.copyTo(target, overwrite = true)
                temp.delete()
            }
            validateApkPackage(target, info)
            DownloadedUpdate(
                versionCode = info.versionCode,
                versionName = info.versionName,
                filePath = target.absolutePath,
                sizeBytes = target.length(),
                sha256 = actualSha,
            )
        }.onFailure {
            temp.delete()
            target.delete()
        }.getOrThrow()
    }

    fun canRequestPackageInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

    fun installPermissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun installIntent(update: DownloadedUpdate): Intent {
        val file = File(update.filePath)
        require(file.exists()) { "Downloaded update is missing" }
        val uri = FileProvider.getUriForFile(
            context,
            "${BuildConfig.APPLICATION_ID}.fileprovider",
            file,
        )
        return Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, APK_MIME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }

    private fun validateApkPackage(file: File, info: AppUpdateInfo) {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfoCompat(file)
            ?: error("Downloaded file is not a valid APK")
        if (archive.packageName != BuildConfig.APPLICATION_ID) {
            error("Downloaded APK package mismatch")
        }
        if (archive.longVersionCodeCompat() <= BuildConfig.VERSION_CODE.toLong()) {
            error("Downloaded APK is not newer than the installed app")
        }

        val installed = pm.getPackageInfoCompat(BuildConfig.APPLICATION_ID)
        val archiveDigests = archive.signingCertificateDigests()
        val installedDigests = installed.signingCertificateDigests()
        if (archiveDigests.isEmpty()) {
            error("Downloaded APK signing certificate is missing")
        }
        if (installedDigests.isEmpty()) {
            error("Installed APK signing certificate is missing")
        }
        if (archiveDigests.intersect(installedDigests).isEmpty()) {
            error("Downloaded APK signing certificate mismatch")
        }
    }

    @Suppress("DEPRECATION")
    private fun PackageManager.getPackageArchiveInfoCompat(file: File): PackageInfo? {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        return getPackageArchiveInfo(file.absolutePath, flags)
    }

    @Suppress("DEPRECATION")
    private fun PackageManager.getPackageInfoCompat(packageName: String): PackageInfo {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            getPackageInfo(packageName, flags)
        }
    }

    @Suppress("DEPRECATION")
    private fun PackageInfo.longVersionCodeCompat(): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) longVersionCode else versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun PackageInfo.signingCertificateDigests(): Set<String> {
        val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            signingInfo?.apkContentsSigners
        } else {
            signatures
        } ?: return emptySet()
        return signatures.map { sha256Hex(it.toByteArray()) }.toSet()
    }

    companion object {
        const val DEFAULT_MANIFEST_URL = "https://lumentech.tel/downloads/android/latest.json"
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val DEFAULT_BUFFER_SIZE = 32 * 1024
        private const val MAX_APK_BYTES = 500L * 1024L * 1024L
        private val SHA256_HEX = Regex("^[0-9a-f]{64}$")
        private val json = Json { ignoreUnknownKeys = true }

        fun parseManifestJson(text: String): UpdateManifest =
            json.decodeFromString(UpdateManifest.serializer(), text)

        fun UpdateManifest.toAvailableUpdate(currentVersionCode: Long): AppUpdateInfo? {
            if (versionCode <= currentVersionCode) return null
            val checkedSha256 = requireValidSha256(apkSha256)
            return AppUpdateInfo(
                versionCode = versionCode,
                versionName = versionName.ifBlank { versionCode.toString() },
                apkUrl = requireHttpsUrl(apkUrl),
                apkSha256 = checkedSha256,
                sizeBytes = sizeBytes.coerceAtLeast(0L),
                mandatory = mandatory,
                releaseNotes = releaseNotes,
            )
        }

        fun requireHttpsUrl(url: String): String {
            val normalized = url.trim()
            val uri = URI(normalized)
            require(uri.scheme.equals("https", ignoreCase = true)) { "Update URL must use HTTPS" }
            require(!uri.host.isNullOrBlank()) { "Update URL host is missing" }
            return normalized
        }

        fun requireValidSha256(value: String): String {
            val normalized = value.trim().lowercase(Locale.US)
            require(normalized.isNotEmpty()) {
                "apkSha256 is required for update manifests"
            }
            require(SHA256_HEX.matches(normalized)) {
                "apkSha256 must be a valid 64-character SHA-256 hex"
            }
            return normalized
        }

        fun resolveApkUrl(manifestUrl: String, apkUrl: String): String {
            val resolved = URI(requireHttpsUrl(manifestUrl)).resolve(apkUrl.trim()).toString()
            return requireHttpsUrl(resolved)
        }

        fun sha256Hex(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    digest.update(buffer, 0, read)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(Locale.US, it) }
        }

        fun sha256Hex(bytes: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            return digest.joinToString("") { "%02x".format(Locale.US, it) }
        }
    }
}
