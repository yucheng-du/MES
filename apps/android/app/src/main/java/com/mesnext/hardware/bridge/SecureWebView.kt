package com.mesnext.hardware.bridge

import com.mesnext.hardware.R
import com.mesnext.hardware.LocaleStrings
import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.webkit.WebMessage
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.mesnext.hardware.security.TrustedOrigin
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** The transport identifies the sender's actual origin and frame; JavaScript cannot supply them. */
class SecureWebView(
    private val web: WebView,
    private val origin: TrustedOrigin,
    private val onRequest: (BridgeRequest, (String?, String?) -> Unit) -> Unit,
    private val onStatus: (String, Boolean) -> Unit,
    private val onExternalLink: (Uri) -> Unit,
    private val onFileChooser: (WebChromeClient.FileChooserParams, ValueCallback<Array<Uri>>) -> Boolean,
) {
    private var bootstrap: ScriptHandler? = null
    private var lastStatus: (() -> Unit)? = null
    private var generation = 0L
    private var disposed = false
    private var failed = false
    val hardwareAvailable = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    @SuppressLint("SetJavaScriptEnabled")
    fun start() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = true
            if (Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = true
        }
        WebView.setWebContentsDebuggingEnabled(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
            override fun onShowFileChooser(view: WebView, result: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                if (disposed || !origin.accepts(view.url)) { result.onReceiveValue(null); return true }
                val requestGeneration = generation
                return onFileChooser(params, ValueCallback { files ->
                    result.onReceiveValue(if (!disposed && requestGeneration == generation && origin.accepts(web.url)) files else null)
                })
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (origin.accepts(request.url.toString())) return false
                // Hardware bridge never accompanies external navigation, and scripted popups are denied.
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme == "https") {
                    onExternalLink(request.url)
                }
                return true
            }

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                // This companion serves a self-contained MES origin. No remote iframe or CDN can execute here.
                if (!origin.accepts(request.url.toString())) return WebResourceResponse(
                    "text/plain", "UTF-8", 403, "Origin blocked", emptyMap(), ByteArrayInputStream(ByteArray(0))
                )
                return null
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                generation++
                failed = false
                if (!origin.accepts(url)) {
                    view.stopLoading()
                    reportStatus(R.string.site_blocked, true)
                    return
                }
                reportStatus(R.string.connecting_site, false)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                if (!failed && origin.accepts(url)) {
                    reportStatus(if (hardwareAvailable) R.string.site_connected else R.string.webview_update, !hardwareAvailable)
                    syncLanguage()
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    failed = true
                    reportStatus(R.string.site_unavailable, true)
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame) {
                    failed = true
                    reportStatus(R.string.http_error, true, errorResponse.statusCode)
                }
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                failed = true
                reportStatus(R.string.ssl_error, true)
            }

            override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                disposed = true
                reportStatus(R.string.renderer_gone, true)
                view.destroy()
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addWebMessageListener(web, "MesHardwareTransport", setOf(origin.value)) { _, message, source, mainFrame, reply ->
                if (disposed || !origin.acceptsMessage(source.toString(), web.url, mainFrame)) return@addWebMessageListener
                val raw = message.data ?: return@addWebMessageListener
                val request = runCatching { BridgeRequest.parse(raw) }.getOrElse {
                    // Well-formed identifiers still get a bounded failure, so invalid labels do not hang the UI.
                    val envelope = runCatching { JSONObject(raw.take(8192)) }.getOrNull()
                    val id = envelope?.optString("requestId").orEmpty()
                    val action = runCatching { NativeAction.valueOf(envelope?.optString("action").orEmpty()) }.getOrNull()
                    if (id.matches(Regex("[A-Za-z0-9_.:-]{1,96}")) && action != null &&
                        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                        reply.postMessage(JSONObject().put("requestId", id).put("type", action.eventType)
                            .put("error", s(R.string.invalid_request)).toString())
                    }
                    reportStatus(R.string.invalid_request, true)
                    return@addWebMessageListener
                }
                val requestGeneration = generation
                onRequest(request) { value, error ->
                    web.post {
                        if (!disposed && requestGeneration == generation && origin.accepts(web.url)) {
                            val response = JSONObject().put("requestId", request.requestId).put("type", request.action.eventType)
                            if (value != null) response.put("value", value)
                            if (error != null) response.put("error", error)
                            // Reply proxy belongs to the requesting JavaScript object; no string interpolation/eval.
                            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                                runCatching { reply.postMessage(response.toString()) }
                            }
                        }
                    }
                }
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                installBootstrap()
            }
        }
        web.loadUrl(origin.value + "/")
    }

    private fun reportStatus(id: Int, error: Boolean, vararg args: Any) {
        lastStatus = { onStatus(s(id, *args), error) }
        lastStatus?.invoke()
    }

    private fun installBootstrap() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        bootstrap?.remove()
        // The only substitution is a validated, JSON-quoted locale; no page content is executed.
        val script = BOOTSTRAP.replace("__MES_LOCALE__", JSONObject.quote(LocaleStrings.locale(web.context)))
        bootstrap = WebViewCompat.addDocumentStartJavaScript(web, script, setOf(origin.value))
    }

    fun syncLanguage() {
        if (disposed) return
        lastStatus?.invoke()
        if (!hardwareAvailable) return
        installBootstrap()
        if (origin.accepts(web.url)) {
            val payload = JSONObject().put("type", "mes-language").put("locale", LocaleStrings.locale(web.context))
            web.postWebMessage(WebMessage(payload.toString()), Uri.parse(origin.value))
        }
    }

    private fun s(id: Int, vararg args: Any) = LocaleStrings.get(web.context, id, *args)

    fun reload(): Boolean {
        if (disposed) return false
        web.reload()
        return true
    }
    fun goBack(): Boolean {
        if (disposed || !web.canGoBack()) return false
        web.goBack()
        return true
    }
    fun dispose() {
        if (disposed) return
        disposed = true
        generation++
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) bootstrap?.remove()
        bootstrap = null
        web.stopLoading()
        web.destroy()
    }

    companion object {
        // Hardware and locale actions share the same actual-origin and main-frame checks.
        private val BOOTSTRAP = """
            (() => {
              if (window !== window.top || !window.MesHardwareTransport) return;
              const applyLocale = locale => {
                if (locale !== 'zh-CN' && locale !== 'en-US') return;
                try { window.localStorage.setItem('mes.locale', locale); } catch (_) { /* storage unavailable */ }
                window.dispatchEvent(new CustomEvent('mes-language', {detail: {locale}}));
              };
              applyLocale(__MES_LOCALE__);
              window.addEventListener('message', event => {
                try {
                  const message = JSON.parse(event.data);
                  if (message.type === 'mes-language') applyLocale(message.locale);
                } catch (_) { /* unrelated web message */ }
              });
              const send = (action, requestId, json) => {
                window.MesHardwareTransport.postMessage(JSON.stringify({action, requestId, json}));
              };
              window.MesHardwareTransport.onmessage = event => {
                try { window.dispatchEvent(new CustomEvent('mes-native', {detail: JSON.parse(event.data)})); }
                catch (_) { /* malformed native response is ignored */ }
              };
              Object.defineProperty(window, 'MesNative', {value: Object.freeze({
                scan: requestId => send('scan', requestId),
                configurePrinter: requestId => send('configurePrinter', requestId),
                printLabel: (requestId, json) => send('printLabel', requestId, json),
                saveFile: (requestId, json) => send('saveFile', requestId, json),
                setLanguage: locale => {
                  if (locale === 'zh-CN' || locale === 'en-US') {
                    send('setLanguage', 'locale-' + crypto.randomUUID(), locale);
                  }
                }
              }), writable: false, configurable: false});
            })();
        """.trimIndent()
    }
}
