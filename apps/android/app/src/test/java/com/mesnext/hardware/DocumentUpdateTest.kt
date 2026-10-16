package com.mesnext.hardware

import com.mesnext.hardware.bridge.BridgeRequest
import com.mesnext.hardware.bridge.FileData
import com.mesnext.hardware.bridge.NativeAction
import com.mesnext.hardware.updates.AppUpdate
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DocumentUpdateTest {
    private fun file(name: String = "drawing.pdf", mime: String = "application/pdf", data: String = "JVBERi0=") =
        JSONObject().put("name", name).put("mime", mime).put("base64", data).toString()
    private fun envelope(action: String, json: String) = JSONObject().put("requestId", "file-123").put("action", action).put("json", json).toString()

    @Test fun fileBridgeIsBoundedAndDoesNotRelaxOtherMessages() {
        val request = BridgeRequest.parse(envelope("saveFile", file()))
        assertEquals(NativeAction.saveFile, request.action)
        assertEquals("drawing.pdf", request.file!!.name)
        val bytes = ByteArray(FileData.MAX_BYTES) { 65 }
        val max = java.util.Base64.getEncoder().encodeToString(bytes)
        assertNotNull(BridgeRequest.parse(envelope("saveFile", file(data = max))).file)
        assertTrue(runCatching { FileData.parse(file(data = java.util.Base64.getEncoder().encodeToString(ByteArray(FileData.MAX_BYTES + 1)))) }.isFailure)
        assertTrue(runCatching { BridgeRequest.parse(envelope("scan", "a".repeat(8192))) }.isFailure)
        assertTrue(runCatching { BridgeRequest.parse(envelope("printLabel", "a".repeat(8192))) }.isFailure)
    }
    @Test fun fileNamesTypesAndBase64AreStrict() {
        for (name in listOf("../a.pdf", "a\\b.pdf", "a\n.pdf", "a.apk", "a.html", "a.pdf.exe", "a".repeat(181) + ".pdf"))
            assertTrue(name, runCatching { FileData.parse(file(name = name)) }.isFailure)
        for (data in listOf("", "abc", "a===", "====", "=abc", "ab=c", "YW Jj", "!!!!", "YWJj\n"))
            assertTrue(data, runCatching { FileData.parse(file(data = data)) }.isFailure)
        assertTrue(runCatching { FileData.parse(file(mime = "text/html")) }.isFailure)
        assertEquals("说明.TXT", FileData.parse(file("说明.TXT", "text/plain", "YQ==")).name)
    }
    @Test fun updatesAcceptOnlyBoundedHttpsMetadata() {
        fun metadata(url: String = "https://releases.example.org/mes.apk", code: Any = 2) = JSONObject().put("versionCode", code).put("versionName", "2.0").put("downloadUrl", url).put("remark", "更新 / Update").toString()
        assertNull(AppUpdate.parse("null"))
        assertEquals(2L, AppUpdate.parse(metadata())!!.versionCode)
        for (url in listOf("http://example.org/a.apk", "file:///a.apk", "https://u:p@example.org/a.apk", "https://example.org/a.apk#x", "javascript:alert(1)"))
            assertTrue(url, runCatching { AppUpdate.parse(metadata(url)) }.isFailure)
        for (code in listOf(0, -1, 1.2, "2")) assertTrue(runCatching { AppUpdate.parse(metadata(code = code)) }.isFailure)
        assertTrue(runCatching { AppUpdate.parse(" ".repeat(16385)) }.isFailure)
    }
}
