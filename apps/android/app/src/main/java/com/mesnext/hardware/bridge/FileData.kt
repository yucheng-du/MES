package com.mesnext.hardware.bridge

import org.json.JSONObject

/** Documents only. The WebView fetches authorized bytes; native code never handles cookies. */
data class FileData(val name: String, val mime: String, val base64: String) {
    companion object {
        const val MAX_BYTES = 10 * 1024 * 1024
        const val MAX_BASE64 = ((MAX_BYTES + 2) / 3) * 4
        const val MAX_ENVELOPE = MAX_BASE64 + 4096
        private val types = mapOf(
            "pdf" to "application/pdf", "png" to "image/png", "jpg" to "image/jpeg",
            "jpeg" to "image/jpeg", "webp" to "image/webp", "txt" to "text/plain", "csv" to "text/csv",
            "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        fun parse(raw: String): FileData {
            require(raw.length <= MAX_ENVELOPE)
            val obj = JSONObject(raw)
            val name = obj.getString("name")
            val mime = obj.getString("mime")
            val data = obj.getString("base64")
            require(name.isNotBlank() && name.length <= 180 && name.none { it.isISOControl() || it == '/' || it == '\\' })
            require(types[name.substringAfterLast('.', "").lowercase(java.util.Locale.ROOT)] == mime)
            require(data.isNotEmpty() && data.length <= MAX_BASE64 && data.length % 4 == 0)
            val padding = data.takeLastWhile { it == '=' }.length
            require(padding <= 2 && data.dropLast(padding).all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '+' || it == '/' })
            require(data.length / 4 * 3 - padding <= MAX_BYTES)
            return FileData(name, mime, data)
        }
    }
}
