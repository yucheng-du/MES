package com.mesnext.hardware.printing

import com.mesnext.hardware.R
import com.mesnext.hardware.LocaleStrings
import android.annotation.SuppressLint
import android.app.Application
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import com.gengcon.www.jcprintersdk.JCPrintApi
import com.gengcon.www.jcprintersdk.callback.Callback
import com.gengcon.www.jcprintersdk.callback.PrintCallback
import com.mesnext.hardware.bridge.LabelData
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Serializes the vendor's global SDK. No Bluetooth, native rendering, or print work runs on the UI thread. */
class JcPrinter(private val application: Application) {
    val available = true
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "mes-printer").apply { isDaemon = true } }
    private val timer = Executors.newSingleThreadScheduledExecutor { Thread(it, "mes-printer-timeouts").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private val listeners = CopyOnWriteArraySet<(PrinterState) -> Unit>()
    private val busy = AtomicBoolean(false)
    private var sdk: JCPrintApi? = null
    @Volatile private var jobFailure: ((String) -> Unit)? = null
    @Volatile var state = PrinterState(PrinterState.Phase.DISCONNECTED, s(R.string.printer_disconnected))
        private set

    fun observe(listener: (PrinterState) -> Unit) { listeners.add(listener); listener(state) }
    fun removeObserver(listener: (PrinterState) -> Unit) { listeners.remove(listener) }
    private fun state(phase: PrinterState.Phase, message: String, name: String? = state.deviceName) {
        state = PrinterState(phase, message, name)
        val value = state
        main.post { listeners.forEach { it(value) } }
    }
    private fun result(callback: (String?) -> Unit, error: String?) { main.post { callback(error) } }

    private fun api(): JCPrintApi {
        sdk?.let { return it }
        val created = JCPrintApi.getInstance(object : Callback {
            override fun onConnectSuccess(address: String?, type: Int) = Unit // synchronous result owns connection transition
            override fun onDisConnect() {
                jobFailure?.invoke(s(R.string.printer_lost))
                state(PrinterState.Phase.DISCONNECTED, s(R.string.printer_connection_closed))
            }
            override fun onElectricityChange(level: Int) = Unit
            override fun onCoverStatus(status: Int) { if (status == 0) jobFailure?.invoke(s(R.string.cover_open)) }
            override fun onPaperStatus(status: Int) { if (status == 1) jobFailure?.invoke(s(R.string.no_paper)) }
            override fun onRfidReadStatus(status: Int) = Unit
            override fun onRibbonStatus(status: Int) = Unit
            override fun onRibbonRfidReadStatus(status: Int) = Unit
            override fun onFirmErrors() { jobFailure?.invoke(s(R.string.firmware_error)) }
        })
        check(created.initSdk(application)) { s(R.string.sdk_init_failed) }
        sdk = created
        return created
    }

    @SuppressLint("MissingPermission") // Callers gate the Android 12 Bluetooth permissions before entry.
    fun connect(address: String, name: String, callback: (String?) -> Unit) {
        if (!busy.compareAndSet(false, true)) { result(callback, s(R.string.printer_busy)); return }
        state(PrinterState.Phase.CONNECTING, s(R.string.printer_connecting, name), name)
        val delivered = AtomicBoolean(false)
        val timeout = timer.schedule({
            if (delivered.compareAndSet(false, true)) {
                state(PrinterState.Phase.ERROR, s(R.string.connection_timeout_wait))
                result(callback, s(R.string.connection_timeout))
                // Do not unlock busy while vendor blocking connect is still alive; never overlap SDK calls.
            }
        }, 20, TimeUnit.SECONDS)
        worker.execute {
            try {
                val driver = api()
                driver.close()
                val code = driver.connectBluetoothPrinter(address)
                if (delivered.compareAndSet(false, true)) {
                    if (code == 0) {
                        state(PrinterState.Phase.READY, s(R.string.printer_connected, name), name)
                        result(callback, null)
                    } else {
                        val error = if (code == -2) s(R.string.unsupported_printer) else s(R.string.connection_failed, code)
                        state(PrinterState.Phase.ERROR, error)
                        result(callback, error)
                    }
                } else { driver.close(); state(PrinterState.Phase.DISCONNECTED, s(R.string.connection_ended)) }
            } catch (error: Throwable) {
                if (delivered.compareAndSet(false, true)) {
                    val message = s(R.string.cannot_connect, safeError(error))
                    state(PrinterState.Phase.ERROR, message)
                    result(callback, message)
                }
            } finally { timeout.cancel(false); busy.set(false) }
        }
    }

    fun print(label: LabelData, media: LabelSize, callback: (String?) -> Unit) {
        if (state.phase != PrinterState.Phase.READY) { result(callback, s(R.string.connect_printer_first)); return }
        if (!busy.compareAndSet(false, true)) { result(callback, s(R.string.previous_print_pending)); return }
        state(PrinterState.Phase.PRINTING, s(R.string.printing_label, label.code))
        val delivered = AtomicBoolean(false)
        val submitted = AtomicBoolean(false)
        var bitmap: Bitmap? = null
        var timeout: java.util.concurrent.ScheduledFuture<*>? = null
        fun finish(error: String?) {
            if (!delivered.compareAndSet(false, true)) return
            timeout?.cancel(false)
            jobFailure = null
            worker.execute {
                val finalError = try {
                    if (error == null) {
                        if (sdk?.endPrintJob() == true) null else s(R.string.print_unconfirmed_end)
                    } else { sdk?.cancelJob(); sdk?.close(); error }
                } catch (_: Throwable) { error ?: s(R.string.print_unconfirmed) }
                // On an ambiguous cancel the vendor may still hold this bitmap; let GC follow its references.
                bitmap = null
                busy.set(false)
                state(if (finalError == null) PrinterState.Phase.READY else PrinterState.Phase.ERROR,
                    finalError ?: s(R.string.print_complete, state.deviceName.orEmpty()))
                result(callback, finalError)
            }
        }
        jobFailure = { finish(it) }
        timeout = timer.schedule({ finish(s(R.string.print_timeout)) }, 60, TimeUnit.SECONDS)
        worker.execute {
            if (delivered.get()) return@execute
            try {
                val driver = api()
                bitmap = LabelRenderer.render(label, driver.printScaleMultiplier, media, s(R.string.label_quantity, label.quantity))
                if (delivered.get()) return@execute
                driver.setTotalPrintQuantity(1)
                driver.startPrintJob(5, 1, 1, object : PrintCallback {
                    override fun onProgress(pageIndex: Int, quantityIndex: Int, details: HashMap<String, Any>?) {
                        if (pageIndex >= 1 && quantityIndex >= 1) finish(null)
                    }
                    override fun onError(errorCode: Int) { finish(s(R.string.print_failed, errorCode)) }
                    override fun onError(errorCode: Int, printState: Int) { finish(s(R.string.print_failed_state, errorCode, printState)) }
                    override fun onCancelJob(success: Boolean) { finish(s(R.string.print_cancelled_check)) }
                    override fun onBufferFree(pageIndex: Int, bufferSize: Int) {
                        if (delivered.get() || pageIndex > 1 || !submitted.compareAndSet(false, true)) return
                        worker.execute {
                            if (!delivered.get()) {
                                try {
                                    driver.commitImageData(0, bitmap, media.widthMm, media.heightMm, 1, 0, 0, 0, 0, "")
                                } catch (error: Throwable) { finish(s(R.string.label_transfer_failed, safeError(error))) }
                            }
                        }
                    }
                })
            } catch (error: Throwable) { finish(s(R.string.cannot_print, safeError(error))) }
        }
    }

    fun disconnect(callback: (String?) -> Unit = {}) {
        if (!busy.compareAndSet(false, true)) { result(callback, s(R.string.operation_not_finished)); return }
        worker.execute {
            try { sdk?.close(); state(PrinterState.Phase.DISCONNECTED, s(R.string.printer_disconnected), null); result(callback, null) }
            catch (error: Throwable) { result(callback, safeError(error)) }
            finally { busy.set(false) }
        }
    }

    private fun s(id: Int, vararg args: Any) = LocaleStrings.get(application, id, *args)
    fun refreshLocale() {
        val message = when (state.phase) {
            PrinterState.Phase.DISCONNECTED -> s(R.string.printer_disconnected)
            PrinterState.Phase.READY -> s(R.string.printer_connected, state.deviceName.orEmpty())
            PrinterState.Phase.CONNECTING -> s(R.string.printer_connecting, state.deviceName.orEmpty())
            PrinterState.Phase.PRINTING -> s(R.string.printer_busy)
            PrinterState.Phase.ERROR -> s(R.string.printer_attention)
        }
        state(state.phase, message)
    }

    private fun safeError(error: Throwable): String = when (error) {
        is UnsatisfiedLinkError -> s(R.string.driver_arch_error)
        is SecurityException -> s(R.string.driver_permission_error)
        else -> s(R.string.driver_error)
    }
}
