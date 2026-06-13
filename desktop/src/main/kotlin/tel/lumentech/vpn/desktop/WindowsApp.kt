package tel.lumentech.vpn.desktop

import java.awt.BorderLayout
import java.awt.Desktop
import java.awt.Dimension
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import java.awt.Toolkit
import java.awt.datatransfer.StringSelection
import java.io.File
import java.net.InetSocketAddress
import java.net.Socket
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComboBox
import javax.swing.JFileChooser
import javax.swing.JFrame
import javax.swing.JLabel
import javax.swing.JList
import javax.swing.JOptionPane
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JSplitPane
import javax.swing.JTextArea
import javax.swing.JTextField
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities
import javax.swing.DefaultListCellRenderer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import tel.lumentech.vpn.auth.AuthRepository
import tel.lumentech.vpn.auth.SecureTokenStore
import tel.lumentech.vpn.data.RuntimeSettings
import tel.lumentech.vpn.model.ServerProfile
import tel.lumentech.vpn.runtime.RuntimeSupport
import tel.lumentech.vpn.security.SecretRedactor

fun main() {
    SwingUtilities.invokeLater {
        WindowsFrame().isVisible = true
    }
}

private class WindowsFrame : JFrame("Lumen VPN Windows") {
    private val scope = CoroutineScope(Dispatchers.Default)
    private val store = DesktopStore()
    private val auth = AuthRepository(SecureTokenStore())
    private val fallbackRuntime = DesktopRuntimeController(store)
    private val service = WindowsServiceClient()
    private val http = OkHttpClient()

    private val serverModel = DefaultListModel<ServerProfile>()
    private val serverList = JList(serverModel)
    private val sourceField = JTextField()
    private val nameField = JTextField("Windows import")
    private val runtimeField = JTextField(DesktopPaths.runtimeDir.toString())
    private val emailField = JTextField()
    private val passwordField = JTextField()
    private val finalOutbound = JComboBox(arrayOf("proxy", "direct", "block"))
    private val dnsMode = JComboBox(arrayOf("cloudflare", "google", "quad9", "system", "custom"))
    private val customDns = JTextField()
    private val strictRoute = JCheckBox("strict route")
    private val ipv6 = JCheckBox("IPv6")
    private val sniff = JCheckBox("sniff")
    private val bypassLan = JCheckBox("bypass LAN")
    private val systemProxy = JCheckBox("system proxy")
    private val textArea = JTextArea()
    private val logArea = JTextArea()

    init {
        defaultCloseOperation = EXIT_ON_CLOSE
        minimumSize = Dimension(1120, 720)
        setLocationRelativeTo(null)
        contentPane = buildContent()
        serverList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        serverList.cellRenderer = DefaultListCellRenderer().also { renderer ->
            serverList.setCellRenderer { list, value, index, selected, focus ->
                val server = value as ServerProfile
                renderer.getListCellRendererComponent(
                    list,
                    "${server.displayName}  ·  ${RuntimeSupport.label(server.protocol)}  ·  ${server.host.ifBlank { "local config" }}:${server.port}",
                    index,
                    selected,
                    focus
                )
            }
        }
        logArea.isEditable = false
        textArea.lineWrap = true
        log("HWID: ${store.hwid()}")
        log("Runtime dir: ${DesktopPaths.runtimeDir}")
        loadSettings()
        refreshLists()
    }

    private fun buildContent(): JPanel {
        val root = JPanel(BorderLayout(8, 8))
        val left = JPanel(BorderLayout(6, 6))
        left.add(JLabel("Servers"), BorderLayout.NORTH)
        left.add(JScrollPane(serverList), BorderLayout.CENTER)
        left.add(buttonsPanel(
            "Connect" to ::connect,
            "Disconnect" to ::disconnect,
            "Ping" to ::pingSelected,
            "Delete" to ::deleteSelected,
            "Duplicate" to ::duplicateSelected,
            "Copy config" to ::copySelectedConfig,
            "Export file" to ::exportSelectedConfig,
        ), BorderLayout.SOUTH)

        val right = JPanel(BorderLayout(6, 6))
        right.add(importPanel(), BorderLayout.NORTH)
        right.add(JScrollPane(textArea), BorderLayout.CENTER)
        right.add(bottomPanel(), BorderLayout.SOUTH)

        root.add(JSplitPane(JSplitPane.HORIZONTAL_SPLIT, left, right).apply { dividerLocation = 430 }, BorderLayout.CENTER)
        return root
    }

    private fun importPanel(): JPanel = formPanel().apply {
        addRow("Name", nameField)
        addRow("URL/source", sourceField)
        addRow("Runtime dir", runtimeField)
        add(buttonsPanel(
            "Import text/URL" to ::importTextOrUrl,
            "Import file" to ::importFile,
            "Import clipboard" to ::importClipboard,
            "Import QR image" to ::importQrImage,
            "Refresh URL subs" to ::refreshRemoteSubscriptions,
            "Network check" to ::networkCheck,
            "Copy diagnostics" to ::copyDiagnostics,
            "Runtime logs" to ::runtimeLogs,
        ), fullWidth())
    }

    private fun bottomPanel(): JPanel {
        val panel = JPanel(BorderLayout(6, 6))
        val authPanel = formPanel().apply {
            addRow("Email", emailField)
            addRow("Password", passwordField)
            add(buttonsPanel(
                "Login" to ::login,
                "Telegram" to ::telegramLogin,
                "Register" to ::register,
                "Forgot password" to ::forgot,
                "Logout" to { auth.logout(); log("Logged out") },
            ), fullWidth())
        }
        val settingsPanel = formPanel().apply {
            addRow("DNS", dnsMode)
            addRow("Custom DNS", customDns)
            addRow("Final", finalOutbound)
            addRow("Flags", JPanel().apply {
                listOf(strictRoute, ipv6, sniff, bypassLan, systemProxy).forEach(::add)
            })
            add(buttonsPanel("Save settings" to ::saveSettings), fullWidth())
        }
        panel.add(JSplitPane(JSplitPane.HORIZONTAL_SPLIT, authPanel, settingsPanel).apply { dividerLocation = 480 }, BorderLayout.NORTH)
        panel.add(JScrollPane(logArea).apply { preferredSize = Dimension(100, 150) }, BorderLayout.CENTER)
        return panel
    }

    private fun importTextOrUrl() = background {
        val source = sourceField.text.trim().ifBlank { "manual" }
        val content = textArea.text.trim().ifBlank { source }
        val count = store.importSubscription(source, content, nameField.text)
        ui { refreshLists(); log("Imported servers: $count") }
    }

    private fun importFile() {
        val chooser = JFileChooser()
        if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
            val file = chooser.selectedFile
            textArea.text = file.readText()
            sourceField.text = file.absolutePath
            importTextOrUrl()
        }
    }

    private fun importClipboard() {
        val data = Toolkit.getDefaultToolkit().systemClipboard.getData(java.awt.datatransfer.DataFlavor.stringFlavor) as? String
        textArea.text = data.orEmpty()
        sourceField.text = "clipboard"
        importTextOrUrl()
    }

    private fun importQrImage() {
        val chooser = JFileChooser()
        if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
            background {
                val decoded = QrImageImporter.decode(chooser.selectedFile)
                ui {
                    textArea.text = decoded
                    sourceField.text = chooser.selectedFile.absolutePath
                    log("QR decoded")
                    importTextOrUrl()
                }
            }
        }
    }

    private fun refreshRemoteSubscriptions() = background {
        var total = 0
        store.subscriptions.filter { it.source.startsWith("http", true) }.forEach { total += store.refresh(it.id) }
        ui { refreshLists(); log("Refreshed remote subscriptions, servers: $total") }
    }

    private fun connect() = background {
        val server = selectedServer() ?: return@background ui { log("Select a server first") }
        RuntimeSupport.validationIssue(server)?.let { return@background ui { log(it) } }
        saveSettings()
        var fallbackMessage = ""
        val state = runCatching {
            service.validate(server.id).takeIf { !it.ok }?.let { error(it.message) }
            service.connect(server.id, store.settings)
        }.getOrElse {
            fallbackMessage = "Service unavailable or rejected request, using UI fallback: ${it.message}"
            fallbackRuntime.start(server.id, store.settings)
        }
        ui {
            if (fallbackMessage.isNotBlank()) log(fallbackMessage)
            log("${state.message}. Run as Administrator if TUN/auto_route or Windows VPN profile changes fail.")
        }
    }

    private fun disconnect() = background {
        val state = runCatching { service.disconnect() }.getOrElse { fallbackRuntime.stop() }
        ui { log(state.message) }
    }

    private fun pingSelected() = background {
        val server = selectedServer() ?: return@background ui { log("Select a server first") }
        val latency = ping(server.host, server.port)
        ui { log("${server.displayName}: ${if (latency < 0) "failed" else "${latency}ms"}") }
    }

    private fun deleteSelected() {
        selectedServer()?.let {
            store.deleteServer(it.id)
            refreshLists()
            log("Deleted ${it.displayName}")
        }
    }

    private fun duplicateSelected() {
        selectedServer()?.let {
            val copy = store.duplicateServer(it.id)
            refreshLists()
            log("Duplicated ${copy.displayName}")
        }
    }

    private fun copySelectedConfig() {
        selectedServer()?.let {
            val text = SecretRedactor.redact(it.rawUri.ifBlank { it.extraJson })
            Toolkit.getDefaultToolkit().systemClipboard.setContents(StringSelection(text), null)
            log("Profile copied without secrets")
        }
    }

    private fun exportSelectedConfig() {
        val server = selectedServer() ?: return
        val chooser = JFileChooser()
        chooser.selectedFile = File("${server.displayName.replace(Regex("[^A-Za-z0-9._-]"), "_")}.txt")
        if (chooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
            chooser.selectedFile.writeText(SecretRedactor.redact(server.rawUri.ifBlank { server.extraJson }))
            log("Profile exported without secrets")
        }
    }

    private fun login() = background {
        val session = auth.loginEmail(emailField.text, passwordField.text)
        ui { log("Login: authenticated=${session.authenticated} user=${session.user?.email ?: session.user?.username ?: session.user?.id}") }
    }

    private fun telegramLogin() {
        runCatching {
            Desktop.getDesktop().browse(java.net.URI(auth.telegramBotUrl()))
            log("Opened Telegram login. Complete auth in browser/bot, then use email login or paste web tokens when cabinet exposes a Windows callback.")
        }.onFailure { log("Cannot open Telegram login: ${it.message}") }
    }

    private fun register() = background {
        val session = auth.registerEmail(emailField.text, passwordField.text, "Windows")
        ui { log("Register: authenticated=${session.authenticated}") }
    }

    private fun forgot() = background {
        auth.forgotPassword(emailField.text)
        ui { log("Password reset email requested") }
    }

    private fun networkCheck() = background {
        val dnsOk = runCatching {
            http.newCall(Request.Builder().url("https://cloudflare-dns.com/dns-query").header("Accept", "application/dns-json").get().build())
                .execute().use { it.isSuccessful }
        }.getOrDefault(false)
        val ip = runCatching {
            http.newCall(Request.Builder().url("https://api.ipify.org").get().build()).execute().use { it.body.string().trim() }
        }.getOrElse { it.message.orEmpty() }
        val runtimeState = runCatching { service.status().status }.getOrDefault(fallbackRuntime.status().status)
        ui { log("externalIp=$ip dnsOverHttps=$dnsOk runtime=$runtimeState") }
    }

    private fun runtimeLogs() = background {
        val logs = runCatching { service.logs() }.getOrElse { fallbackRuntime.logs() }
        ui {
            textArea.text = logs
            log("Runtime logs loaded")
        }
    }

    private fun copyDiagnostics() {
        val selected = selectedServer()
        val text = buildString {
            appendLine("servers=${store.servers.size}")
            appendLine("subscriptions=${store.subscriptions.size}")
            appendLine("hwid=${store.hwid()}")
            appendLine("runtime=${runCatching { service.status().status }.getOrDefault(fallbackRuntime.status().status)}")
            if (selected != null) {
                appendLine("selected=${SecretRedactor.redact(selected.displayName)}")
                appendLine("protocol=${RuntimeSupport.label(selected.protocol)}")
                appendLine("endpoint=${selected.host}:${selected.port}")
                appendLine("connectable=${RuntimeSupport.isWindowsConnectable(selected)}")
            }
            appendLine("runtimeDir=${runtimeField.text}")
        }
        Toolkit.getDefaultToolkit().systemClipboard.setContents(StringSelection(text), null)
        log("Diagnostics copied")
    }

    private fun refreshLists() {
        serverModel.clear()
        store.servers.forEach(serverModel::addElement)
    }

    private fun loadSettings() {
        val s = store.settings
        dnsMode.selectedItem = s.dnsMode
        finalOutbound.selectedItem = s.finalOutbound
        customDns.text = s.customDns
        strictRoute.isSelected = s.strictRoute
        ipv6.isSelected = s.ipv6
        sniff.isSelected = s.sniff
        bypassLan.isSelected = s.bypassPrivateNetworks
        systemProxy.isSelected = s.systemProxy
    }

    private fun saveSettings() {
        store.updateSettings(
            RuntimeSettings(
                dnsMode = dnsMode.selectedItem.toString(),
                customDns = customDns.text,
                finalOutbound = finalOutbound.selectedItem.toString(),
                strictRoute = strictRoute.isSelected,
                ipv6 = ipv6.isSelected,
                sniff = sniff.isSelected,
                bypassPrivateNetworks = bypassLan.isSelected,
                systemProxy = systemProxy.isSelected,
            )
        )
        log("Settings saved")
    }

    private fun selectedServer(): ServerProfile? = serverList.selectedValue

    private fun ping(host: String, port: Int): Long {
        if (host.isBlank() || port !in 1..65535) return -1
        val start = System.nanoTime()
        return runCatching {
            Socket().use { it.connect(InetSocketAddress(host, port), 3000) }
            ((System.nanoTime() - start) / 1_000_000).coerceAtLeast(1)
        }.getOrDefault(-1)
    }

    private fun background(block: suspend () -> Unit) {
        scope.launch {
            runCatching { block() }.onFailure { ui { log(SecretRedactor.redact(it.message ?: it::class.java.simpleName)) } }
        }
    }

    private fun ui(block: () -> Unit) {
        SwingUtilities.invokeLater(block)
    }

    private fun log(message: String) {
        logArea.append("${java.time.LocalTime.now().withNano(0)}  $message\n")
        logArea.caretPosition = logArea.document.length
    }

    override fun dispose() {
        fallbackRuntime.stop()
        super.dispose()
    }
}

private fun buttonsPanel(vararg actions: Pair<String, () -> Unit>): JPanel =
    JPanel().apply {
        actions.forEach { (label, action) -> add(JButton(label).apply { addActionListener { action() } }) }
    }

private fun formPanel(): JPanel =
    JPanel(GridBagLayout())

private fun JPanel.addRow(label: String, component: java.awt.Component) {
    add(JLabel(label), GridBagConstraints().apply {
        gridx = 0; gridy = componentCount; anchor = GridBagConstraints.WEST; insets = Insets(3, 3, 3, 6)
    })
    add(component, GridBagConstraints().apply {
        gridx = 1; gridy = componentCount - 1; weightx = 1.0; fill = GridBagConstraints.HORIZONTAL; insets = Insets(3, 3, 3, 3)
    })
}

private fun fullWidth(): GridBagConstraints =
    GridBagConstraints().apply {
        gridx = 0; gridwidth = 2; weightx = 1.0; fill = GridBagConstraints.HORIZONTAL; insets = Insets(3, 3, 3, 3)
    }

private fun JList<ServerProfile>.getToolTipText(event: java.awt.event.MouseEvent): String? {
    val index = locationToIndex(event.point)
    val server = if (index >= 0) model.getElementAt(index) else null
    return server?.let { "${RuntimeSupport.label(it.protocol)} ${it.host}:${it.port}" }
}
