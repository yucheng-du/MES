package com.mesnext.hardware

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.mesnext.hardware.bridge.BridgeRequest
import com.mesnext.hardware.bridge.NativeAction
import com.mesnext.hardware.bridge.SecureWebView
import com.mesnext.hardware.printing.PrinterState
import com.mesnext.hardware.printing.LabelSize
import com.mesnext.hardware.security.TrustedOrigin
import java.util.UUID
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import com.mesnext.hardware.bridge.LabelData
import com.mesnext.hardware.updates.AppUpdate

class MainActivity : AppCompatActivity() {
    private val uploads = NativeUploads(this)
    private val downloads = NativeDownloads(this)
    private val updateWorker = Executors.newSingleThreadExecutor()
    private var checkingUpdate = false
    private val preferences by lazy { getSharedPreferences("mes-hardware", MODE_PRIVATE) }
    private val printer by lazy { (application as MesApplication).printer }
    private val chromeLabels = mutableListOf<Pair<TextView, Int>>()
    private lateinit var root: LinearLayout
    private lateinit var status: TextView
    private lateinit var printerStatus: TextView
    private var web: WebView? = null
    private var shell: SecureWebView? = null
    private var origin: TrustedOrigin? = null
    private var dialog: AlertDialog? = null
    private var pending: Pending? = null
    private var afterPermission: (() -> Unit)? = null
    private var afterEnableBluetooth: (() -> Unit)? = null
    private val handledRequests = LinkedHashSet<String>()
    private val printerObserver: (PrinterState) -> Unit = { if (!isDestroyed && ::printerStatus.isInitialized) printerStatus.text = it.message }

    private data class Pending(val request: BridgeRequest, val reply: (String?, String?) -> Unit)

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        val next = afterPermission
        afterPermission = null
        if (granted.values.all { it }) next?.invoke()
        else {
            finishNative(error = s(R.string.permission_denied))
            showPermissionRecovery()
        }
    }
    private val bluetoothLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val next = afterEnableBluetooth
        afterEnableBluetooth = null
        if (result.resultCode == RESULT_OK) next?.invoke() else finishNative(error = s(R.string.bluetooth_off))
    }
    private val scanner = registerForActivityResult(ScanContract()) { result ->
        if (pending?.request?.action != NativeAction.scan) return@registerForActivityResult
        val value = result.contents
        if (value.isNullOrBlank()) finishNative(error = s(R.string.scan_cancelled))
        else if (value.length > 2048) finishNative(error = s(R.string.qr_too_long))
        else finishNative(value = value)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        origin = preferences.getString("origin", null)?.let { runCatching { TrustedOrigin.parse(it) }.getOrNull() }
        if (origin == null) showSetup() else showWorkplace()
        printer.observe(printerObserver)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (shell?.goBack() != true) finish()
            }
        })
    }

    private fun newRoot(): LinearLayout {
        chromeLabels.clear()
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(246, 248, 247))
        }
        setContentView(layout)
        ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(layout)
        root = layout
        return layout
    }

    private fun showSetup(typedOrigin: String? = null) {
        shell?.dispose(); shell = null; web = null
        val layout = newRoot()
        val scroll = ScrollView(this)
        val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(48), dp(24), dp(24)) }
        form.addView(text(s(R.string.app_name), 16f, Color.rgb(18, 102, 91)))
        form.addView(text(s(R.string.setup_title), 28f).apply { setPadding(0, dp(16), 0, dp(12)) })
        form.addView(text(s(R.string.setup_description), 16f))
        val field = EditText(this).apply {
            hint = s(R.string.origin_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
            setText(typedOrigin ?: origin?.value.orEmpty())
            setPadding(dp(8), dp(16), dp(8), dp(16))
        }
        form.addView(field, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })
        form.addView(button(s(R.string.connect_site)) {
            val selected = runCatching { TrustedOrigin.parse(field.text.toString()) }.getOrElse {
                field.error = s(R.string.invalid_origin)
                return@button
            }
            val changed = origin?.value != selected.value
            origin = selected
            preferences.edit().putString("origin", selected.value).apply()
            if (changed) {
                WebStorage.getInstance().deleteAllData()
                CookieManager.getInstance().removeAllCookies {
                    CookieManager.getInstance().flush()
                    if (!isDestroyed) showWorkplace()
                }
            } else showWorkplace()
        }, LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(16) })
        if (origin != null) form.addView(button(s(R.string.back_workplace)) { showWorkplace() })
        form.addView(button(s(R.string.switch_language)) {
            setLanguage(if (LocaleStrings.locale(this) == "zh-CN") "en-US" else "zh-CN")
            showSetup(field.text.toString())
        })
        form.addView(text(s(if (printer.available) R.string.printer_help else R.string.vendor_sdk_required), 14f).apply { setPadding(0, dp(32), 0, 0) })
        scroll.addView(form)
        layout.addView(scroll, LinearLayout.LayoutParams(-1, -1))
    }

    private fun showWorkplace() {
        val current = origin ?: return showSetup()
        shell?.dispose()
        val layout = newRoot()
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), 0, dp(8), 0) }
        bar.addView(text(s(R.string.app_name), 17f, Color.rgb(18, 102, 91)).also { chromeLabels.add(it to R.string.app_name) }, LinearLayout.LayoutParams(0, dp(52), 1f))
        bar.addView(button(s(R.string.printer)) { localPrinterRequest() }.also { chromeLabels.add(it to R.string.printer) })
        bar.addView(button(s(R.string.refresh)) { if (shell?.reload() != true) showWorkplace() }.also { chromeLabels.add(it to R.string.refresh) })
        bar.addView(button(s(R.string.settings)) { showSettings() }.also { chromeLabels.add(it to R.string.settings) })
        layout.addView(bar)
        status = text(s(R.string.connecting_site), 12f).apply { setPadding(dp(12), dp(4), dp(12), dp(4)) }
        layout.addView(status)
        printerStatus = text(printer.state.message, 12f).apply { setPadding(dp(12), 0, dp(12), dp(5)) }
        layout.addView(printerStatus)
        val content = WebView(this)
        web = content
        layout.addView(content, LinearLayout.LayoutParams(-1, 0, 1f))
        shell = SecureWebView(content, current, ::handleNative, { message, error ->
            if (!isDestroyed) {
                status.text = message
                status.setTextColor(if (error) Color.rgb(158, 50, 38) else Color.rgb(75, 89, 83))
            }
        }, { external ->
            AlertDialog.Builder(this).setTitle(s(R.string.external_open_title))
                .setMessage(external.host ?: s(R.string.external_site))
                .setPositiveButton(s(R.string.open)) { _, _ -> safelyLaunch(Intent(Intent.ACTION_VIEW, external)) }
                .setNegativeButton(s(R.string.cancel), null).show()
        }, uploads::choose).also { it.start() }
    }

    private fun showSettings() {
        if (pending != null) { toast(s(R.string.finish_current)); return }
        val items = arrayOf(s(R.string.change_site), s(R.string.bluetooth_settings), s(R.string.permission_settings), s(R.string.disconnect_printer), s(R.string.label_size, labelSize().label), s(R.string.switch_language), s(R.string.test_label), s(R.string.check_update, packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()))
        dialog = AlertDialog.Builder(this).setTitle(origin?.value ?: s(R.string.settings)).setItems(items) { _, index ->
            when (index) {
                6 -> handleNative(BridgeRequest("native-${UUID.randomUUID()}", NativeAction.printLabel, LabelData("MES-TEST", "MES", 1, s(R.string.test_label)))) { _, error -> toast(error ?: s(R.string.test_label_done)) }
                7 -> checkForUpdates()
                5 -> setLanguage(if (LocaleStrings.locale(this) == "zh-CN") "en-US" else "zh-CN")
                0 -> AlertDialog.Builder(this).setTitle(s(R.string.change_site))
                    .setMessage(s(R.string.change_site_description))
                    .setPositiveButton(s(R.string.continue_action)) { _, _ -> showSetup() }.setNegativeButton(s(R.string.cancel), null).show()
                1 -> safelyLaunch(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                2 -> openAppSettings()
                3 -> printer.disconnect { it?.let(::toast) }
                4 -> dialog = AlertDialog.Builder(this).setTitle(s(R.string.label_size_title))
                    .setSingleChoiceItems(LabelSize.entries.map { it.label }.toTypedArray(), labelSize().ordinal) { selection, which ->
                        preferences.edit().putString("label-size", LabelSize.entries[which].name).apply()
                        selection.dismiss()
                    }.setNegativeButton(s(R.string.cancel), null).show()
            }
        }.show()
    }

    private fun handleNative(request: BridgeRequest, reply: (String?, String?) -> Unit) {
        if (!lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) { reply(null, s(R.string.return_to_app)); return }
        if (request.action == NativeAction.setLanguage) {
            setLanguage(request.locale ?: return)
            reply(request.locale, null)
            return
        }
        if (pending != null) { reply(null, s(R.string.operation_pending)); return }
        if (!handledRequests.add(request.requestId)) { reply(null, s(R.string.request_used)); return }
        if (handledRequests.size > 128) handledRequests.remove(handledRequests.first())
        pending = Pending(request, reply)
        when (request.action) {
            NativeAction.setLanguage -> Unit
            NativeAction.scan -> withPermissions(arrayOf(Manifest.permission.CAMERA)) {
                scanner.launch(ScanOptions().setCaptureActivity(LocalizedCaptureActivity::class.java).setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt(s(R.string.scan_prompt))
                    .setBeepEnabled(false).setOrientationLocked(false))
            }
            NativeAction.configurePrinter -> requestPrinterPermissions { selectPrinter() }
            NativeAction.printLabel -> requestPrinterPermissions { confirmPrint(request) }
            NativeAction.saveFile -> downloads.save(request.file!!) { value, error -> finishNative(value, error) }
        }
    }

    private fun localPrinterRequest() {
        handleNative(BridgeRequest("native-${UUID.randomUUID()}", NativeAction.configurePrinter)) { value, error ->
            if (!isDestroyed) toast(error ?: s(R.string.printer_connected, value.orEmpty()))
        }
    }

    private fun withPermissions(required: Array<String>, next: () -> Unit) {
        val missing = required.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) next() else { afterPermission = next; permissionLauncher.launch(missing.toTypedArray()) }
    }

    private fun requestPrinterPermissions(next: () -> Unit) {
        if (!printer.available) { finishNative(error = s(R.string.vendor_sdk_required)); return }
        val required = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN) else emptyArray()
        withPermissions(required, next)
    }

    @SuppressLint("MissingPermission")
    private fun selectPrinter() {
        val adapter = getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null) { finishNative(error = s(R.string.no_bluetooth)); return }
        try {
            if (!adapter.isEnabled) {
                afterEnableBluetooth = { selectPrinter() }
                bluetoothLauncher.launch(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE))
                return
            }
            val devices = adapter.bondedDevices.sortedBy { it.name ?: it.address }
            if (devices.isEmpty()) {
                finishNative(error = s(R.string.no_paired_printer))
                dialog = AlertDialog.Builder(this).setTitle(s(R.string.pair_first))
                    .setMessage(s(R.string.pair_description))
                    .setPositiveButton(s(R.string.bluetooth_settings_short)) { _, _ -> safelyLaunch(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
                    .setNegativeButton(s(R.string.later), null).show()
                return
            }
            val preferred = preferences.getString("printer-address", null)
            var selected = devices.indexOfFirst { it.address == preferred }.coerceAtLeast(0)
            dialog = AlertDialog.Builder(this).setTitle(s(R.string.select_printer))
                .setSingleChoiceItems(devices.map { "${it.name ?: s(R.string.bluetooth_device)}\n${it.address}" }.toTypedArray(), selected) { _, which -> selected = which }
                .setPositiveButton(s(R.string.connect)) { _, _ ->
                    val device = devices[selected]
                    val name = device.name ?: s(R.string.label_printer)
                    printer.connect(device.address, name) { error ->
                        if (error == null) preferences.edit().putString("printer-address", device.address).apply()
                        finishNative(value = if (error == null) name else null, error = error)
                    }
                }
                .setNeutralButton(s(R.string.pair_new)) { _, _ ->
                    finishNative(error = s(R.string.pair_then_select))
                    safelyLaunch(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                }
                .setNegativeButton(s(R.string.cancel)) { _, _ -> finishNative(error = s(R.string.printer_select_cancelled)) }
                .setOnCancelListener { finishNative(error = s(R.string.printer_select_cancelled)) }
                .show()
        } catch (_: SecurityException) {
            finishNative(error = s(R.string.bluetooth_permission_missing))
            showPermissionRecovery()
        }
    }

    private fun confirmPrint(request: BridgeRequest) {
        val label = request.label ?: run { finishNative(error = s(R.string.invalid_label)); return }
        val media = labelSize()
        if (printer.state.phase != PrinterState.Phase.READY) {
            finishNative(error = s(R.string.connect_before_print))
            return
        }
        dialog = AlertDialog.Builder(this).setTitle(s(R.string.print_one))
            .setMessage(s(R.string.print_confirmation, label.productName, label.code, label.quantity) +
                (label.processName?.let { s(R.string.print_process, it) } ?: "") + "\n\n${printer.state.deviceName} · ${media.label}")
            .setPositiveButton(s(R.string.print)) { _, _ ->
                printer.print(label, media) { error -> finishNative(value = if (error == null) "printed" else null, error = error) }
            }
            .setNegativeButton(s(R.string.cancel)) { _, _ -> finishNative(error = s(R.string.print_cancelled)) }
            .setOnCancelListener { finishNative(error = s(R.string.print_cancelled)) }.show()
    }

    private fun finishNative(value: String? = null, error: String? = null) {
        if (isDestroyed) { pending = null; return }
        val operation = pending ?: return
        pending = null
        afterPermission = null
        afterEnableBluetooth = null
        operation.reply(value, error)
    }

    private fun showPermissionRecovery() {
        if (isDestroyed) return
        dialog = AlertDialog.Builder(this).setTitle(s(R.string.permission_recovery))
            .setMessage(s(R.string.permission_description))
            .setPositiveButton(s(R.string.open_app_settings)) { _, _ -> openAppSettings() }
            .setNegativeButton(s(R.string.later), null).show()
    }

    private fun openAppSettings() = safelyLaunch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
    private fun labelSize(): LabelSize = runCatching {
        LabelSize.valueOf(preferences.getString("label-size", LabelSize.COMPACT.name)!!)
    }.getOrDefault(LabelSize.COMPACT)
    private fun safelyLaunch(intent: Intent) {
        runCatching { startActivity(intent) }.onFailure { toast(s(R.string.system_action_unavailable)) }
    }
    private fun text(value: String, size: Float, color: Int = Color.rgb(32, 47, 43)) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color); gravity = Gravity.CENTER_VERTICAL
    }
    private fun button(label: String, action: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 13f; minWidth = 0; minimumWidth = 0
        setPadding(dp(10), 0, dp(10), 0); setOnClickListener { action() }
    }
    private fun toast(message: String) { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    private fun setLanguage(locale: String) {
        if (LocaleStrings.locale(this) == locale) return
        LocaleStrings.set(this, locale)
        chromeLabels.forEach { (view, resource) -> view.text = s(resource) }
        printer.refreshLocale()
        if (::printerStatus.isInitialized) printerStatus.text = printer.state.message
        shell?.syncLanguage()
    }
    private fun checkForUpdates() {
        val current = origin ?: return
        if (checkingUpdate) return
        checkingUpdate = true
        toast(s(R.string.checking_update))
        updateWorker.execute {
            val result = runCatching {
                val connection = URL(current.value + "/api/android/latest").openConnection() as HttpURLConnection
                try {
                    connection.instanceFollowRedirects = false
                    connection.connectTimeout = 10_000
                    connection.readTimeout = 10_000
                    require(connection.responseCode == 200)
                    val bytes = connection.inputStream.use { input ->
                        val output = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(4096)
                        while (output.size() <= 16384) {
                            val count = input.read(buffer, 0, minOf(buffer.size, 16385 - output.size()))
                            if (count < 0) break
                            output.write(buffer, 0, count)
                        }
                        output.toByteArray()
                    }
                    require(bytes.size <= 16384)
                    AppUpdate.parse(bytes.toString(Charsets.UTF_8))
                } finally { connection.disconnect() }
            }
            runOnUiThread {
                checkingUpdate = false
                if (isDestroyed || isFinishing || origin?.value != current.value) return@runOnUiThread
                val update = result.getOrElse { toast(s(R.string.update_failed)); return@runOnUiThread }
                val info = packageManager.getPackageInfo(packageName, 0)
                val installed = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
                if (update == null || update.versionCode <= installed) toast(s(R.string.update_current)) else {
                    dialog = AlertDialog.Builder(this).setTitle(s(R.string.update_available, update.versionName))
                        .setMessage(update.remark + "\n\n" + Uri.parse(update.downloadUrl).host.orEmpty())
                        .setPositiveButton(s(R.string.open_download)) { _, _ -> safelyLaunch(Intent(Intent.ACTION_VIEW, Uri.parse(update.downloadUrl))) }
                        .setNegativeButton(s(R.string.later), null).show()
                }
            }
        }
    }
    private fun s(id: Int, vararg args: Any) = LocaleStrings.get(this, id, *args)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        uploads.dispose()
        downloads.dispose()
        updateWorker.shutdownNow()
        printer.removeObserver(printerObserver)
        dialog?.dismiss()
        pending = null
        afterPermission = null
        afterEnableBluetooth = null
        shell?.dispose()
        shell = null
        web = null
        super.onDestroy()
    }
}
