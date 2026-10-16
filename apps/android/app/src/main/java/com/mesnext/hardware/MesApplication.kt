package com.mesnext.hardware

import android.app.Application
import com.mesnext.hardware.printing.JcPrinter

class MesApplication : Application() {
    // The vendor singleton never retains an Activity. SDK is initialized only when a printer is requested.
    val printer: JcPrinter by lazy { JcPrinter(this) }
}
