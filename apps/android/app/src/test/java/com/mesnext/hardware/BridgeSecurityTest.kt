package com.mesnext.hardware

import com.mesnext.hardware.bridge.BridgeRequest
import com.mesnext.hardware.bridge.LabelData
import com.mesnext.hardware.bridge.NativeAction
import com.mesnext.hardware.security.TrustedOrigin
import org.junit.Assert.*
import org.junit.Test

class BridgeSecurityTest {
    @Test fun framesAndStalePageOriginsCannotInvokeNativeActions() {
        val origin = TrustedOrigin.parse("https://mes.example.com")
        assertTrue(origin.acceptsMessage("https://mes.example.com", "https://mes.example.com/work-orders", true))
        assertFalse(origin.acceptsMessage("https://mes.example.com", "https://mes.example.com/", false))
        assertFalse(origin.acceptsMessage("https://evil.test", "https://mes.example.com/", true))
        assertFalse(origin.acceptsMessage("https://mes.example.com", "https://evil.test", true))
        assertFalse(origin.acceptsMessage("https://mes.example.com", null, true))
    }

    @Test fun onlyExactHttpsOriginCanUseHardware() {
        val origin = TrustedOrigin.parse("https://MES.Example.com/")
        assertEquals("https://mes.example.com", origin.value)
        assertTrue(origin.accepts("https://mes.example.com:443/work-orders?a=1"))
        listOf("http://mes.example.com", "https://mes.example.com.evil.test", "https://user@mes.example.com", "https://mes.example.com:444", "file:///tmp/index.html", "javascript:alert(1)", "https://evil.test/?host=mes.example.com").forEach {
            assertFalse(it, origin.accepts(it))
        }
    }

    @Test fun configurationRejectsPathsCredentialsAndWildcards() {
        listOf("http://mes.example.com", "https://mes.example.com/path", "https://u:p@mes.example.com", "https://*.example.com", "https://mes.example.com#x", "https://mes.example.com?x=y").forEach {
            assertTrue(it, runCatching { TrustedOrigin.parse(it) }.isFailure)
        }
    }

    @Test fun configuredPortDoesNotTrustOtherPorts() {
        val origin = TrustedOrigin.parse("https://mes.example.com:8443")
        assertTrue(origin.accepts("https://mes.example.com:8443/"))
        assertFalse(origin.accepts("https://mes.example.com/"))
    }

    @Test fun labelDataPreservesUnicodeAndQuotesWithoutExecutingAnything() {
        val label = LabelData.parse("""{"code":"WO-'001","productName":"齿轮 \"A\"","quantity":12,"processName":"精加工"}""")
        assertEquals("WO-'001", label.code)
        assertEquals("齿轮 \"A\"", label.productName)
        assertEquals(12, label.quantity)
    }

    @Test fun invalidPrintPayloadNeverReachesDriver() {
        listOf("0", "-1", "1.5", "100000001", "\"12\"", "null").forEach { quantity ->
            assertTrue(runCatching { LabelData.parse("""{"code":"WO-1","productName":"齿轮","quantity":$quantity}""") }.isFailure)
        }
        assertTrue(runCatching { LabelData.parse("""{"code":"","productName":"齿轮","quantity":1}""") }.isFailure)
        assertTrue(runCatching { LabelData.parse("""{"code":"W\n01","productName":"齿轮","quantity":1}""") }.isFailure)
    }

    @Test fun bridgeAllowsOnlyDocumentedBoundedOperations() {
        val scan = BridgeRequest.parse("""{"action":"scan","requestId":"a-123"}""")
        assertEquals(NativeAction.scan, scan.action)
        assertTrue(runCatching { BridgeRequest.parse("""{"action":"exec","requestId":"a-123"}""") }.isFailure)
        assertTrue(runCatching { BridgeRequest.parse("""{"action":"scan","requestId":"<script>"}""") }.isFailure)
        assertTrue(runCatching { BridgeRequest.parse("a".repeat(8193)) }.isFailure)
    }

    @Test fun languageBridgeAcceptsOnlySupportedLocales() {
        for (locale in listOf("zh-CN", "en-US")) {
            val request = BridgeRequest.parse("""{"action":"setLanguage","requestId":"locale-123","json":"$locale"}""")
            assertEquals(NativeAction.setLanguage, request.action)
            assertEquals(locale, request.locale)
            assertNull(request.label)
        }
        for (locale in listOf("en", "fr-FR", "<script>", "")) {
            assertTrue(runCatching {
                BridgeRequest.parse("""{"action":"setLanguage","requestId":"locale-123","json":"$locale"}""")
            }.isFailure)
        }
        assertTrue(runCatching { BridgeRequest.parse("""{"action":"setLanguage","requestId":"locale-123"}""") }.isFailure)
    }

}
