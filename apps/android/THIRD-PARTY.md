# Third-party components / 第三方组件

The project’s MIT license covers original MES source. Dependencies retain their own licenses. Proprietary vendor binaries and fonts are not included or relicensed by this repository.

项目 MIT 许可适用于MES 原创源码；第三方依赖保留各自许可。厂商二进制及字体不随仓库发布，也不因本项目改变许可。

## Optional printer SDK / 可选打印 SDK

The `vendor` source set integrates the JC `JCPrintApi` interface. Users with appropriate rights may supply the following compatible files in ignored `app/libs/`. The public `community` build requires none of them.

`vendor` 源码集适配 JC `JCPrintApi` 接口。有相应权限的使用者可在忽略提交的 `app/libs/` 本地放入以下兼容文件；公开 `community` 版本不需要这些文件。

| Local filename / 本地文件名 | Compatibility reference SHA-256 / 兼容参考哈希 |
| --- | --- |
| `jc-printer-3.2.8.aar` | `2143cb5f02a405411a7f311a74ce405d77028bf69af373f876e5ff44a4d4f525` |
| `jc-image-1.8.7.aar` | `38e56f88412b4435d69ef5e4a211e44f7ace886012d53d5798107d723d90bf97` |
| `LPAPI-2019-11-20-R.jar` | `34bd458fc6708403542c9a89fee6ec703551bb3ed10bfc70711263e60c66c08e` |

These reference files did not include an independent LICENSE/NOTICE establishing public redistribution rights. A MIT license on surrounding application code does not establish rights to these SDKs or fonts. Obtain the files through an authorized source and confirm applicable use, embedding, and redistribution terms. No vendor binaries or vendor APKs are published here.

这些参考文件未附足以确立公开再分发权限的独立 LICENSE/NOTICE；周边应用源码的 MIT 许可不能证明 SDK 或字体的授权。请从授权渠道取得文件，并确认适用的使用、嵌入及再分发条款。本仓库不发布厂商二进制或包含它们的 APK。

Compatibility notes / 兼容说明：

- The adapter uses `connectBluetoothPrinter`, `startPrintJob`, `commitImageData`, `endPrintJob`, and their callbacks. JC references both `com.niimbot.canvas.image` and `com.dothantech.lpapi` / `printer`, so all three files are required for this adapter. / 适配器依赖上述接口和回调，JC 同时引用图像与 LPAPI 类，因此需要三个文件。
- Version labels differ: filename 3.2.8, embedded manifest 3.2.4, and `getSdkVersion()` value 3.2.8-beta2. These are compatibility observations, not a claim of a stable vendor release. / 文件名、内嵌 manifest 与接口版本值不同，不据此宣称厂商稳定正式版。
- Reference binaries contain ARMv7/ARM64 only. ARM64 ELF LOAD segments use 4096-byte alignment. The adapter does not establish 16 KB page support; legacy JNI packaging does not fix ELF alignment. Recheck architecture, callbacks, and real devices after an SDK update. / 参考库仅支持 ARMv7/ARM64，ARM64 ELF 为 4 KB 对齐；传统 JNI 打包不能修复 16 KB 页兼容性，更新后需重新验收。
- The vendor manifest removes storage, location, and Wi-Fi modification permissions supplied by the SDK. Selection uses already paired Bluetooth devices; Android 12+ requires CONNECT/SCAN because the SDK may cancel discovery while connecting. / vendor manifest 移除 SDK 的存储、位置和 Wi-Fi 修改权限，只选择系统已配对设备；SDK 连接时可能取消发现，因此 Android 12+ 需要 CONNECT/SCAN。

## Open-source dependencies / 开源依赖

Dependencies are resolved from Google Maven, Maven Central, or the official Gradle distribution. Keep their published licenses when redistributing compiled artifacts. / 依赖通过官方仓库解析；分发编译产物时保留各组件的许可要求。

| Component / 组件 | License / 许可 | Source / 来源 |
| --- | --- | --- |
| AndroidX | Apache-2.0 | [AndroidX](https://android.googlesource.com/platform/frameworks/support/) |
| Kotlin standard library | Apache-2.0 | [Kotlin license](https://github.com/JetBrains/kotlin/blob/master/license/LICENSE.txt) |
| ZXing core / JourneyApps Android Embedded | Apache-2.0 | [ZXing](https://github.com/zxing/zxing/blob/master/LICENSE), [JourneyApps](https://github.com/journeyapps/zxing-android-embedded/blob/master/COPYING) |
| JUnit 4 (tests only / 仅测试) | EPL-1.0 | [JUnit](https://github.com/junit-team/junit4/blob/main/LICENSE-junit.txt) |
| JSON-java 20240303 (tests only / 仅测试) | Public domain / 公有领域声明 | [Version license](https://github.com/stleary/JSON-java/blob/20240303/LICENSE) |
| Gradle wrapper 8.11.1 | Apache-2.0 | [Included wrapper license](gradle/wrapper/LICENSE), [Gradle](https://github.com/gradle/gradle) |

`gradle-wrapper.jar` is the official Gradle wrapper, retained so a source checkout can bootstrap builds. Its embedded Apache-2.0 license is also reproduced in `gradle/wrapper/LICENSE`; wrapper scripts preserve their license headers. `gradle-wrapper.properties` pins the distribution checksum. Other SDK JAR/AAR files, build output, signing keys, machine settings, and local caches are excluded.

保留官方 `gradle-wrapper.jar`，使源码可直接启动构建；其内嵌 Apache-2.0 许可另存于 `gradle/wrapper/LICENSE`，脚本保留许可头，配置固定分发包校验和。其余 SDK JAR/AAR、构建输出、签名密钥、机器配置和本地缓存均不进入公开仓库。
