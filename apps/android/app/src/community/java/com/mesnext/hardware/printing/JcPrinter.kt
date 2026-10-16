package com.mesnext.hardware.printing

import android.app.Application
import com.mesnext.hardware.R
import com.mesnext.hardware.LocaleStrings
import com.mesnext.hardware.bridge.LabelData

/** Open-source build: no proprietary printer classes or binaries are linked. */
@Suppress("UNUSED_PARAMETER")
class JcPrinter(private val application: Application) {
    val available = false
    val state: PrinterState get() = PrinterState(PrinterState.Phase.DISCONNECTED, unavailable())
    private fun unavailable() = LocaleStrings.get(application, R.string.vendor_sdk_required)
    fun observe(listener: (PrinterState) -> Unit) { listener(state) }
    fun removeObserver(listener: (PrinterState) -> Unit) = Unit
    fun refreshLocale() = Unit
    fun connect(address: String, name: String, callback: (String?) -> Unit) { callback(unavailable()) }
    fun print(label: LabelData, media: LabelSize, callback: (String?) -> Unit) { callback(unavailable()) }
    fun disconnect(callback: (String?) -> Unit = {}) { callback(null) }
}
