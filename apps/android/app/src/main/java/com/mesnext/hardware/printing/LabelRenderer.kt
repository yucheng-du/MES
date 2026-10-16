package com.mesnext.hardware.printing

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.mesnext.hardware.bridge.LabelData

enum class LabelSize(val widthMm: Float, val heightMm: Float, val label: String) {
    COMPACT(40f, 30f, "40 × 30 mm"), STANDARD(60f, 40f, "60 × 40 mm")
}

/** Dimensions match selected physical media; bitmap resolution follows the printer's SDK scale. */
object LabelRenderer {
    fun render(label: LabelData, pixelsPerMm: Float, media: LabelSize, quantityText: String): Bitmap {
        val scale = pixelsPerMm.takeIf { it.isFinite() && it in 6f..16f } ?: 8f
        val bitmap = Bitmap.createBitmap((media.widthMm * scale).toInt(), (media.heightMm * scale).toInt(), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        val compact = media == LabelSize.COMPACT
        val qrWidth = if (compact) 17f else 26f
        val textWidth = media.widthMm - qrWidth - 6f
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; typeface = Typeface.DEFAULT_BOLD; textSize = 3.1f * scale }
        fun text(value: String, topMm: Float, maxLines: Int, fontMm: Float, widthMm: Float = textWidth) {
            paint.textSize = fontMm * scale
            var remaining = value
            repeat(maxLines) { line ->
                if (remaining.isEmpty()) return@repeat
                val count = paint.breakText(remaining, true, widthMm * scale, null).coerceAtLeast(1)
                val part = if (line == maxLines - 1 && count < remaining.length) remaining.take((count - 1).coerceAtLeast(1)) + "…" else remaining.take(count)
                canvas.drawText(part, 2 * scale, (topMm + line * (fontMm + 0.8f)) * scale, paint)
                remaining = remaining.drop(count)
            }
        }
        text(label.productName, if (compact) 4f else 5f, if (compact) 2 else 3, if (compact) 2.4f else 3.1f)
        paint.typeface = Typeface.DEFAULT
        text(quantityText, if (compact) 12f else 18f, 1, if (compact) 2.2f else 2.8f)
        label.processName?.let { text(it, if (compact) 17f else 23f, if (compact) 1 else 2, if (compact) 2.1f else 2.4f) }
        text(label.code, media.heightMm - 6f, 2, if (compact) 1.8f else 2.2f, media.widthMm - 4f)
        val size = (qrWidth * scale).toInt()
        val matrix = QRCodeWriter().encode(label.code, BarcodeFormat.QR_CODE, size, size, mapOf(
            EncodeHintType.CHARACTER_SET to "UTF-8", EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2
        ))
        val pixels = IntArray(size * size) { index -> if (matrix[index % size, index / size]) Color.BLACK else Color.WHITE }
        val qr = Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
        canvas.drawBitmap(qr, (media.widthMm - qrWidth - 2) * scale, 3 * scale, null)
        qr.recycle()
        return bitmap
    }
}
