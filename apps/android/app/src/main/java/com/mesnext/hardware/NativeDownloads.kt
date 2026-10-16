package com.mesnext.hardware

import android.content.Intent
import android.util.Base64
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.mesnext.hardware.bridge.FileData
import java.util.concurrent.Executors

/** User-selected Storage Access Framework destination; no storage permission or session access. */
class NativeDownloads(private val activity: AppCompatActivity) {
    private val worker = Executors.newSingleThreadExecutor()
    private var pending: FileData? = null
    private var callback: ((String?, String?) -> Unit)? = null
    private var disposed = false
    private val picker = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val file = pending ?: return@registerForActivityResult
        val uri = result.data?.data
        if (result.resultCode != AppCompatActivity.RESULT_OK || uri?.scheme != "content") {
            finish(null, text(R.string.file_save_cancelled))
            return@registerForActivityResult
        }
        worker.execute {
            val saved = runCatching {
                val bytes = Base64.decode(file.base64, Base64.NO_WRAP)
                require(bytes.isNotEmpty() && bytes.size <= FileData.MAX_BYTES)
                activity.contentResolver.openOutputStream(uri, "w")?.use { it.write(bytes) }
                    ?: error("Cannot open selected destination")
            }
            activity.runOnUiThread {
                if (!disposed) finish(if (saved.isSuccess) "saved" else null, if (saved.isFailure) text(R.string.file_save_failed) else null)
            }
        }
    }
    fun save(file: FileData, reply: (String?, String?) -> Unit) {
        if (pending != null || disposed) { reply(null, text(R.string.operation_pending)); return }
        pending = file
        callback = reply
        runCatching {
            picker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = file.mime
                putExtra(Intent.EXTRA_TITLE, file.name)
            })
        }.onFailure { finish(null, text(R.string.file_save_failed)) }
    }
    private fun finish(value: String?, error: String?) {
        val reply = callback
        pending = null
        callback = null
        reply?.invoke(value, error)
    }
    private fun text(id: Int) = LocaleStrings.get(activity, id)
    fun dispose() { disposed = true; pending = null; callback = null; worker.shutdownNow() }
}
