package com.mesnext.hardware.bridge

import org.json.JSONObject

enum class NativeAction(val eventType: String) { scan("scan"), printLabel("print"), configurePrinter("printer"), setLanguage("language"), saveFile("file") }

data class LabelData(val code: String, val productName: String, val quantity: Int, val processName: String?) {
    companion object {
        fun parse(json: String): LabelData {
            require(json.length <= 4096) { "Invalid input" }
            val obj = JSONObject(json)
            fun text(name: String, max: Int, optional: Boolean = false): String {
                val raw = obj.opt(name)
                if (optional && (raw == null || raw == JSONObject.NULL)) return ""
                require(raw is String) { "Invalid input" }
                val value = raw.trim()
                require((optional || value.isNotBlank()) && value.length <= max && value.none { it.isISOControl() }) { "Invalid input" }
                return value
            }
            val rawQuantity = obj.opt("quantity")
            require(rawQuantity is Number) { "Invalid input" }
            val number = rawQuantity.toDouble()
            require(number.isFinite() && number >= 1 && number <= 100000000 && number % 1.0 == 0.0) { "Invalid input" }
            return LabelData(text("code", 128), text("productName", 80), number.toInt(), text("processName", 80, true).ifBlank { null })
        }
    }
}

data class BridgeRequest(val requestId: String, val action: NativeAction, val label: LabelData? = null, val locale: String? = null, val file: FileData? = null) {
    companion object {
        fun parse(message: String): BridgeRequest {
            require(message.length <= FileData.MAX_ENVELOPE) { "Invalid input" }
            val obj = JSONObject(message)
            val requestId = obj.getString("requestId")
            require(requestId.matches(Regex("[A-Za-z0-9_.:-]{1,96}"))) { "Invalid input" }
            val action = NativeAction.valueOf(obj.getString("action"))
            require(action == NativeAction.saveFile || message.length <= 8192) { "Invalid input" }
            val locale = if (action == NativeAction.setLanguage) obj.getString("json").also {
                require(it == "zh-CN" || it == "en-US") { "Unsupported locale" }
            } else null
            return BridgeRequest(requestId, action, if (action == NativeAction.printLabel) LabelData.parse(obj.getString("json")) else null, locale, if (action == NativeAction.saveFile) FileData.parse(obj.getString("json")) else null)
        }
    }
}
