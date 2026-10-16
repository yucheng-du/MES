package com.mesnext.hardware

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File

/** Files are selected by the user through Android; no silent storage or broad filesystem permission. */
class NativeUploads(private val activity: AppCompatActivity) {
    private var callback: ValueCallback<Array<Uri>>? = null
    private var photo: Uri? = null
    private var chooser: AlertDialog? = null
    private val picker = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        val uris = if (result.resultCode != AppCompatActivity.RESULT_OK) null else {
            val selected = data?.clipData?.let { clip -> (0 until minOf(clip.itemCount, 10)).map { clip.getItemAt(it).uri } }
                ?: data?.data?.let { listOf(it) } ?: emptyList()
            selected.filter { it.scheme == "content" }.takeIf { it.isNotEmpty() }?.toTypedArray()
        }
        finish(uris)
    }
    private val camera = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        finish(if (success) photo?.let { arrayOf(it) } else null)
    }
    private val cameraPermission = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) takePhoto() else finish(null)
    }
    fun choose(params: WebChromeClient.FileChooserParams, result: ValueCallback<Array<Uri>>): Boolean {
        finish(null)
        callback = result
        val types = params.acceptTypes.filter { it.isNotBlank() }.toTypedArray()
        val allowsImage = types.isEmpty() || types.any { it == "*/*" || it.startsWith("image/") || it in listOf(".jpg", ".jpeg", ".png", ".webp") }
        fun documents() {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = types.singleOrNull()?.takeIf { it.contains('/') } ?: "*/*"
                putExtra(Intent.EXTRA_MIME_TYPES, types.filter { it.contains('/') }.toTypedArray())
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            }
            runCatching { picker.launch(intent) }.onFailure { finish(null) }
        }
        if (!allowsImage) documents() else {
            chooser = AlertDialog.Builder(activity).setTitle(s(R.string.upload_source))
                .setItems(arrayOf(s(R.string.choose_file), s(R.string.take_photo))) { _, which ->
                    if (which == 0) documents() else if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) takePhoto()
                    else cameraPermission.launch(Manifest.permission.CAMERA)
                }.setNegativeButton(s(R.string.cancel)) { _, _ -> finish(null) }.setOnCancelListener { finish(null) }.show()
        }
        return true
    }
    private fun takePhoto() {
        runCatching {
            val directory = File(activity.cacheDir, "uploads").apply { mkdirs() }
            directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000 }?.forEach { it.delete() }
            val file = File.createTempFile("capture-", ".jpg", directory)
            photo = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
            camera.launch(photo!!)
        }.onFailure { finish(null) }
    }
    private fun finish(uris: Array<Uri>?) {
        val result = callback
        callback = null
        photo = null
        result?.onReceiveValue(uris)
    }
    fun dispose() { chooser?.dismiss(); chooser = null; finish(null) }
    private fun s(id: Int) = LocaleStrings.get(activity, id)
}
