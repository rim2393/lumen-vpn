package org.amnezia.vpn.util

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipFile

private const val TAG = "LibraryLoader"

object LibraryLoader {
    private fun extractLibrary(context: Context, libraryName: String, destination: File): Boolean {
        Log.d(TAG, "Extracting library: $libraryName")
        val apks = hashSetOf<String>()
        context.applicationInfo.run {
            sourceDir?.let { apks += it }
            splitSourceDirs?.let { apks += it }
        }
        val processAbi = Build.SUPPORTED_ABIS.firstOrNull()
        if (processAbi == null) {
            return false
        }
        for (abi in listOf(processAbi)) {
            for (apk in apks) {
                ZipFile(File(apk), ZipFile.OPEN_READ).use { zipFile ->
                    val mappedName = System.mapLibraryName(libraryName)
                    val libraryZipPath = listOf("lib", abi, mappedName).joinToString("/")
                    val zipEntry = zipFile.getEntry(libraryZipPath)
                    if (zipEntry != null) {
                        Log.d(TAG, "Extracting apk:/$libraryZipPath to ${destination.absolutePath}")
                        FileOutputStream(destination).use { outStream ->
                            zipFile.getInputStream(zipEntry).use { inStream ->
                                inStream.copyTo(outStream, 32 * 1024)
                                outStream.fd.sync()
                            }
                        }
                        if (destination.length() > 0L) {
                            return true
                        }
                        destination.delete()
                        throw LoadLibraryException("Extracted empty library apk: $libraryName")
                    }
                }
            }
        }
        return false
    }

    @SuppressLint("UnsafeDynamicallyLoadedCode")
    fun loadSharedLibrary(context: Context, libraryName: String) {
        Log.d(TAG, "Loading library: $libraryName")
        try {
            System.loadLibrary(libraryName)
            return
        } catch (_: UnsatisfiedLinkError) {
            Log.w(TAG, "Failed to load library, try to extract it from apk")
        }
        var tempFile: File? = null
        try {
            tempFile = File.createTempFile("lib", ".so", context.codeCacheDir)
            if (extractLibrary(context, libraryName, tempFile)) {
                System.load(tempFile.absolutePath)
                return
            }
            throw LoadLibraryException(
                "Native library $libraryName is not packaged for supported ABIs: ${Build.SUPPORTED_ABIS.joinToString()}"
            )
        } catch (e: Exception) {
            throw LoadLibraryException("Failed to load library apk: $libraryName", e)
        } finally {
            tempFile?.delete()
        }
    }
}

class LoadLibraryException(message: String? = null, cause: Throwable? = null) : Exception(message, cause)
