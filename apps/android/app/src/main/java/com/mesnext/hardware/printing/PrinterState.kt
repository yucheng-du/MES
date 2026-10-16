package com.mesnext.hardware.printing

data class PrinterState(val phase: Phase, val message: String, val deviceName: String? = null) {
    enum class Phase { DISCONNECTED, CONNECTING, READY, PRINTING, ERROR }
}
