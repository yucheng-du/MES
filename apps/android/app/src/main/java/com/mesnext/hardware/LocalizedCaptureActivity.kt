package com.mesnext.hardware

import android.content.Context
import android.content.pm.PackageManager
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.DecoratedBarcodeView

/** Scanner controls follow the selected app language and expose the original torch capability. */
class LocalizedCaptureActivity : CaptureActivity() {
    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocaleStrings.localizedContext(newBase))
    }
    override fun initializeContent(): DecoratedBarcodeView {
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scanner = DecoratedBarcodeView(this)
        layout.addView(scanner, LinearLayout.LayoutParams(-1, 0, 1f))
        var torch = false
        val toggle = Button(this).apply {
            text = getString(R.string.torch_on)
            visibility = if (packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH)) View.VISIBLE else View.GONE
            setOnClickListener {
                torch = !torch
                if (torch) scanner.setTorchOn() else scanner.setTorchOff()
                text = getString(if (torch) R.string.torch_off else R.string.torch_on)
            }
        }
        layout.addView(toggle, LinearLayout.LayoutParams(-1, -2))
        setContentView(layout)
        return scanner
    }
}
