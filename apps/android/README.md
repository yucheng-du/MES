# MES Android companion

[简体中文](README.zh-CN.md) · [Project README](../../README.md)

A Kotlin client for the MES web app. It provides a restricted HTTPS WebView, native QR scanning, document/photo upload and document saving, update checks, and an optional Bluetooth label printer integration. Business authentication and authorization stay on the server; the native app never reads passwords or session tokens.

## Open-source build

The default **community** variant builds from this repository without proprietary SDKs. QR scanning, site configuration, language switching, and web workflows are available. Printer actions explain that a separate vendor SDK build is required; they do not claim to print successfully.

Requirements: JDK 17 or a JDK supported by Gradle 8.11.1; Android SDK platform 35 and build-tools 35.0.0. Versions are pinned to AGP 8.9.2, Gradle 8.11.1, Kotlin 2.1.20, compile/target SDK 35, and minimum SDK 24. The wrapper verifies the Gradle distribution SHA-256.

Install the SDK with Android Studio or the official Android `sdkmanager`, then run:

```sh
sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
export ANDROID_HOME=/path/to/android-sdk
./scripts/build-debug.sh
```

Android Studio can alternatively create an ignored `local.properties`. No machine paths, production URLs, accounts, or signing keys are required. First-time dependency resolution accesses Google Maven, Maven Central, and Gradle distribution servers.

The script runs:

```sh
./gradlew :app:assembleCommunityDebug :app:testCommunityDebugUnitTest :app:lintCommunityDebug
```

Output: `app/build/outputs/apk/community/debug/app-community-debug.apk`. Debug package ID: `com.mesnext.hardware.debug`. Debug uses a development key; release signing is the maintainer’s responsibility. Both variants share the package ID and cannot be installed side by side with the same build type.

## Optional vendor build

The adapter source is included under the project MIT license. The printer SDK binaries and their fonts are **not** included or relicensed. Obtain compatible SDKs directly from a source authorized to provide them, verify your use and distribution rights, and place these files locally:

```text
app/libs/jc-printer-3.2.8.aar
app/libs/jc-image-1.8.7.aar
app/libs/LPAPI-2019-11-20-R.jar
```

Then run `./scripts/build-debug.sh vendor`, or:

```sh
./gradlew -PwithVendorSdk=true :app:assembleVendorDebug :app:testVendorDebugUnitTest :app:lintVendorDebug
```

Output: `app/build/outputs/apk/vendor/debug/app-vendor-debug.apk`. Vendor variants are disabled unless `-PwithVendorSdk=true` is set. The default build never links these binaries, even when they are present locally. See [THIRD-PARTY.md](THIRD-PARTY.md) for compatibility details and licensing boundaries. Do not publish a vendor APK without confirming the applicable permissions.

## Use and language

1. Enter the exact **HTTPS origin** supplied by your administrator, for example `https://mes.example.com`. Page paths are not accepted, and the certificate must be trusted by Android.
2. Sign in to the website. Authentication uses the website’s HttpOnly cookie. Changing the configured site clears this container’s cookies and web storage.
3. Tap **Settings → 中文 / English** to switch immediately. The setup screen also has a language button. Chinese is the initial default. Native UI and Web UI synchronize `mes.locale` (`zh-CN` / `en-US`); switching does not reload the business page.
4. Use the website’s scan action and grant Camera permission. A flashlight toggle is available on devices with a flash. Scans return text only and never open a scanned URL automatically.
5. In the vendor build, pair a compatible JC printer in Android Bluetooth settings, then tap **Printer**. Android 12+ asks for Nearby devices permission. **Settings → App permission settings** helps recover denied permissions.
6. Choose 40 × 30 mm (default) or 60 × 40 mm gap labels in Settings. Print confirmation shows the item, code, quantity, media, and printer. Each job uses density 5 and one label.

Printer connection, rendering, and transmission run off the UI thread. Success requires the SDK callback and confirmed job completion. Disconnection, timeouts, or an interrupted app require checking the physical label. Jobs are not automatically retried or restored after process death. Offline business submission is not implemented.

## Attachments and updates

- Web attachment controls open Android's document picker, or offer taking a photo for image uploads. Only explicitly selected content URIs are returned to the current trusted page; no broad storage permission is requested.
- PDF documents render inside the authenticated Web page with page navigation, zoom and password entry. Images and text also preview there; Word/Excel documents can be saved and opened with an installed compatible app. The Web server verifies the session for each file request. PDF.js, its worker, CMaps, fonts and image decoders are served from the same origin; PDF scripts and links are not executed by the canvas preview. Decoders use JavaScript fallbacks without requiring relaxed script CSP.
- **Save attachment** opens Android's system Create document dialog. The bridge accepts only the server-supported PDF/image/text/Office formats, safe filenames, and up to 10 MiB of decoded bytes. Native code receives bytes, not an authenticated URL or session token. Cancellation and write failures are reported to the page.
- **Settings → Print test label** uses the same printer confirmation and completion checks as business labels.
- **Settings → Check for updates** shows the installed version and requests `GET /api/android/latest` on the configured HTTPS origin without cookies, redirect following, or credentials. The server returns `null` or `{versionCode, versionName, downloadUrl, remark}` for the latest approved release. Only a greater version code offers an update; the user confirms before the HTTPS download opens in the system browser. No APK is silently installed.

## Web bridge

```js
window.addEventListener('mes-native', ({ detail }) => {
  // { requestId, type: 'scan'|'print'|'printer'|'language'|'file', value?, error? }
});
window.MesNative?.scan(crypto.randomUUID());
window.MesNative?.configurePrinter(crypto.randomUUID());
window.MesNative?.printLabel(crypto.randomUUID(), JSON.stringify({
  code: 'WO-20260001', productName: 'Bearing housing', quantity: 12,
  processName: 'Finishing'
}));
window.MesNative?.setLanguage('en-US');
// Optional: bytes were fetched by the authenticated same-origin Web page.
window.MesNative?.saveFile?.(crypto.randomUUID(), JSON.stringify({
  name: 'instructions.txt', mime: 'text/plain', base64: 'TUVT'
}));
window.addEventListener('mes-language', ({ detail }) => {
  // detail.locale is zh-CN or en-US; update the Web UI without calling native again.
});
```

`scan` returns raw text, `printer` returns the selected device display name, and `print` returns `printed` only on confirmed completion. `file` returns `saved` after the selected destination is written. Existing operations retain the 8 KiB message limit; file envelopes are bounded separately for a 10 MiB document. Errors and cancellations return localized `error` text. Request IDs must be unique. Concurrent hardware operations are rejected; navigation prevents stale replies reaching a new document. Web callers should handle errors and bounded timeouts without automatically replaying print jobs.

AndroidX WebKit validates the configured exact HTTPS origin, actual sender origin, and main frame. There is no `addJavascriptInterface` fallback. Cross-origin resources, HTTP, file/content navigation, mixed content, web camera permission, third-party cookies, and scripted popups are blocked. External HTTPS links need native confirmation before opening in the system browser. Certificate errors stop loading. Responses are JSON sent through document-specific reply proxies; language changes use an origin-targeted web message. Unsupported WebViews disable the bridge and request an update. App backup and Android data extraction are disabled.

Serve the app with a CSP including `frame-src 'none'; frame-ancestors 'none'; object-src 'none'`. Treat all content on the configured origin as equally trusted. The hardware bridge does not replace server authorization.

## Validation and device acceptance

Both variants are checked with their assemble, unit-test, and lint tasks. Unit tests cover exact origins, credentials and port spoofing, frame checks, action and request bounds, Unicode labels, numeric validation, locale allowlisting, update URL/metadata validation, file type/name/base64 constraints, the exact 10 MiB file boundary, and unchanged limits for other bridge actions. A separate source-only build verifies that community needs no vendor SDK files.

Physical scanning, Bluetooth printing, and label layout still need acceptance on the intended phones and printers:

- HTTPS sign-in, rotation/back navigation, network loss, invalid certificates, and stale callbacks after navigation.
- Camera/Nearby devices allow, deny, permanent deny, settings recovery, scan cancellation, and long/Chinese QR codes.
- Pairing, connection loss/recovery, both media sizes, long product names, Chinese text, and scanning the printed QR back to the original code.
- Paper-out, open cover, interruption, repeated clicks, timeout, and process death without false success or automatic reprinting.
- External frames/links cannot invoke the bridge; production CSP is effective.
- Photo/document picker and cancellation, flashlight on/off, PDF/image/text preview, system document destinations, update checks and download confirmation on the target Android/WebView versions.

The optional SDK supports ARMv7/ARM64 only. Its ARM64 libraries use 4 KB ELF alignment; compatibility with 16 KB page devices is **not established**. A vendor SDK update and device verification are needed for those devices. The community build does not include those native libraries.
