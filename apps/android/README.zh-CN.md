# MES Android 客户端

[English](README.md) · [项目说明](../../README.md#简体中文)

Kotlin 原生容器承载MES 网页，提供受限 HTTPS WebView、二维码扫描、拍照/文档上传与保存、更新检查及可选蓝牙标签打印。业务认证与权限由服务端负责；原生端不读取密码或会话令牌。

## 开源版本构建

默认 **community** 版本不依赖任何厂商 SDK，可以直接从公开源码构建。扫码、主站配置、语言切换和网页业务完整保留。打印操作会明确提示需要另行集成厂商 SDK，不会将未打印的任务显示为成功。

需要 JDK 17 或 Gradle 8.11.1 支持的 JDK、Android SDK 35、build-tools 35.0.0。固定版本：AGP 8.9.2、Gradle 8.11.1、Kotlin 2.1.20，compile/target SDK 35，最低 Android SDK 24。Gradle wrapper 校验分发包 SHA-256。

通过 Android Studio 或 Android 官方 `sdkmanager` 安装 SDK 后执行：

```sh
sdkmanager 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0'
export ANDROID_HOME=/path/to/android-sdk
./scripts/build-debug.sh
```

也可由 Android Studio 创建忽略提交的 `local.properties`。不要求个人路径、生产地址、账号或签名密钥。首次解析依赖需要访问 Google Maven、Maven Central 和 Gradle 分发站。

脚本执行以下构建、单测和 lint：

```sh
./gradlew :app:assembleCommunityDebug :app:testCommunityDebugUnitTest :app:lintCommunityDebug
```

APK：`app/build/outputs/apk/community/debug/app-community-debug.apk`。debug 包名为 `com.mesnext.hardware.debug`，使用开发签名；正式签名由维护者配置。两个 flavor 同一 build type 使用相同包名，不能同时安装。

## 可选厂商版本

打印适配器源码适用项目 MIT 许可。厂商 SDK 二进制及其字体**不随开源仓库发布，也没有改为 MIT 授权**。请从有权提供这些文件的渠道取得兼容 SDK，确认使用和分发权限后，在本地放置：

```text
app/libs/jc-printer-3.2.8.aar
app/libs/jc-image-1.8.7.aar
app/libs/LPAPI-2019-11-20-R.jar
```

执行 `./scripts/build-debug.sh vendor`，或：

```sh
./gradlew -PwithVendorSdk=true :app:assembleVendorDebug :app:testVendorDebugUnitTest :app:lintVendorDebug
```

APK：`app/build/outputs/apk/vendor/debug/app-vendor-debug.apk`。只有显式传入 `-PwithVendorSdk=true` 才启用 vendor 构建；即使本地已有 SDK，默认 community 仍不链接这些文件。兼容性和授权边界见 [THIRD-PARTY.md](THIRD-PARTY.md)。发布包含厂商 SDK 的 APK 前须确认相关分发权限。

## 使用与语言

1. 填写管理员提供的**准确 HTTPS origin**，如 `https://mes.example.com`；不接受页面路径，证书须受 Android 系统信任。
2. 在网页登录。主站通过 HttpOnly Cookie 保存会话；更换主站会清理本容器 Cookie 和 WebStorage。
3. **设置 → 中文 / English** 一键切换，首次配置页也提供切换按钮。默认中文；原生和网页共享 `mes.locale`（`zh-CN` / `en-US`）并同步更新，切换时不重载业务网页。
4. 在网页扫码操作中授予相机权限；有闪光灯的设备可切换照明。扫码只返回文字，不自动打开二维码中的 URL。
5. 使用 vendor 版本时，先在系统蓝牙设置配对兼容精臣打印机，再点顶部“打印机”连接。Android 12+ 需要“附近设备”权限，可从“设置 → 应用权限设置”恢复拒绝的权限。
6. “设置 → 标签纸规格”支持默认 40 × 30 mm 或 60 × 40 mm 热敏间隙纸。确认打印时展示产品、编号、数量、纸张和设备，每次 1 张，浓度 5。

连接、渲染与传输在后台线程执行。成功需要厂商 SDK 完成回调并确认结束任务；断连、超时或应用中断后需核对实物，不自动重印，也不恢复系统终止前的任务。当前不支持离线业务提交。

## 附件与更新

- 网页上传控件打开 Android 系统文档选择器，图片上传还可选择拍照。只把用户明确选择的 content URI 返回当前受信页面，不申请全盘存储权限。
- PDF 在已登录网页内渲染，支持翻页、缩放和密码；图片和文本同样可预览。Word、Excel 保存后由已安装的兼容应用打开。每次文件请求仍由服务端检查会话；PDF.js、worker、CMap、字体和图片解码器均为同源资源。Canvas 预览不执行 PDF 脚本和链接；解码器使用 JavaScript 回退，不要求放宽脚本 CSP。
- “保存附件”打开系统创建文档对话框。桥只接收服务端已有的 PDF/图片/文本/Office 格式、安全文件名和不超过 10 MiB 的解码数据；原生只获得文件字节，不获得认证 URL 或会话令牌。取消和写入失败会返回网页。
- “设置 → 打印测试标签”使用与业务标签相同的确认和完成检查。
- “设置 → 检查更新”显示当前版本，从配置的 HTTPS 主站读取 `GET /api/android/latest`，不携带 Cookie/认证信息，不跟随重定向。接口返回 `null` 或最新已批准版本的 `{versionCode, versionName, downloadUrl, remark}`。只有版本号更高才提示更新，经用户确认后由系统浏览器打开 HTTPS 下载地址，不静默安装 APK。

## 网页桥接与安全

接口和示例见 [英文说明](README.md#web-bridge)。扫码返回原始字符串，连接返回设备显示名，打印确认完成后才返回 `printed`。可选 `saveFile(requestId, json)` 接收 `{name,mime,base64}`，写入所选位置后返回 `type=file,value=saved`。其他桥操作仍限制 8 KiB 消息，文件消息单独按 10 MiB 解码上限控制。失败、取消和拒权返回当前语言的 `error`。请求编号须唯一，同时只允许一个硬件操作，页面导航后旧请求不回调新页面。网页应处理错误和合理超时，不自动重放打印。

语言接口为 `window.MesNative?.setLanguage('en-US')`；原生发出 `mes-language` 事件，`detail.locale` 为 `zh-CN` 或 `en-US`。网页监听后更新界面，不应再次回调原生。

AndroidX WebKit 桥校验**准确 HTTPS origin、实际来源 origin 和主 frame**，没有 `addJavascriptInterface` 降级。阻止跨 origin 资源、HTTP、file/content 导航、混合内容、网页相机权限、第三方 Cookie 和脚本弹窗。外部 HTTPS 链接经原生确认后用系统浏览器打开；证书错误立即停止。响应以 JSON 经文档专属 reply proxy 返回；语言同步使用指定 origin 的消息。WebView 不支持安全桥能力时提示升级，不开放硬件。应用禁用备份和 Android 数据迁移。

主站 CSP 应包含 `frame-src 'none'; frame-ancestors 'none'; object-src 'none'`。同 origin 内容均属同一信任域；原生桥不代替服务端鉴权。

## 验证与现场验收

两个 flavor 均运行构建、单测和 lint。单测涵盖 HTTPS origin/凭据/端口伪装、frame 校验、操作白名单、请求长度、Unicode 标签、数量和语言白名单、更新 URL/元数据、附件类型/文件名/Base64、10 MiB 精确边界及其他桥消息限制保持不变；另用不含厂商二进制的源码目录验证 community 可构建。

实际扫码、蓝牙打印和标签版面仍需在目标手机与打印机验收：

- HTTPS 登录、旋转/返回、断网、证书失败及导航后旧回调隔离。
- 相机/附近设备允许、拒绝、永久拒绝和设置恢复，扫码取消、长码及中文码。
- 配对、连接中断和恢复；两种纸张的边距、中文及长产品名；打印码回扫匹配原编号。
- 缺纸、开盖、打印中断连、连续点击、超时和进程终止，不出现假成功或自动重印。
- iframe/外链不能调用硬件桥，生产 CSP 生效。
- 目标 Android/WebView 上的拍照/选文档与取消、闪光灯、PDF/图片/文本预览、系统文件保存位置、更新检查和下载确认。

可选厂商 SDK 仅支持 ARMv7/ARM64，其 ARM64 库 ELF 为 4 KB 对齐，**尚未确认兼容 16 KB 页设备**；这类设备需要厂商更新 SDK 后重新验收。community 不包含这些原生库。
