package com.mesnext.hardware.updates

import org.json.JSONObject
import java.net.URI

/** Bounded metadata only. Downloads remain an explicit action in the system browser. */
data class AppUpdate(val versionCode: Long, val versionName: String, val downloadUrl: String, val remark: String) {
    companion object {
        fun parse(raw: String): AppUpdate? {
            require(raw.length <= 16384)
            if (raw.trim() == "null") return null
            val obj = JSONObject(raw)
            val code = obj.get("versionCode")
            require(code is Number && code.toDouble().isFinite() && code.toLong() > 0 && code.toDouble() == code.toLong().toDouble())
            val name = obj.getString("versionName").trim()
            val download = obj.getString("downloadUrl")
            val remark = obj.optString("remark", "")
            require(name.isNotBlank() && name.length <= 80 && remark.length <= 4000 && download.length <= 2048)
            val uri = URI(download)
            require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.fragment == null)
            return AppUpdate(code.toLong(), name, uri.toASCIIString(), remark)
        }
    }
}
