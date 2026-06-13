package tel.lumentech.vpn

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.Apps
import androidx.compose.material.icons.outlined.BugReport
import androidx.compose.material.icons.outlined.FolderOpen
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.PowerSettingsNew
import androidx.compose.material.icons.outlined.Route
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Storage
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.VpnKey
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import tel.lumentech.vpn.model.ProtocolType
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.model.VpnStatus
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.security.SecretRedactor
import tel.lumentech.vpn.security.SubscriptionSourceLabel
import tel.lumentech.vpn.subscription.AmneziaQrChunkAccumulator
import tel.lumentech.vpn.subscription.AmneziaQrCodec
import tel.lumentech.vpn.subscription.LumenDeepLink
import tel.lumentech.vpn.ui.theme.LumenTheme
import tel.lumentech.vpn.update.AppUpdateState
import tel.lumentech.vpn.update.AppUpdateStatus

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()
    private val pendingImport = MutableStateFlow<PendingImportPayload?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        consumeImportIntent(intent)?.let { payload ->
            queuedImport = payload
            clearSensitiveImportIntent(intent)
            restartWithSafeTaskIntent()
            return
        }
        enableEdgeToEdge()
        setContent {
            LumenTheme {
                LumenApp(viewModel, pendingImport)
            }
        }
        drainQueuedImport()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        consumeImportIntent(intent)?.let { payload ->
            queuedImport = payload
            clearSensitiveImportIntent(intent)
            restartWithSafeTaskIntent()
        }
    }

    private fun consumeImportIntent(intent: Intent?): PendingImportPayload? {
        val data = intent?.dataString ?: return null
        try {
            val payload = LumenDeepLink.parse(data) ?: return null
            return PendingImportPayload(
                source = payload.source,
                content = payload.content,
                name = payload.name,
                origin = importOriginLabel(data),
            )
        } finally {
            clearSensitiveImportIntent(intent)
        }
    }

    private fun drainQueuedImport() {
        queuedImport?.let {
            pendingImport.value = it
            queuedImport = null
        }
    }

    private fun clearSensitiveImportIntent(intent: Intent?) {
        intent ?: return
        intent.action = Intent.ACTION_MAIN
        intent.setData(null)
        intent.replaceExtras(Bundle.EMPTY)
    }

    private fun restartWithSafeTaskIntent() {
        startActivity(
            safeMainIntent()
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        )
        finish()
    }

    private fun safeMainIntent(): Intent =
        Intent(this, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)

    companion object {
        private var queuedImport: PendingImportPayload? = null
    }
}

private data class PendingImportPayload(
    val source: String,
    val content: String,
    val name: String,
    val origin: String,
)

private fun importOriginLabel(raw: String): String {
    val uri = runCatching { Uri.parse(raw) }.getOrNull()
    val scheme = uri?.scheme.orEmpty()
    val host = uri?.host.orEmpty()
    return listOf(scheme, host)
        .filter { it.isNotBlank() }
        .joinToString("://")
        .ifBlank { "external link" }
}

private enum class Screen { Home, Servers, Add, Subscriptions, Routing, Settings, Logs }

@Composable
private fun LumenApp(
    viewModel: MainViewModel,
    pendingImportFlow: MutableStateFlow<PendingImportPayload?>,
) {
    val state by viewModel.state.collectAsState()
    val pendingImport by pendingImportFlow.collectAsState()
    val context = LocalContext.current
    var screen by remember { mutableStateOf(Screen.Home) }
    var showQrScanner by remember { mutableStateOf(false) }
    val copy = remember(state.runtimeSettings.language) { LumenCopy.forLanguage(state.runtimeSettings.language) }
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val vpnPermission = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        viewModel.connect(context) {}
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) viewModel.importFromUri(context, uri)
    }
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            showQrScanner = true
        } else {
            viewModel.setMessage(copy.cameraPermissionRequired)
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = true,
        drawerContent = {
            LumenDrawer(
                state = state,
                copy = copy,
                current = screen,
                onSelect = {
                    screen = it
                    scope.launch { drawerState.close() }
                },
            )
        }
    ) {
        Surface(Modifier.fillMaxSize(), color = LumenColors.Bg0) {
            Box(Modifier.fillMaxSize()) {
                DotGrid()
                Scaffold(
                    containerColor = Color.Transparent,
                    contentColor = LumenColors.Text,
                    topBar = {
                        Header(
                            state = state,
                            copy = copy,
                            screen = screen,
                            onMenu = { scope.launch { drawerState.open() } }
                        )
                    }
                ) { innerPadding ->
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding)
                            .padding(horizontal = 18.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        ProfileSyncBanner(state, copy)
                            if (state.updateState.isUserVisible()) {
                                UpdateBanner(
                                    update = state.updateState,
                                    isEnglish = state.runtimeSettings.language == "en",
                                    onCheck = { viewModel.checkForUpdate(silent = false) },
                                    onDownload = { viewModel.downloadUpdate(context) },
                                    onInstall = { viewModel.installDownloadedUpdate(context) },
                                    onPermission = { viewModel.openInstallPermissionSettings(context) },
                                )
                            }
                            when (screen) {
                                Screen.Home -> HomeScreen(
                                    state = state,
                                    copy = copy,
                                    onConnect = {
                                        if (Build.VERSION.SDK_INT >= 33) {
                                            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                                        }
                                        viewModel.connect(context) { vpnPermission.launch(it) }
                                    },
                                     onDisconnect = { viewModel.disconnect(context) },
                                     onAdd = { screen = Screen.Add },
                                     onServers = { screen = Screen.Servers },
                                     onClipboard = { viewModel.importFromClipboard(context) },
                                     onQr = {
                                         if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                             showQrScanner = true
                                         } else {
                                             cameraPermission.launch(Manifest.permission.CAMERA)
                                         }
                                     },
                                 )
                                Screen.Add -> AddSubscriptionScreen(
                                    copy = copy,
                                    busy = state.busy,
                                    message = state.message,
                                    onImport = { source, content -> viewModel.importText(source, content) },
                                    onClipboard = { viewModel.importFromClipboard(context) },
                                    onFile = { filePicker.launch(arrayOf("*/*")) },
                                    onQr = {
                                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                            showQrScanner = true
                                        } else {
                                            cameraPermission.launch(Manifest.permission.CAMERA)
                                        }
                                    }
                                )
                                Screen.Subscriptions -> SubscriptionsScreen(
                                    state = state,
                                    copy = copy,
                                    onRefresh = viewModel::refreshSubscription,
                                    onDelete = viewModel::deleteSubscription
                                )
                                Screen.Servers -> ServersScreen(
                                    copy = copy,
                                    servers = state.servers,
                                    selectedId = state.selectedServerId,
                                    latencies = state.serverLatencies,
                                    checkingLatencies = state.checkingLatencyIds,
                                    latencyRunning = state.latencyRunning,
                                    latencyCompleted = state.latencyCompleted,
                                    latencyTotal = state.latencyTotal,
                                    onSelect = viewModel::selectServer,
                                    onDetails = viewModel::showServerDetails,
                                    onPing = viewModel::pingServers,
                                    onPingServer = viewModel::pingServer
                                )
                                Screen.Routing -> RoutingScreen(
                                    state = state,
                                    copy = copy,
                                    onSettingsChange = viewModel::updateRuntimeSettings,
                                    onToggleApp = viewModel::toggleSplitApp,
                                    onLoadApps = { viewModel.loadInstalledApps(context) },
                                )
                                Screen.Settings -> SettingsScreen(
                                    state = state,
                                    copy = copy,
                                    onSettingsChange = viewModel::updateRuntimeSettings,
                                    onCopyHwid = { viewModel.copyHwid(context) },
                                    onCheckUpdate = { viewModel.checkForUpdate(silent = false) },
                                    onDownloadUpdate = { viewModel.downloadUpdate(context) },
                                    onInstallUpdate = { viewModel.installDownloadedUpdate(context) },
                                    onOpenInstallPermission = { viewModel.openInstallPermissionSettings(context) },
                                    onOpenAndroidVpnSettings = {
                                        context.startActivity(Intent(android.provider.Settings.ACTION_VPN_SETTINGS))
                                    }
                                )
                                Screen.Logs -> LogsScreen(
                                    state = state,
                                    copy = copy,
                                    onCopy = { viewModel.copyDiagnostics(context) },
                                    onNetworkCheck = viewModel::runNetworkCheck
                                )
                            }
                        }
                    }
                }
            }
            val details = state.detailsServerId?.let { id -> state.servers.firstOrNull { it.id == id } }
            if (details != null) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.74f))
                        .padding(18.dp),
                    contentAlignment = Alignment.Center
                ) {
                    ServerDetailsScreen(
                        server = details,
                        copy = copy,
                        onClose = { viewModel.showServerDetails(null) },
                        onSelect = { viewModel.selectServer(details.id) },
                        onDuplicate = { viewModel.duplicateServer(details.id) },
                        onDelete = { viewModel.deleteServer(details.id) },
                        onExport = { viewModel.exportServer(context, details.id) },
                    )
                }
            }
            if (showQrScanner) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.74f))
                        .padding(18.dp),
                    contentAlignment = Alignment.Center
                ) {
                    QrImportSheet(
                        copy = copy,
                        onResult = {
                            showQrScanner = false
                            pendingImportFlow.value = PendingImportPayload(
                                source = "qr",
                                content = it,
                                name = "QR import",
                                origin = "QR code",
                            )
                        },
                        onError = {
                            showQrScanner = false
                            viewModel.setMessage(it)
                        },
                        onClose = { showQrScanner = false },
                    )
                }
            }
            if (pendingImport != null) {
                ConfirmImportDialog(
                    copy = copy,
                    pending = pendingImport!!,
                    onConfirm = {
                        pendingImportFlow.value = null
                        viewModel.importText(it.source, it.content, it.name)
                    },
                    onDismiss = {
                        pendingImportFlow.value = null
                        viewModel.setMessage(copy.importCancelled)
                    },
                )
            }
        }
    }

@Composable
private fun LumenDrawer(
    state: UiState,
    copy: LumenCopy,
    current: Screen,
    onSelect: (Screen) -> Unit,
) {
    ModalDrawerSheet(
        drawerContainerColor = LumenColors.Bg1,
        drawerContentColor = LumenColors.Text,
        modifier = Modifier.width(304.dp)
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BrandMark()
                Column {
                    Text("LUMEN", color = LumenColors.Text, fontSize = 22.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace)
                    Text(state.user?.email ?: state.user?.username ?: copy.localMode, color = LumenColors.TextDim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.height(8.dp))
            DrawerItem(Screen.Home, copy.home, Icons.Outlined.PowerSettingsNew, current, onSelect)
            DrawerItem(Screen.Servers, copy.servers, Icons.Outlined.VpnKey, current, onSelect)
            DrawerItem(Screen.Add, copy.addSubscription, Icons.Outlined.Link, current, onSelect)
            DrawerItem(Screen.Subscriptions, copy.subscriptions, Icons.Outlined.Storage, current, onSelect)
            DrawerItem(Screen.Routing, copy.routing, Icons.Outlined.Route, current, onSelect)
            DrawerItem(Screen.Settings, copy.settings, Icons.Outlined.Settings, current, onSelect)
            DrawerItem(Screen.Logs, copy.diagnostics, Icons.Outlined.BugReport, current, onSelect)
            Spacer(Modifier.weight(1f))
            StatPill("${state.servers.count(RuntimeSupport::isConnectable)}/${state.servers.size}", copy.readyProfiles)
        }
    }
}

@Composable
private fun ConfirmImportDialog(
    copy: LumenCopy,
    pending: PendingImportPayload,
    onConfirm: (PendingImportPayload) -> Unit,
    onDismiss: () -> Unit,
) {
    val safeSource = SecretRedactor.redact(pending.source)
    val safePreview = SecretRedactor.redact(pending.content)
        .replace('\n', ' ')
        .take(140)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LumenColors.Bg1,
        titleContentColor = LumenColors.Text,
        textContentColor = LumenColors.TextDim,
        title = {
            Text(copy.confirmImport, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Black)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${copy.sourceLabel}: ${pending.origin}", fontFamily = FontFamily.Monospace)
                Text("${copy.nameLabel}: ${SecretRedactor.redact(pending.name)}", fontFamily = FontFamily.Monospace)
                Text("${copy.fromLabel}: $safeSource", fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${copy.previewLabel}: $safePreview", fontSize = 12.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(pending) },
                colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black),
            ) {
                Text(copy.importAction.uppercase(), fontWeight = FontWeight.Black)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(copy.cancel, color = LumenColors.Accent)
            }
        },
    )
}

@Composable
private fun DrawerItem(
    screen: Screen,
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    current: Screen,
    onSelect: (Screen) -> Unit,
) {
    NavigationDrawerItem(
        label = { Text(label, fontFamily = FontFamily.Monospace, fontSize = 13.sp, fontWeight = FontWeight.Bold) },
        selected = current == screen,
        onClick = { onSelect(screen) },
        icon = { Icon(icon, contentDescription = null) },
        shape = RoundedCornerShape(8.dp),
        colors = drawerItemColors()
    )
}

@Composable
private fun drawerItemColors() = NavigationDrawerItemDefaults.colors(
    selectedContainerColor = LumenColors.AccentBg,
    unselectedContainerColor = Color.Transparent,
    selectedIconColor = LumenColors.Accent,
    unselectedIconColor = LumenColors.TextDim,
    selectedTextColor = LumenColors.Text,
    unselectedTextColor = LumenColors.TextDim,
)

@Composable
private fun Header(
    state: UiState,
    copy: LumenCopy,
    screen: Screen,
    onMenu: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .background(LumenColors.Bg0.copy(alpha = 0.94f))
            .statusBarsPadding()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.weight(1f)) {
            IconButton(onClick = onMenu) {
                Icon(Icons.Outlined.Menu, contentDescription = copy.menu, tint = LumenColors.Text)
            }
            BrandMark()
            Text("LUMEN", color = LumenColors.Text, fontSize = 21.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace)
            Text(
                screen.label(copy),
                color = LumenColors.TextDim,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(0.72f), horizontalArrangement = Arrangement.End) {
            Text(
                state.user?.email ?: state.user?.username ?: state.user?.firstName ?: copy.localMode,
                color = LumenColors.TextDim,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun BrandMark() {
    Box(
        modifier = Modifier
            .size(34.dp)
            .background(LumenColors.AccentBg, RoundedCornerShape(8.dp))
            .border(1.dp, LumenColors.AccentBorder, RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Outlined.Shield, contentDescription = null, tint = LumenColors.Accent)
    }
}

private fun Screen.label(copy: LumenCopy): String = when (this) {
    Screen.Home -> copy.home
    Screen.Servers -> copy.servers
    Screen.Add -> copy.addSubscription
    Screen.Subscriptions -> copy.subscriptions
    Screen.Routing -> copy.routing
    Screen.Settings -> copy.settings
    Screen.Logs -> copy.diagnostics
}

@Composable
private fun ProfileSyncBanner(state: UiState, copy: LumenCopy) {
    AnimatedVisibility(state.profileError.isNotBlank()) {
        LumenCard(compact = true) {
            Text(copy.accountAuthorized, color = LumenColors.Accent, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace)
            Text(
                "${copy.profileNeedsSync}: ${state.profileError}",
                color = LumenColors.Warn,
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun UpdateBanner(
    update: AppUpdateState,
    isEnglish: Boolean,
    onCheck: () -> Unit,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
    onPermission: () -> Unit,
) {
    val available = update.available
    val title = when (update.status) {
        AppUpdateStatus.Checking -> updateText(isEnglish, "Проверяю обновления", "Checking for updates")
        AppUpdateStatus.Downloading -> updateText(isEnglish, "Скачиваю обновление", "Downloading update")
        AppUpdateStatus.Downloaded -> updateText(isEnglish, "Обновление скачано", "Update downloaded")
        AppUpdateStatus.Installing -> updateText(isEnglish, "Откройте установщик", "Open the installer")
        AppUpdateStatus.Error -> updateText(isEnglish, "Ошибка обновления", "Update error")
        AppUpdateStatus.UpToDate -> updateText(isEnglish, "Установлена последняя версия", "Latest version installed")
        else -> updateText(isEnglish, "Доступна новая версия", "New version available")
    }
    val version = available?.let { " ${it.versionName} (${it.versionCode})" }
        ?: if (update.status == AppUpdateStatus.UpToDate) " ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})" else ""
    val progressText = if (update.downloadedBytes > 0) {
        "${formatBytes(update.downloadedBytes)} / ${formatBytes(update.totalBytes)}"
    } else {
        available?.sizeBytes?.takeIf { it > 0 }?.let { formatBytes(it) }.orEmpty()
    }

    LumenCard(compact = true) {
        Text(title + version, color = LumenColors.Text, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
        val note = update.error.ifBlank {
            available?.releaseNotes.orEmpty().ifBlank {
                updateText(
                    isEnglish,
                    "APK будет проверен по пакету, подписи и SHA-256 перед установкой.",
                    "APK package, signature, and SHA-256 are verified before install.",
                )
            }
        }
        Text(
            SecretRedactor.redact(note),
            color = if (update.error.isBlank()) LumenColors.TextDim else LumenColors.Warn,
            fontSize = 12.sp,
        )
        if (progressText.isNotBlank()) {
            Text(progressText, color = LumenColors.Accent, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
        }
        if (update.status == AppUpdateStatus.Downloading) {
            val progress = if (update.totalBytes > 0) {
                (update.downloadedBytes.toFloat() / update.totalBytes.toFloat()).coerceIn(0f, 1f)
            } else {
                0f
            }
            if (update.totalBytes > 0) {
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth(),
                    color = LumenColors.Accent,
                    trackColor = LumenColors.AccentBorder,
                )
            } else {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = LumenColors.Accent,
                    trackColor = LumenColors.AccentBorder,
                )
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                update.permissionRequired -> {
                    Button(onClick = onPermission, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Warn, contentColor = Color.Black), shape = RoundedCornerShape(6.dp), modifier = Modifier.weight(1f)) {
                        Text(updateText(isEnglish, "РАЗРЕШИТЬ УСТАНОВКУ", "ALLOW INSTALL").uppercase())
                    }
                }
                update.status == AppUpdateStatus.Downloaded -> {
                    Button(onClick = onInstall, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black), shape = RoundedCornerShape(6.dp), modifier = Modifier.weight(1f)) {
                        Text(updateText(isEnglish, "УСТАНОВИТЬ", "INSTALL").uppercase())
                    }
                }
                update.status == AppUpdateStatus.Available || update.status == AppUpdateStatus.Error -> {
                    Button(onClick = onDownload, enabled = available != null, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black), shape = RoundedCornerShape(6.dp), modifier = Modifier.weight(1f)) {
                        Text(updateText(isEnglish, "СКАЧАТЬ", "DOWNLOAD").uppercase())
                    }
                    Button(onClick = onCheck, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.AccentBg, contentColor = LumenColors.Accent), shape = RoundedCornerShape(6.dp), modifier = Modifier.weight(1f)) {
                        Text(updateText(isEnglish, "ПРОВЕРИТЬ", "CHECK").uppercase())
                    }
                }
                else -> {
                    Button(onClick = onCheck, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.AccentBg, contentColor = LumenColors.Accent), shape = RoundedCornerShape(6.dp), modifier = Modifier.weight(1f)) {
                        Text(updateText(isEnglish, "ПРОВЕРИТЬ", "CHECK").uppercase())
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(
    state: UiState,
    copy: LumenCopy,
    onConnect: () -> Unit,
    onDisconnect: () -> Unit,
    onAdd: () -> Unit,
    onServers: () -> Unit,
    onClipboard: () -> Unit,
    onQr: () -> Unit,
) {
    val selected = state.servers.firstOrNull { it.id == state.selectedServerId } ?: state.servers.firstOrNull()
    val connectableCount = state.servers.count(RuntimeSupport::isConnectable)
    val selectedConnectable = selected?.let(RuntimeSupport::isConnectable) == true
    val canConnect = selectedConnectable && (state.vpnStatus == VpnStatus.Stopped || state.vpnStatus == VpnStatus.Error)
    val canDisconnect = state.vpnStatus == VpnStatus.Running || state.vpnStatus == VpnStatus.Starting
    val status = connectionCopy(state.vpnStatus, copy)
    val actionEnabled = canConnect || canDisconnect
    val onPower = if (state.vpnStatus == VpnStatus.Running) onDisconnect else onConnect
    LazyColumn(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        item {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    status.hero,
                    color = status.color,
                    fontSize = 32.sp,
                    lineHeight = 34.sp,
                    fontWeight = FontWeight.Black,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(status.subtitle, color = LumenColors.TextDim, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                PrimaryPowerButton(
                    status = state.vpnStatus,
                    enabled = actionEnabled,
                    action = status.action,
                    onClick = onPower,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    HomeMetric("${state.servers.size}", copy.servers, Modifier.weight(1f))
                    HomeMetric("$connectableCount", copy.readyProfiles, Modifier.weight(1f))
                    HomeMetric(state.runtimeSettings.splitModeLabel(copy), copy.routing, Modifier.weight(1f))
                }
            }
        }

        item {
            LumenCard(compact = true) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(copy.selectedServer, color = LumenColors.TextDim, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                        Text(
                            selected?.displayName ?: copy.noServer,
                            color = LumenColors.Text,
                            fontSize = 19.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        selected?.let {
                            Text(
                                "${RuntimeSupport.label(it.protocol)} · ${it.host.ifBlank { "local config" }}:${it.port}",
                                color = LumenColors.TextDim,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    ConnectionGlyph(state.vpnStatus)
                }
                if (selected != null && !selectedConnectable) {
                    Text(RuntimeSupport.unsupportedRuntimeMessage(selected.protocol), color = LumenColors.Warn, fontSize = 12.sp)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    HomeActionButton(copy.change, onServers, Modifier.weight(1f))
                    HomeActionButton(copy.add, onAdd, Modifier.weight(1f))
                }
            }
        }

        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                HomeActionButton(copy.clipboard, onClipboard, Modifier.weight(1f))
                HomeActionButton("QR", onQr, Modifier.weight(1f))
            }
        }

        item {
            selected?.let { ServerRow(server = it, selected = true, onClick = {}) }
            Message(SecretRedactor.redact(state.message.ifBlank { state.lastError }))
        }
    }
}

@Composable
private fun PrimaryPowerButton(
    status: VpnStatus,
    enabled: Boolean,
    action: String,
    onClick: () -> Unit,
) {
    val accent = when (status) {
        VpnStatus.Running -> LumenColors.Success
        VpnStatus.Starting,
        VpnStatus.Stopping -> LumenColors.Warn
        VpnStatus.Error -> LumenColors.Error
        VpnStatus.Stopped -> LumenColors.Accent
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            modifier = Modifier
                .size(184.dp)
                .background(accent.copy(alpha = if (enabled) 0.13f else 0.05f), CircleShape)
                .border(1.dp, accent.copy(alpha = if (enabled) 0.62f else 0.22f), CircleShape)
                .clickable(enabled = enabled, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier
                    .size(126.dp)
                    .background(LumenColors.Bg1, CircleShape)
                    .border(1.dp, accent.copy(alpha = if (enabled) 0.76f else 0.24f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Outlined.PowerSettingsNew,
                    contentDescription = action,
                    tint = if (enabled) accent else LumenColors.TextMute,
                    modifier = Modifier.size(54.dp),
                )
            }
        }
        Text(
            action,
            color = if (enabled) accent else LumenColors.TextMute,
            fontSize = 16.sp,
            fontWeight = FontWeight.Black,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun HomeMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .background(LumenColors.Bg1, RoundedCornerShape(12.dp))
            .border(1.dp, LumenColors.Border, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 11.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(value, color = LumenColors.Text, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(label, color = LumenColors.TextDim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun HomeActionButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Bg1, contentColor = LumenColors.Text),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.height(56.dp),
    ) {
        Text(label, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun AddSubscriptionScreen(
    copy: LumenCopy,
    busy: Boolean,
    message: String,
    onImport: (String, String) -> Unit,
    onClipboard: () -> Unit,
    onFile: () -> Unit,
    onQr: () -> Unit,
) {
    var text by remember { mutableStateOf("") }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            LumenCard {
                Text(copy.addSubscription, color = LumenColors.Text, fontSize = 24.sp, fontWeight = FontWeight.Black)
                Text(copy.importHelp, color = LumenColors.TextDim, fontSize = 13.sp, lineHeight = 18.sp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    HomeActionButton(copy.clipboard, onClipboard, Modifier.weight(1f))
                    HomeActionButton(copy.file, onFile, Modifier.weight(1f))
                    HomeActionButton("QR", onQr, Modifier.weight(1f))
                }
            }
        }

        item {
            LumenCard {
                Text(copy.subscriptionConfig, color = LumenColors.Text, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(
                    copy.importHelp,
                    color = LumenColors.TextDim,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                )
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(220.dp),
                    label = { Text(copy.subscriptionConfig) },
                    minLines = 8,
                )
                Button(
                    onClick = { onImport("manual", text) },
                    enabled = !busy && text.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(56.dp),
                ) {
                    Icon(Icons.Outlined.Link, null)
                    Spacer(Modifier.width(8.dp))
                    Text(copy.importAction, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Message(message)
            }
        }
    }
}

@Composable
private fun QrImportSheet(
    copy: LumenCopy,
    onResult: (String) -> Unit,
    onError: (String) -> Unit,
    onClose: () -> Unit,
) {
    var progress by remember { mutableStateOf("") }
    LumenCard {
        LumenSectionTitle("QR", copy.qrHelp)
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, LumenColors.AccentBorder, RoundedCornerShape(16.dp))
                .background(LumenColors.Bg0, RoundedCornerShape(16.dp))
                .padding(10.dp),
        ) {
            QrScanner(
                onResult = onResult,
                onError = onError,
                onProgress = { progress = it },
            )
            Box(
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(188.dp)
                    .border(2.dp, LumenColors.Accent.copy(alpha = 0.8f), RoundedCornerShape(22.dp))
            )
        }
        Text(
            progress.ifBlank { copy.qrWaiting },
            color = if (progress.isBlank()) LumenColors.TextDim else LumenColors.Accent,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            LumenSecondaryButton(copy.close, onClose, Modifier.weight(1f))
        }
    }
}

@OptIn(ExperimentalGetImage::class)
@SuppressLint("UnsafeOptInUsageError")
@Composable
private fun QrScanner(onResult: (String) -> Unit, onError: (String) -> Unit, onProgress: (String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }
    val amneziaChunks = remember { AmneziaQrChunkAccumulator() }
    var handled by remember { mutableStateOf(false) }
    var progressText by remember { mutableStateOf("") }

    DisposableEffect(Unit) {
        onDispose {
            executor.shutdown()
            scanner.close()
        }
    }

    AndroidView(
        modifier = Modifier
            .fillMaxWidth()
            .height(360.dp),
        factory = { ctx ->
            PreviewView(ctx).also { previewView ->
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val cameraProvider = runCatching { cameraProviderFuture.get() }
                        .getOrElse {
                            onError("Камера недоступна: ${it.message ?: "unknown error"}")
                            return@addListener
                        }
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { proxy ->
                        val mediaImage = proxy.image
                        if (mediaImage == null || handled) {
                            proxy.close()
                            return@setAnalyzer
                        }
                        val image = InputImage.fromMediaImage(mediaImage, proxy.imageInfo.rotationDegrees)
                        scanner.process(image)
                            .addOnSuccessListener { barcodes ->
                                val value = barcodes.firstOrNull()?.rawValue
                                if (!value.isNullOrBlank() && !handled) {
                                    val chunk = AmneziaQrCodec.parseChunk(value)
                                    if (chunk != null) {
                                        val completePayload = amneziaChunks.accept(chunk)
                                        progressText = "Amnezia QR: ${amneziaChunks.received}/${amneziaChunks.expectedTotal}"
                                        onProgress(progressText)
                                        if (completePayload != null) {
                                            val decoded = AmneziaQrCodec.decodeQrPayloadToText(completePayload)
                                            if (decoded == null) {
                                                handled = true
                                                onError("Не удалось декодировать полный Amnezia QR")
                                            } else {
                                                handled = true
                                                onResult(decoded)
                                            }
                                        }
                                    } else {
                                        handled = true
                                        onResult(value)
                                    }
                                }
                            }
                            .addOnCompleteListener { proxy.close() }
                    }
                    runCatching {
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            analysis
                        )
                    }.onFailure {
                        onError("Не удалось открыть камеру: ${it.message ?: "unknown error"}")
                    }
                }, ContextCompat.getMainExecutor(context))
            }
        }
    )
}

@Composable
private fun SubscriptionsScreen(
    state: UiState,
    copy: LumenCopy,
    onRefresh: (String) -> Unit,
    onDelete: (String) -> Unit,
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            LumenCard {
                LumenSectionTitle(copy.subscriptions, copy.noSubscriptionsHelp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    HomeMetric("${state.subscriptions.size}", copy.subscriptions, Modifier.weight(1f))
                    HomeMetric("${state.servers.size}", copy.servers, Modifier.weight(1f))
                }
            }
        }
        if (state.subscriptions.isEmpty()) {
            item {
                LumenCard {
                    LumenSectionTitle(copy.noSubscriptions, copy.noSubscriptionsHelp)
                }
            }
        }
        items(state.subscriptions, key = { it.id }) { subscription ->
            val count = state.servers.count { it.subscriptionId == subscription.id }
            LumenCard(compact = true) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(subscription.name, color = LumenColors.Text, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("$count ${copy.serversLower} · ${SubscriptionSourceLabel.safeLabel(subscription.source)}", color = LumenColors.TextDim, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        TextButton(onClick = { onRefresh(subscription.id) }) { Text(copy.refresh.uppercase(), color = LumenColors.Accent, fontSize = 11.sp) }
                        TextButton(onClick = { onDelete(subscription.id) }) { Text(copy.delete.uppercase(), color = LumenColors.Warn, fontSize = 11.sp) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ServersScreen(
    copy: LumenCopy,
    servers: List<ServerProfile>,
    selectedId: String?,
    latencies: Map<String, Long>,
    checkingLatencies: Set<String>,
    latencyRunning: Boolean,
    latencyCompleted: Int,
    latencyTotal: Int,
    onSelect: (String) -> Unit,
    onDetails: (String) -> Unit,
    onPing: () -> Unit,
    onPingServer: (String) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("all") }
    val sortedServers = remember(servers, latencies) {
        servers.sortedWith(compareBy<ServerProfile> { latencySortValue(latencies[it.id]) }.thenBy { it.displayName.lowercase() })
    }
    val visibleServers = remember(sortedServers, query, filter, selectedId) {
        val q = query.trim()
        sortedServers.filter { server ->
            val byFilter = when (filter) {
                "ready" -> RuntimeSupport.isConnectable(server)
                "active" -> server.id == selectedId
                "core" -> !RuntimeSupport.isConnectable(server)
                else -> true
            }
            val byQuery = q.isBlank() ||
                server.displayName.contains(q, ignoreCase = true) ||
                server.host.contains(q, ignoreCase = true) ||
                server.protocolStackLabel().contains(q, ignoreCase = true)
            byFilter && byQuery
        }
    }
    val readyCount = remember(servers) { servers.count(RuntimeSupport::isConnectable) }
    val selectedServer = remember(servers, selectedId) { servers.firstOrNull { it.id == selectedId } }
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            LumenCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(copy.servers, color = LumenColors.Text, fontSize = 24.sp, fontWeight = FontWeight.Black)
                        Text(
                            "${servers.size} ${copy.serversLower} · $readyCount ${copy.ready.lowercase()}",
                            color = LumenColors.TextDim,
                            fontSize = 13.sp,
                        )
                    }
                    Button(
                        onClick = onPing,
                        enabled = !latencyRunning && servers.isNotEmpty(),
                        colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(
                            if (latencyRunning && latencyTotal > 0) "$latencyCompleted/$latencyTotal" else copy.pingSort,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                selectedServer?.let {
                    Text("${copy.active}: ${it.displayName}", color = LumenColors.Accent, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                LumenTextField(query, { query = it }, copy.search)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Segment(copy.all, filter == "all", Modifier.weight(1f)) { filter = "all" }
                    Segment(copy.ready, filter == "ready", Modifier.weight(1f)) { filter = "ready" }
                    Segment(copy.active, filter == "active", Modifier.weight(1f)) { filter = "active" }
                    Segment(copy.core, filter == "core", Modifier.weight(1f)) { filter = "core" }
                }
            }
        }
        if (servers.isEmpty()) {
            item {
                LumenCard {
                    Text(copy.noServers.uppercase(), color = LumenColors.Text, fontSize = 18.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace)
                    Text(copy.noServersHelp, color = LumenColors.TextDim, fontSize = 12.sp)
                }
            }
        }
        items(visibleServers, key = { it.id }) { server ->
            ServerRow(
                server = server,
                selected = server.id == selectedId,
                latency = latencies[server.id],
                checkingLatency = server.id in checkingLatencies,
                onClick = { onSelect(server.id) },
                onDetails = { onDetails(server.id) },
                onPing = { onPingServer(server.id) },
            )
        }
    }
}

@Composable
private fun ServerRow(
    server: ServerProfile,
    selected: Boolean,
    latency: Long? = null,
    checkingLatency: Boolean = false,
    onClick: () -> Unit,
    onDetails: (() -> Unit)? = null,
    onPing: (() -> Unit)? = null,
) {
    val connectable = RuntimeSupport.isConnectable(server)
    val issue = remember(server) { RuntimeSupport.validationIssue(server) }
    val statusLabel = when {
        selected -> "Выбран"
        connectable -> "Готов"
        else -> "Runtime"
    }
    val statusColor = when {
        selected -> LumenColors.Accent
        connectable -> LumenColors.Success
        else -> LumenColors.Warn
    }
    LumenCard(
        modifier = Modifier
            .border(
                width = if (selected) 1.dp else 0.dp,
                color = if (selected) LumenColors.Accent else Color.Transparent,
                shape = RoundedCornerShape(8.dp),
            )
            .clickable(onClick = onClick),
        compact = true,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .background(statusColor.copy(alpha = 0.14f), CircleShape)
                    .border(1.dp, statusColor.copy(alpha = 0.5f), CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Shield, null, tint = statusColor, modifier = Modifier.size(22.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
                    Text(server.displayName, color = LumenColors.Text, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(statusLabel, color = statusColor, fontWeight = FontWeight.Bold, fontSize = 12.sp, maxLines = 1)
                }
                Text("${server.protocolStackLabel()} · ${server.host.ifBlank { "local config" }}:${server.port}", color = LumenColors.TextDim, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (checkingLatency) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(12.dp),
                            color = LumenColors.Accent,
                            strokeWidth = 2.dp,
                        )
                        Text("Проверяем задержку", color = LumenColors.TextDim, fontSize = 11.sp)
                    }
                } else if (latency != null) {
                    Text(latencyLabel(latency), color = if (latency > 0) LumenColors.Accent else LumenColors.Warn, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
                if (!connectable && !issue.isNullOrBlank()) {
                    Text(issue, color = LumenColors.Warn, fontSize = 12.sp, lineHeight = 16.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (onPing != null) {
                        TextButton(onClick = onPing, enabled = !checkingLatency) {
                            Text("Ping", color = if (checkingLatency) LumenColors.TextMute else LumenColors.Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    if (onDetails != null) {
                        TextButton(onClick = onDetails) {
                            Text("Детали", color = LumenColors.Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(
    state: UiState,
    copy: LumenCopy,
    onSettingsChange: (tel.lumentech.vpn.data.RuntimeSettings) -> Unit,
    onCopyHwid: () -> Unit,
    onCheckUpdate: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onOpenInstallPermission: () -> Unit,
    onOpenAndroidVpnSettings: () -> Unit,
) {
    val settings = state.runtimeSettings
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            LumenCard {
                LumenSectionTitle(copy.settings, copy.settingsHelp)
                Text(copy.language, color = LumenColors.TextDim, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Segment("RU", settings.language == "ru", Modifier.weight(1f)) { onSettingsChange(settings.copy(language = "ru")) }
                    Segment("EN", settings.language == "en", Modifier.weight(1f)) { onSettingsChange(settings.copy(language = "en")) }
                }
                ToggleLine(
                    title = copy.bypassLan,
                    body = copy.bypassLanBody,
                    checked = settings.bypassPrivateNetworks,
                    onChange = { onSettingsChange(settings.copy(bypassPrivateNetworks = it)) }
                )
                ToggleLine(
                    title = copy.strictRoute,
                    body = copy.strictRouteBody,
                    checked = settings.strictRoute,
                    onChange = { onSettingsChange(settings.copy(strictRoute = it)) }
                )
                ToggleLine(
                    title = copy.sniffTraffic,
                    body = copy.sniffTrafficBody,
                    checked = settings.sniff,
                    onChange = { onSettingsChange(settings.copy(sniff = it)) }
                )
                ToggleLine(
                    title = copy.ipv6Tun,
                    body = copy.ipv6TunBody,
                    checked = settings.ipv6,
                    onChange = { onSettingsChange(settings.copy(ipv6 = it)) }
                )
            }
        }

        item {
            LumenCard {
                LumenSectionTitle("DNS")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Segment("1.1.1.1", settings.dnsMode == "cloudflare", Modifier.weight(1f)) { onSettingsChange(settings.copy(dnsMode = "cloudflare")) }
                    Segment("8.8.8.8", settings.dnsMode == "google", Modifier.weight(1f)) { onSettingsChange(settings.copy(dnsMode = "google")) }
                    Segment("9.9.9.9", settings.dnsMode == "quad9", Modifier.weight(1f)) { onSettingsChange(settings.copy(dnsMode = "quad9")) }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Segment("System", settings.dnsMode == "system", Modifier.weight(1f)) { onSettingsChange(settings.copy(dnsMode = "system")) }
                    Segment("Custom", settings.dnsMode == "custom", Modifier.weight(1f)) { onSettingsChange(settings.copy(dnsMode = "custom")) }
                }
                AnimatedVisibility(settings.dnsMode == "custom") {
                    OutlinedTextField(
                        value = settings.customDns,
                        onValueChange = { onSettingsChange(settings.copy(customDns = it)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text(copy.customDns) }
                    )
                }
            }
        }

        item {
            LumenCard {
                LumenSectionTitle(copy.subscriptionDevice, copy.hwidHelp)
                Text(state.hwid.ifBlank { copy.loading }, color = LumenColors.Accent, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                LumenPrimaryButton(copy.copyHwid, onCopyHwid, Modifier.fillMaxWidth())
            }
        }

        item {
            LumenCard {
                LumenSectionTitle(copy.system)
                SettingLine(copy.alwaysOnVpn, copy.alwaysOnBody)
                SettingLine(copy.killSwitch, copy.killSwitchBody)
                LumenSecondaryButton(copy.openAndroidVpnSettings, onOpenAndroidVpnSettings, Modifier.fillMaxWidth())
                SettingLine(copy.protocols, copy.protocolsBody)
            }
        }

        item {
            UpdateBanner(
                update = state.updateState.copy(
                    status = if (state.updateState.status == AppUpdateStatus.Idle) AppUpdateStatus.UpToDate else state.updateState.status,
                ),
                isEnglish = settings.language == "en",
                onCheck = onCheckUpdate,
                onDownload = onDownloadUpdate,
                onInstall = onInstallUpdate,
                onPermission = onOpenInstallPermission,
            )
        }
    }
}

@Composable
private fun RoutingScreen(
    state: UiState,
    copy: LumenCopy,
    onSettingsChange: (tel.lumentech.vpn.data.RuntimeSettings) -> Unit,
    onToggleApp: (String, Boolean) -> Unit,
    onLoadApps: () -> Unit,
) {
    val settings = state.runtimeSettings
    var appFilter by remember { mutableStateOf("") }
    var manualPackage by remember { mutableStateOf("") }
    var showSystem by remember { mutableStateOf(false) }
    val visibleApps = remember(state.installedApps, appFilter, showSystem) {
        val query = appFilter.trim()
        state.installedApps
            .asSequence()
            .filter { showSystem || !it.packageName.looksSystemPackage() }
            .filter {
                query.isBlank() ||
                    it.label.contains(query, ignoreCase = true) ||
                    it.packageName.contains(query, ignoreCase = true)
            }
            .toList()
    }

    LaunchedEffect(Unit) { onLoadApps() }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            LumenCard {
                LumenSectionTitle(copy.routing, copy.routingHelp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Segment(copy.allViaVpn, settings.splitMode == "off", Modifier.weight(1f)) {
                        onSettingsChange(settings.copy(splitMode = "off"))
                    }
                    Segment(copy.excludeSelected, settings.splitMode == "exclude", Modifier.weight(1f)) {
                        onSettingsChange(settings.copy(splitMode = "exclude"))
                    }
                    Segment(copy.onlySelected, settings.splitMode == "include", Modifier.weight(1f)) {
                        onSettingsChange(settings.copy(splitMode = "include"))
                    }
                }
                Text(settings.splitModeDescription(copy), color = LumenColors.TextDim, fontSize = 12.sp)
                Text(copy.appliesAfterReconnect, color = LumenColors.Warn, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }

        item {
            LumenCard {
                LumenSectionTitle(copy.apps)
                OutlinedTextField(
                    value = appFilter,
                    onValueChange = { appFilter = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    label = { Text(copy.searchApp) }
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Switch(checked = showSystem, onCheckedChange = { showSystem = it })
                    Text(copy.showSystemApps, color = LumenColors.TextDim, fontSize = 12.sp, modifier = Modifier.weight(1f))
                    Text("${copy.selected}: ${settings.splitApps.size}", color = LumenColors.Accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = manualPackage,
                        onValueChange = { manualPackage = it.trim() },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        label = { Text(copy.manualPackage) }
                    )
                    Button(
                        onClick = {
                            if (manualPackage.isNotBlank()) {
                                onToggleApp(manualPackage, true)
                                manualPackage = ""
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black),
                        shape = RoundedCornerShape(14.dp)
                    ) { Text(copy.add, fontWeight = FontWeight.Bold) }
                }
                if (visibleApps.isEmpty()) {
                    Text(copy.noAppsFound, color = LumenColors.Warn, fontSize = 12.sp)
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(360.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        items(visibleApps, key = { it.packageName }) { app ->
                            SplitAppRow(
                                app = app,
                                checked = app.packageName in settings.splitApps,
                                onToggle = { onToggleApp(app.packageName, it) }
                            )
                        }
                    }
                }
            }
        }

        item {
            LumenCard {
                LumenSectionTitle(copy.routingRules, copy.routingRulesHelp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Segment(copy.proxyFinal, settings.finalOutbound == "proxy", Modifier.weight(1f)) { onSettingsChange(settings.copy(finalOutbound = "proxy")) }
                    Segment(copy.directFinal, settings.finalOutbound == "direct", Modifier.weight(1f)) { onSettingsChange(settings.copy(finalOutbound = "direct")) }
                    Segment(copy.blockFinal, settings.finalOutbound == "block", Modifier.weight(1f)) { onSettingsChange(settings.copy(finalOutbound = "block")) }
                }
                LinesEditor(copy.directDomains, settings.directDomains) { onSettingsChange(settings.copy(directDomains = it)) }
                LinesEditor(copy.proxyDomains, settings.proxyDomains) { onSettingsChange(settings.copy(proxyDomains = it)) }
                LinesEditor(copy.blockDomains, settings.blockDomains) { onSettingsChange(settings.copy(blockDomains = it)) }
                LinesEditor(copy.directIps, settings.directIps) { onSettingsChange(settings.copy(directIps = it)) }
                LinesEditor(copy.proxyIps, settings.proxyIps) { onSettingsChange(settings.copy(proxyIps = it)) }
                LinesEditor(copy.blockIps, settings.blockIps) { onSettingsChange(settings.copy(blockIps = it)) }
                LinesEditor(copy.ruleSetUrls, settings.ruleSetUrls) { onSettingsChange(settings.copy(ruleSetUrls = it)) }
            }
        }
    }
}

@Composable
private fun LogsScreen(state: UiState, copy: LumenCopy, onCopy: () -> Unit, onNetworkCheck: () -> Unit) {
    val selected = state.servers.firstOrNull { it.id == state.selectedServerId } ?: state.servers.firstOrNull()
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            LumenCard {
                LumenSectionTitle(copy.diagnostics)
                DetailLine("Mode", "local")
                DetailLine("Servers", "${state.servers.size}")
                DetailLine("HWID", "<redacted>")
                DetailLine("Selected", selected?.displayName ?: "none")
                DetailLine("Protocol", selected?.protocol?.label() ?: "none")
                DetailLine("Connectable", "${selected?.let(RuntimeSupport::isConnectable) ?: false}")
                DetailLine("Status", "${state.vpnStatus}")
                DetailLine("Error", SecretRedactor.redact(state.lastError).ifBlank { "none" })
                DetailLine("Network", SecretRedactor.redact(state.networkCheck.ifBlank { copy.notChecked }))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    LumenPrimaryButton(copy.copy, onCopy, Modifier.weight(1f))
                    LumenSecondaryButton(copy.check, onNetworkCheck, Modifier.weight(1f))
                }
            }
        }

        item {
            LumenCard(compact = true) {
                Text(copy.coreEvents, color = LumenColors.Accent, fontWeight = FontWeight.Bold)
                if (state.coreEvents.isEmpty()) {
                    Text(copy.notChecked, color = LumenColors.TextDim, fontSize = 12.sp)
                } else {
                    state.coreEvents.takeLast(20).forEach {
                        Text(SecretRedactor.redact(it), color = LumenColors.TextDim, fontSize = 11.sp, fontFamily = FontFamily.Monospace, lineHeight = 15.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun LumenCard(modifier: Modifier = Modifier, compact: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .background(LumenColors.Bg1, RoundedCornerShape(8.dp))
            .border(1.dp, LumenColors.AccentBorder, RoundedCornerShape(8.dp))
            .padding(if (compact) 12.dp else 18.dp),
        verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 12.dp),
        content = content
    )
}

@Composable
private fun LumenSectionTitle(title: String, body: String? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(title, color = LumenColors.Text, fontSize = 24.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (!body.isNullOrBlank()) {
            Text(body, color = LumenColors.TextDim, fontSize = 13.sp, lineHeight = 18.sp)
        }
    }
}

@Composable
private fun LumenPrimaryButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.height(56.dp),
    ) {
        Text(label, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun LumenSecondaryButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, danger: Boolean = false) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(
            containerColor = if (danger) LumenColors.Warn else LumenColors.AccentBg,
            contentColor = if (danger) Color.Black else LumenColors.Accent,
        ),
        shape = RoundedCornerShape(14.dp),
        modifier = modifier.height(56.dp),
    ) {
        Text(label, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun LumenTextField(value: String, onChange: (String) -> Unit, label: String, password: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = LumenColors.TextDim, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            visualTransformation = if (password) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None
        )
    }
}

@Composable
private fun Segment(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .background(if (selected) LumenColors.Accent else LumenColors.AccentBg, RoundedCornerShape(6.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text,
            color = if (selected) Color.Black else LumenColors.Text,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SettingLine(title: String, body: String) {
    Column {
        Text(title, color = LumenColors.Text, fontWeight = FontWeight.Bold)
        Text(body, color = LumenColors.TextDim, fontSize = 12.sp)
    }
}

@Composable
private fun LinesEditor(label: String, values: List<String>, onChange: (List<String>) -> Unit) {
    OutlinedTextField(
        value = values.joinToString("\n"),
        onValueChange = { text ->
            onChange(text.lines().map { it.trim() }.filter { it.isNotBlank() }.distinct())
        },
        modifier = Modifier
            .fillMaxWidth()
            .height(118.dp),
        label = { Text(label) },
        minLines = 3
    )
}

@Composable
private fun ServerDetailsScreen(
    server: ServerProfile,
    copy: LumenCopy,
    onClose: () -> Unit,
    onSelect: () -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
    onExport: () -> Unit,
) {
    LumenCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(server.displayName, color = LumenColors.Text, fontSize = 24.sp, fontWeight = FontWeight.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text("${server.protocol.label()} · ${server.host}:${server.port}", color = LumenColors.TextDim, fontSize = 12.sp)
            }
            TextButton(onClick = onClose) { Text(copy.close, color = LumenColors.Accent, fontWeight = FontWeight.Bold) }
        }
        DetailLine("Protocol", server.protocolStackLabel())
        DetailLine("Transport", server.transport.ifBlank { "default" })
        DetailLine("Security", server.security.ifBlank { "default" })
        DetailLine("SNI", server.sni.ifBlank { "none" })
        DetailLine("Path", server.path.ifBlank { "none" })
        DetailLine("Service", server.serviceName.ifBlank { "none" })
        DetailLine("Runtime", RuntimeSupport.validationIssue(server) ?: "connectable")
        Text(copy.rawConfig, color = LumenColors.Accent, fontWeight = FontWeight.Bold)
        Text(
            SecretRedactor.redact(server.rawUri.ifBlank { server.extraJson }).take(1800),
            color = LumenColors.TextDim,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
            lineHeight = 16.sp,
            maxLines = 8,
            overflow = TextOverflow.Ellipsis
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onSelect, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Accent, contentColor = Color.Black), shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f).height(56.dp)) { Text(copy.select, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            Button(onClick = onExport, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.AccentBg, contentColor = LumenColors.Accent), shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f).height(56.dp)) { Text(copy.export, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onDuplicate, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.AccentBg, contentColor = LumenColors.Accent), shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f).height(56.dp)) { Text(copy.duplicate, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            Button(onClick = onDelete, colors = ButtonDefaults.buttonColors(containerColor = LumenColors.Warn, contentColor = Color.Black), shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f).height(56.dp)) { Text(copy.delete, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
private fun DetailLine(title: String, body: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(title, color = LumenColors.TextDim, fontSize = 12.sp)
        Text(body, color = LumenColors.Text, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun ToggleLine(title: String, body: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Column(Modifier.weight(1f)) {
            Text(title, color = LumenColors.Text, fontWeight = FontWeight.Bold)
            Text(body, color = LumenColors.TextDim, fontSize = 12.sp)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun SplitAppRow(app: InstalledApp, checked: Boolean, onToggle: (Boolean) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable { onToggle(!checked) }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Checkbox(checked = checked, onCheckedChange = onToggle)
        Column(Modifier.weight(1f)) {
            Text(app.label, color = LumenColors.Text, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(app.packageName, color = LumenColors.TextDim, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ConnectionGlyph(status: VpnStatus) {
    val color = when (status) {
        VpnStatus.Running -> LumenColors.Success
        VpnStatus.Starting, VpnStatus.Stopping -> LumenColors.Warn
        VpnStatus.Error -> LumenColors.Error
        VpnStatus.Stopped -> LumenColors.TextMute
    }
    Box(
        Modifier
            .size(58.dp)
            .border(1.dp, color.copy(alpha = 0.5f), RoundedCornerShape(14.dp))
            .background(color.copy(alpha = 0.08f), RoundedCornerShape(14.dp)),
        contentAlignment = Alignment.Center
    ) {
        Icon(Icons.Outlined.PowerSettingsNew, contentDescription = null, tint = color, modifier = Modifier.size(30.dp))
    }
}

@Composable
private fun StatPill(value: String, label: String) {
    Column(
        modifier = Modifier
            .border(1.dp, LumenColors.Border, RoundedCornerShape(8.dp))
            .background(LumenColors.Bg2, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(value, color = LumenColors.Text, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 13.sp, maxLines = 1)
        Text(label.uppercase(), color = LumenColors.TextDim, fontFamily = FontFamily.Monospace, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun LumenDivider() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(LumenColors.Border)
    )
}

@Composable
private fun Message(message: String) {
    AnimatedVisibility(message.isNotBlank()) {
        Text(message, color = LumenColors.Warn, fontSize = 12.sp)
    }
}

@Composable
private fun DotGrid() {
    Canvas(Modifier.fillMaxSize().background(LumenColors.Bg0)) {
        drawDots()
    }
}

private fun DrawScope.drawDots() {
    val step = 18.dp.toPx()
    var y = 0f
    while (y < size.height) {
        var x = 0f
        while (x < size.width) {
            drawCircle(LumenColors.Dot, radius = 1.1.dp.toPx(), center = Offset(x, y))
            x += step
        }
        y += step
    }
}

private fun ProtocolType.label(): String = RuntimeSupport.label(this)

private fun ServerProfile.protocolStackLabel(): String =
    listOfNotNull(
        protocolStackProtocol(),
        protocolStackTransport(),
        protocolStackSecurity(),
        protocolStackFormat(),
    ).joinToString(" / ")

private fun ServerProfile.protocolStackProtocol(): String = when (protocol) {
    ProtocolType.SHADOWSOCKS -> "SHADOWSOCKS"
    ProtocolType.HTTP_PROXY -> "HTTP PROXY"
    ProtocolType.AMNEZIA_WG -> "AMNEZIAWG"
    ProtocolType.OPENVPN_CLOAK -> "OPENVPN+CLOAK"
    ProtocolType.OPENVPN_SHADOWSOCKS -> "OPENVPN+SS"
    ProtocolType.SING_BOX -> "SING-BOX"
    else -> RuntimeSupport.label(protocol).uppercase()
}

private fun ServerProfile.protocolStackTransport(): String? = when (protocol) {
    ProtocolType.VLESS,
    ProtocolType.VMESS,
    ProtocolType.TROJAN,
    ProtocolType.XRAY -> transport.ifBlank { "tcp" }.normalizedTransportLabel()
    ProtocolType.SHADOWSOCKS,
    ProtocolType.SOCKS,
    ProtocolType.HTTP_PROXY -> transport.ifBlank { "tcp" }.normalizedTransportLabel()
    ProtocolType.HYSTERIA -> "HYSTERIA"
    ProtocolType.HYSTERIA2 -> "HYSTERIA2"
    ProtocolType.TUIC -> "TUIC"
    ProtocolType.NAIVE -> "HTTPS"
    ProtocolType.WIREGUARD,
    ProtocolType.AMNEZIA_WG -> "UDP"
    ProtocolType.OPENVPN,
    ProtocolType.OPENVPN_CLOAK,
    ProtocolType.OPENVPN_SHADOWSOCKS -> "OPENVPN"
    ProtocolType.IPSEC -> "IKEV2"
    else -> null
}

private fun ServerProfile.protocolStackSecurity(): String? {
    val normalized = security.lowercase()
    return when {
        normalized == "reality" || publicKey.isNotBlank() -> "REALITY"
        normalized == "tls" ||
            sni.isNotBlank() ||
            protocol in setOf(
                ProtocolType.TROJAN,
                ProtocolType.HYSTERIA,
                ProtocolType.HYSTERIA2,
                ProtocolType.TUIC,
                ProtocolType.NAIVE,
            ) -> "TLS"
        normalized.isBlank() || normalized == "none" -> null
        else -> normalized.uppercase()
    }
}

private fun ServerProfile.protocolStackFormat(): String = when (protocol) {
    ProtocolType.WIREGUARD,
    ProtocolType.AMNEZIA_WG -> "CONF"
    ProtocolType.OPENVPN -> "OVPN"
    ProtocolType.OPENVPN_CLOAK -> "OVPN+CLOAK"
    ProtocolType.OPENVPN_SHADOWSOCKS -> "OVPN+SS"
    ProtocolType.IPSEC -> "PROFILE"
    else -> "JSON"
}

private fun String.normalizedTransportLabel(): String = when (lowercase()) {
    "", "raw" -> "TCP"
    "ws", "websocket" -> "WS"
    "grpc" -> "GRPC"
    "h2", "http" -> "HTTP"
    "httpupgrade", "http_upgrade" -> "HTTPUPGRADE"
    "xhttp", "splithttp", "split-http" -> "XHTTP"
    else -> uppercase()
}

private fun latencySortValue(value: Long?): Long = when {
    value == null -> Long.MAX_VALUE - 1
    value <= 0 -> Long.MAX_VALUE
    else -> value
}

private fun latencyLabel(value: Long): String =
    if (value > 0) "${value} ms" else "N/A"

private data class ConnectionText(
    val hero: String,
    val subtitle: String,
    val action: String,
    val color: Color,
)

private fun connectionCopy(status: VpnStatus, copy: LumenCopy): ConnectionText = when (status) {
    VpnStatus.Stopped -> ConnectionText(copy.off, copy.unprotected, copy.connect, LumenColors.Text)
    VpnStatus.Starting -> ConnectionText(copy.connecting, copy.handshakeInProgress, copy.cancel, LumenColors.Warn)
    VpnStatus.Running -> ConnectionText(copy.connected, copy.protectedState, copy.disconnect, LumenColors.Success)
    VpnStatus.Stopping -> ConnectionText(copy.disconnecting, copy.teardownInProgress, copy.cancel, LumenColors.Warn)
    VpnStatus.Error -> ConnectionText(copy.error, copy.connectionFailed, copy.connect, LumenColors.Error)
}

private fun tel.lumentech.vpn.data.RuntimeSettings.splitModeLabel(copy: LumenCopy): String = when (splitMode) {
    "include" -> copy.onlySelectedShort
    "exclude" -> copy.excludeShort
    else -> copy.allShort
}

private fun tel.lumentech.vpn.data.RuntimeSettings.splitModeDescription(copy: LumenCopy): String = when (splitMode) {
    "include" -> copy.onlySelectedDescription
    "exclude" -> copy.excludeSelectedDescription
    else -> copy.allViaVpnDescription
}

private fun String.looksSystemPackage(): Boolean =
    startsWith("android") ||
        startsWith("com.android.") ||
        startsWith("com.google.android.") ||
        startsWith("com.qualcomm.") ||
        startsWith("com.mediatek.") ||
        startsWith("com.samsung.android.") ||
        startsWith("com.miui.")

private fun AppUpdateState.isUserVisible(): Boolean =
    status == AppUpdateStatus.Available ||
        status == AppUpdateStatus.Downloading ||
        status == AppUpdateStatus.Downloaded ||
        status == AppUpdateStatus.Installing ||
        status == AppUpdateStatus.Error ||
        permissionRequired

private fun updateText(isEnglish: Boolean, ru: String, en: String): String = if (isEnglish) en else ru

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0L) return "unknown"
    val mib = bytes / (1024.0 * 1024.0)
    return if (mib >= 1.0) {
        "%.1f MB".format(java.util.Locale.US, mib)
    } else {
        "%.0f KB".format(java.util.Locale.US, bytes / 1024.0)
    }
}

private data class LumenCopy(
    val menu: String,
    val account: String,
    val localMode: String,
    val home: String,
    val servers: String,
    val serversLower: String,
    val addSubscription: String,
    val subscriptions: String,
    val routing: String,
    val settings: String,
    val diagnostics: String,
    val readyProfiles: String,
    val accountAuthorized: String,
    val profileNeedsSync: String,
    val status: String,
    val off: String,
    val connecting: String,
    val connected: String,
    val disconnecting: String,
    val error: String,
    val unprotected: String,
    val protectedState: String,
    val handshakeInProgress: String,
    val teardownInProgress: String,
    val connectionFailed: String,
    val connect: String,
    val disconnect: String,
    val cancel: String,
    val selectedServer: String,
    val noServer: String,
    val change: String,
    val add: String,
    val importHelp: String,
    val subscriptionConfig: String,
    val importAction: String,
    val confirmImport: String,
    val sourceLabel: String,
    val nameLabel: String,
    val fromLabel: String,
    val previewLabel: String,
    val importCancelled: String,
    val clipboard: String,
    val file: String,
    val qrHelp: String,
    val qrWaiting: String,
    val cameraPermissionRequired: String,
    val close: String,
    val noSubscriptions: String,
    val noSubscriptionsHelp: String,
    val refresh: String,
    val delete: String,
    val pingSort: String,
    val search: String,
    val all: String,
    val ready: String,
    val active: String,
    val core: String,
    val noServers: String,
    val noServersHelp: String,
    val settingsHelp: String,
    val language: String,
    val bypassLan: String,
    val bypassLanBody: String,
    val strictRoute: String,
    val strictRouteBody: String,
    val sniffTraffic: String,
    val sniffTrafficBody: String,
    val ipv6Tun: String,
    val ipv6TunBody: String,
    val customDns: String,
    val subscriptionDevice: String,
    val hwidHelp: String,
    val loading: String,
    val copyHwid: String,
    val system: String,
    val alwaysOnVpn: String,
    val alwaysOnBody: String,
    val killSwitch: String,
    val killSwitchBody: String,
    val openAndroidVpnSettings: String,
    val protocols: String,
    val protocolsBody: String,
    val routingHelp: String,
    val allViaVpn: String,
    val excludeSelected: String,
    val onlySelected: String,
    val allShort: String,
    val excludeShort: String,
    val onlySelectedShort: String,
    val allViaVpnDescription: String,
    val excludeSelectedDescription: String,
    val onlySelectedDescription: String,
    val appliesAfterReconnect: String,
    val apps: String,
    val searchApp: String,
    val showSystemApps: String,
    val selected: String,
    val manualPackage: String,
    val noAppsFound: String,
    val routingRules: String,
    val routingRulesHelp: String,
    val proxyFinal: String,
    val directFinal: String,
    val blockFinal: String,
    val directDomains: String,
    val proxyDomains: String,
    val blockDomains: String,
    val directIps: String,
    val proxyIps: String,
    val blockIps: String,
    val ruleSetUrls: String,
    val notSynced: String,
    val notChecked: String,
    val copy: String,
    val check: String,
    val coreEvents: String,
    val rawConfig: String,
    val select: String,
    val export: String,
    val duplicate: String,
) {
    companion object {
        fun forLanguage(language: String): LumenCopy =
            if (language == "en") en else ru

        private val ru = LumenCopy(
            localMode = "Локальный режим",
            menu = "Меню",
            account = "Аккаунт",
            home = "Главная",
            servers = "Серверы",
            serversLower = "серверов",
            addSubscription = "Добавить",
            subscriptions = "Подписки",
            routing = "Маршрутизация",
            settings = "Настройки",
            diagnostics = "Диагностика",
            readyProfiles = "готовы",
            accountAuthorized = "АККАУНТ АВТОРИЗОВАН",
            profileNeedsSync = "Профиль кабинета нужно синхронизировать с API",
            status = "СТАТУС",
            off = "ВЫКЛЮЧЕНО",
            connecting = "ПОДКЛЮЧАЮСЬ",
            connected = "ПОДКЛЮЧЕНО",
            disconnecting = "ОТКЛЮЧАЮСЬ",
            error = "ОШИБКА",
            unprotected = "Трафик идет напрямую",
            protectedState = "VPN защищает соединение",
            handshakeInProgress = "Поднимаю туннель и проверяю core",
            teardownInProgress = "Останавливаю VPN runtime",
            connectionFailed = "Проверьте профиль или диагностику",
            connect = "ПОДКЛЮЧИТЬ",
            disconnect = "ОТКЛЮЧИТЬ",
            cancel = "ОТМЕНА",
            selectedServer = "ВЫБРАННЫЙ СЕРВЕР",
            noServer = "Нет сервера",
            change = "Сменить",
            add = "Добавить",
            importHelp = "URL, QR, vpn://, Happ/Hiddify, Clash/V2Ray/sing-box, WireGuard/AmneziaWG",
            subscriptionConfig = "Подписка / конфиг",
            importAction = "Импорт",
            confirmImport = "Подтвердите импорт",
            sourceLabel = "Источник",
            nameLabel = "Название",
            fromLabel = "Откуда",
            previewLabel = "Предпросмотр",
            importCancelled = "Импорт отменен",
            clipboard = "Буфер",
            file = "Файл",
            qrHelp = "Наведите камеру на QR с подпиской, raw link или deeplink",
            qrWaiting = "Наведите QR в рамку. Для Amnezia multi-QR прогресс появится автоматически.",
            cameraPermissionRequired = "Разрешите камеру, чтобы сканировать QR подписки",
            close = "Закрыть",
            noSubscriptions = "Подписок нет",
            noSubscriptionsHelp = "Добавьте URL, QR, Happ/Hiddify, Amnezia vpn:// или файл конфигурации.",
            refresh = "Обновить",
            delete = "Удалить",
            pingSort = "Ping / сортировка",
            search = "Поиск",
            all = "Все",
            ready = "Готовые",
            active = "Активный",
            core = "Core",
            noServers = "Серверов нет",
            noServersHelp = "Добавьте подписку через URL, QR, буфер обмена или файл.",
            settingsHelp = "Глобальные параметры VPN. Правила и split tunneling вынесены в Маршрутизацию.",
            language = "ЯЗЫК",
            bypassLan = "LAN напрямую",
            bypassLanBody = "Локальные сети 10/8, 172.16/12, 192.168/16, link-local и multicast идут напрямую.",
            strictRoute = "Strict route",
            strictRouteBody = "Жестче удерживает маршруты внутри TUN. Включать, если есть DNS/IP leaks.",
            sniffTraffic = "Sniff traffic",
            sniffTrafficBody = "Позволяет core определять домены/SNI для правил и совместимости профилей.",
            ipv6Tun = "IPv6 TUN",
            ipv6TunBody = "Добавляет IPv6 адрес в TUN. Если оператор ломает IPv6, оставьте выключенным.",
            customDns = "DNS адрес, DoH URL или local",
            subscriptionDevice = "Устройство подписки",
            hwidHelp = "HWID для Happ/XRay подписок с привязкой устройства",
            loading = "загрузка",
            copyHwid = "Скопировать HWID",
            system = "Система",
            alwaysOnVpn = "Always-on VPN",
            alwaysOnBody = "Включается в системных настройках Android для Lumen VPN.",
            killSwitch = "Kill switch",
            killSwitchBody = "Используйте Android lockdown mode вместе с always-on.",
            openAndroidVpnSettings = "Открыть настройки VPN Android",
            protocols = "Протоколы",
            protocolsBody = "Подключение: Xray-compatible, WireGuard/AmneziaWG, sing-box/Hiddify и native OpenVPN/Cloak где доступно.",
            routingHelp = "Приложения, домены, IP/CIDR и rule-set списки. Android разрешает либо include, либо exclude apps, но не оба режима одновременно.",
            allViaVpn = "Все через VPN",
            excludeSelected = "Исключить",
            onlySelected = "Только выбранные",
            allShort = "all",
            excludeShort = "exclude",
            onlySelectedShort = "only",
            allViaVpnDescription = "VPN работает для всех приложений; сам Lumen исключается, чтобы не зациклить туннель.",
            excludeSelectedDescription = "VPN работает для всех приложений, отмеченные идут напрямую.",
            onlySelectedDescription = "VPN работает только для отмеченных приложений.",
            appliesAfterReconnect = "Применится после переподключения",
            apps = "Приложения",
            searchApp = "Поиск приложения или package",
            showSystemApps = "Показывать системные приложения",
            selected = "Выбрано",
            manualPackage = "Package вручную",
            noAppsFound = "Приложения не найдены",
            routingRules = "Правила",
            routingRulesHelp = "Домены/IP по одному на строку. Порядок: block, direct, proxy, LAN bypass, final outbound.",
            proxyFinal = "Proxy final",
            directFinal = "Direct final",
            blockFinal = "Block final",
            directDomains = "Direct domains",
            proxyDomains = "Proxy domains",
            blockDomains = "Block domains",
            directIps = "Direct IP/CIDR",
            proxyIps = "Proxy IP/CIDR",
            blockIps = "Block IP/CIDR",
            ruleSetUrls = "Remote rule-set URLs",
            notSynced = "не синхронизирован",
            notChecked = "не проверено",
            copy = "Копировать",
            check = "Проверить",
            coreEvents = "События core",
            rawConfig = "Raw config",
            select = "Выбрать",
            export = "Экспорт",
            duplicate = "Дублировать",
        )

        private val en = ru.copy(
            account = "Account",
            localMode = "Local mode",
            home = "Home",
            servers = "Servers",
            serversLower = "servers",
            addSubscription = "Add",
            subscriptions = "Subscriptions",
            routing = "Routing",
            settings = "Settings",
            diagnostics = "Diagnostics",
            readyProfiles = "ready",
            accountAuthorized = "ACCOUNT AUTHENTICATED",
            profileNeedsSync = "Cabinet profile needs API sync",
            status = "STATUS",
            off = "OFF",
            connecting = "CONNECTING",
            connected = "CONNECTED",
            disconnecting = "DISCONNECTING",
            error = "ERROR",
            unprotected = "Traffic is going direct",
            protectedState = "VPN is protecting the connection",
            handshakeInProgress = "Starting tunnel and checking core",
            teardownInProgress = "Stopping VPN runtime",
            connectionFailed = "Check profile or diagnostics",
            connect = "CONNECT",
            disconnect = "DISCONNECT",
            cancel = "CANCEL",
            selectedServer = "SELECTED SERVER",
            noServer = "No server",
            change = "Change",
            add = "Add",
            subscriptionConfig = "Subscription / config",
            importAction = "Import",
            confirmImport = "Confirm import",
            sourceLabel = "Source",
            nameLabel = "Name",
            fromLabel = "From",
            previewLabel = "Preview",
            importCancelled = "Import cancelled",
            clipboard = "Clipboard",
            file = "File",
            qrHelp = "Point camera at a subscription QR, raw link, or deeplink",
            qrWaiting = "Place QR inside the frame. Amnezia multi-QR progress appears automatically.",
            cameraPermissionRequired = "Allow camera access to scan subscription QR codes",
            close = "Close",
            noSubscriptions = "No subscriptions",
            noSubscriptionsHelp = "Add URL, QR, Happ/Hiddify, Amnezia vpn://, or config file.",
            refresh = "Refresh",
            delete = "Delete",
            pingSort = "Ping / sort",
            search = "Search",
            all = "All",
            ready = "Ready",
            active = "Active",
            noServers = "No servers",
            noServersHelp = "Add a subscription from URL, QR, clipboard, or file.",
            settingsHelp = "Global VPN parameters. Rules and split tunneling moved to Routing.",
            language = "LANGUAGE",
            bypassLan = "Bypass LAN/private",
            bypassLanBody = "Private networks 10/8, 172.16/12, 192.168/16, link-local and multicast go direct.",
            strictRouteBody = "Keeps routes inside TUN more aggressively. Enable if DNS/IP leaks appear.",
            sniffTraffic = "Sniff traffic",
            sniffTrafficBody = "Lets the core detect domains/SNI for rules and profile compatibility.",
            ipv6TunBody = "Adds IPv6 to TUN. Keep disabled if the carrier breaks IPv6.",
            customDns = "DNS address, DoH URL or local",
            subscriptionDevice = "Subscription device",
            hwidHelp = "HWID for Happ/XRay subscriptions bound to this device",
            loading = "loading",
            copyHwid = "Copy HWID",
            system = "System",
            alwaysOnBody = "Enabled in Android system settings for Lumen VPN.",
            killSwitchBody = "Use Android lockdown mode together with always-on.",
            openAndroidVpnSettings = "Open Android VPN settings",
            protocolsBody = "Connection: Xray-compatible, WireGuard/AmneziaWG, sing-box/Hiddify and native OpenVPN/Cloak where available.",
            routingHelp = "Apps, domains, IP/CIDR and rule-set lists. Android allows either include or exclude apps, not both at once.",
            allViaVpn = "All via VPN",
            excludeSelected = "Exclude",
            onlySelected = "Only selected",
            allViaVpnDescription = "VPN works for all apps; Lumen itself is excluded to avoid a tunnel loop.",
            excludeSelectedDescription = "VPN works for all apps, selected apps go direct.",
            onlySelectedDescription = "VPN works only for selected apps.",
            appliesAfterReconnect = "Applies after reconnect",
            apps = "Apps",
            searchApp = "Search app or package",
            showSystemApps = "Show system apps",
            selected = "Selected",
            manualPackage = "Manual package",
            noAppsFound = "No apps found",
            routingRules = "Rules",
            routingRulesHelp = "Domains/IP one per line. Order: block, direct, proxy, LAN bypass, final outbound.",
            notSynced = "not synced",
            notChecked = "not checked",
            copy = "Copy",
            check = "Check",
            coreEvents = "Core events",
            rawConfig = "Raw config",
            select = "Select",
            export = "Export",
            duplicate = "Duplicate",
        )
    }
}

private object LumenColors {
    val Bg0 = Color(0xFF020504)
    val Bg1 = Color(0xFF06110F)
    val Bg2 = Color(0xFF0B1714)
    val Text = Color(0xFFD9FFF7)
    val TextDim = Color(0x73D9FFF7)
    val TextMute = Color(0x38D9FFF7)
    val Accent = Color(0xFF41F0DB)
    val AccentBg = Color(0x1441F0DB)
    val AccentBorder = Color(0x3841F0DB)
    val Border = Color(0x263CEADD)
    val Dot = Color(0x2041F0DB)
    val Warn = Color(0xFFF0A541)
    val Success = Color(0xFF63D98A)
    val Error = Color(0xFFFF6B6B)
}
