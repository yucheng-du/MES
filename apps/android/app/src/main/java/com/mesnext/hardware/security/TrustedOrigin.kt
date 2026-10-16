package com.mesnext.hardware.security

import java.net.URI
import java.util.Locale

/** One explicit HTTPS origin. Paths, credentials, wildcard hosts and opaque URLs are rejected. */
@ConsistentCopyVisibility
data class TrustedOrigin private constructor(val value: String, private val host: String, private val port: Int) {
    fun acceptsMessage(sourceUrl: String?, currentPageUrl: String?, isMainFrame: Boolean): Boolean =
        isMainFrame && accepts(sourceUrl) && accepts(currentPageUrl)

    fun accepts(url: String?): Boolean = runCatching {
        if (url == null || url.length > 8192) return false
        val candidate = URI(url)
        candidate.scheme.equals("https", ignoreCase = true) && candidate.userInfo == null &&
            candidate.host?.lowercase(Locale.ROOT) == host && effectivePort(candidate) == port
    }.getOrDefault(false)

    companion object {
        fun parse(input: String): TrustedOrigin {
            val uri = URI(input.trim())
            require(uri.scheme.equals("https", ignoreCase = true)) { "Invalid input" }
            require(uri.userInfo == null && uri.query == null && uri.fragment == null) { "Invalid input" }
            require(uri.path.isNullOrEmpty() || uri.path == "/") { "Invalid input" }
            val host = uri.host?.lowercase(Locale.ROOT) ?: error("Invalid input")
            require(host.isNotBlank() && !host.contains('*') && !host.endsWith('.')) { "Invalid input" }
            val port = effectivePort(uri)
            require(port in 1..65535) { "Invalid input" }
            val normalized = "https://$host" + if (port == 443) "" else ":$port"
            return TrustedOrigin(normalized, host, port)
        }

        private fun effectivePort(uri: URI) = if (uri.port == -1) 443 else uri.port
    }
}
