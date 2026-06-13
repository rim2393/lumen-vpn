package tel.lumentech.vpn.vpn

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Ikev2VpnProfile
import android.net.VpnManager
import android.net.VpnProfileState
import android.os.Build
import androidx.annotation.RequiresApi
import java.io.ByteArrayInputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import org.json.JSONObject
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.VpnStatus
import tel.lumentech.vpn.runtime.RuntimeSupport

object AndroidIkev2PlatformVpn {
    fun isSupported(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_IPSEC_TUNNELS)

    fun provisionOrStart(context: Context, profile: ServerProfile): Intent? {
        require(Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            "Android IKEv2/IPsec needs Android 11 or newer."
        }
        require(isSupported(context)) {
            "This Android device does not expose platform IPsec tunnel support."
        }
        RuntimeSupport.validationIssue(profile)?.let { message -> error(message) }
        return provisionOrStartApi30(context, profile)
    }

    fun stop(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        val manager = context.getSystemService(VpnManager::class.java) ?: return
        VpnState.status = VpnStatus.Stopping
        VpnState.event("Stopping Android IKEv2 platform VPN")
        runCatching { manager.stopProvisionedVpnProfile() }
        VpnState.status = VpnStatus.Stopped
        VpnState.lastError = ""
        VpnState.event("Android IKEv2 platform VPN stopped")
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun provisionOrStartApi30(context: Context, profile: ServerProfile): Intent? {
        val manager = context.getSystemService(VpnManager::class.java)
            ?: error("Android VpnManager is not available.")
        val platformProfile = buildPlatformProfile(profile)
        VpnState.status = VpnStatus.Starting
        VpnState.lastError = ""
        VpnState.event("Provisioning Android IKEv2 platform VPN for ${profile.host}")
        val consent = manager.provisionVpnProfile(platformProfile)
        if (consent != null) {
            VpnState.event("Android IKEv2 profile needs user consent")
            return consent
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val session = manager.startProvisionedVpnProfileSession()
            VpnState.event("Android IKEv2 platform VPN start requested session=${session.take(12)}")
        } else {
            @Suppress("DEPRECATION")
            manager.startProvisionedVpnProfile()
            VpnState.event("Android IKEv2 platform VPN start requested")
        }
        waitForConnected(manager)
        VpnState.status = VpnStatus.Running
        VpnState.event("Android IKEv2 platform VPN connected")
        return null
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun waitForConnected(manager: VpnManager) {
        val deadline = System.currentTimeMillis() + CONNECT_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            val state = manager.provisionedVpnProfileState
            when (state?.state) {
                VpnProfileState.STATE_CONNECTED -> return
                VpnProfileState.STATE_FAILED -> error("Android IKEv2/IPsec profile failed to connect.")
            }
            Thread.sleep(CONNECT_POLL_MS)
        }
        error("Android IKEv2/IPsec connection timed out before the platform reported CONNECTED.")
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun buildPlatformProfile(profile: ServerProfile): Ikev2VpnProfile {
        val extra = profile.extraObject()
        val identity = extra.firstString("server_id", "serverId", "ikev2_server_id", "ikev2ServerId")
            .ifBlank { profile.host }
        val ca = extra.firstString("ikev2_ca_cert", "ikev2CaCert", "caCert", "ca_cert", "ca")
            .toX509Certificate()
        val builder = Ikev2VpnProfile.Builder(profile.host, identity)
            .setAuthUsernamePassword(profile.username, profile.password, ca)
            .setMetered(false)
            .setBypassable(false)
        extra.firstString("mtu", "MTU").toIntOrNull()
            ?.takeIf { it in 1280..9000 }
            ?.let(builder::setMaxMtu)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            builder
                .setAutomaticIpVersionSelectionEnabled(true)
                .setAutomaticNattKeepaliveTimerEnabled(true)
                .setRequiresInternetValidation(true)
        }
        return builder.build()
    }

    private fun ServerProfile.extraObject(): JSONObject =
        runCatching { JSONObject(extraJson.ifBlank { "{}" }) }.getOrDefault(JSONObject())

    private fun JSONObject.firstString(vararg names: String): String {
        for (name in names) {
            val value = optString(name, "")
            if (value.isNotBlank()) return value
        }
        return ""
    }

    private fun String.toX509Certificate(): X509Certificate {
        val text = trim()
        require(text.isNotBlank()) { "IKEv2/IPsec server root CA certificate is missing." }
        val factory = CertificateFactory.getInstance("X.509")
        val bytes = text.toByteArray(Charsets.UTF_8)
        return factory.generateCertificate(ByteArrayInputStream(bytes)) as X509Certificate
    }

    private const val CONNECT_TIMEOUT_MS = 45_000L
    private const val CONNECT_POLL_MS = 500L
}
