# Third-party components / 第三方组件

The MIT license at the repository root applies to MES source code. Dependencies keep their own licenses; MIT does not relicense third-party software.

仓库根目录的 MIT 许可证适用于MES 自有源码。第三方组件保留各自许可证，不能据此将第三方软件重新授权为 MIT。

The web/API dependencies are fetched from the package registry using `package-lock.json`; `node_modules` and compiled bundles are not distributed here. The principal runtime components (React, Ant Design and its icons, TanStack Query, React Router, Day.js, Fastify and its plugins, MQTT.js, node-postgres, and Zod) declare MIT licenses. TypeScript and Playwright declare Apache-2.0; Vite and tsx declare MIT. See each installed package's license and notices for the complete terms, including transitive dependencies.

Web/API 依赖通过 `package-lock.json` 从包仓库安装，本仓库不分发 `node_modules` 或编译后的网页包。主要运行时组件的声明许可证为 MIT，TypeScript 和 Playwright 为 Apache-2.0。完整条款及间接依赖以各安装包随附的许可证和声明为准，制作二进制或容器分发包时应保留它们。

Android libraries, the Gradle wrapper, and the **optional proprietary printer SDKs** are documented in [Android third-party notices](apps/android/THIRD-PARTY.md). The printer binaries are excluded from this repository. The community app builds without them; users of the vendor adapter must obtain compatible binaries and the required rights separately.

Android 依赖、Gradle wrapper 以及**可选的专有打印 SDK** 见 [Android 第三方说明](apps/android/THIRD-PARTY.md)。仓库不包含打印二进制，社区版无需它们即可构建；使用厂商适配的用户需另行取得兼容文件及所需授权。

PostgreSQL, Node.js, and Caddy container images are downloaded from their upstream distributors and retain their respective licenses and notices.

PostgreSQL、Node.js 和 Caddy 容器镜像由各上游分发，保留各自许可证和声明。

## Demo music / 演示视频配乐

The demo in the README and on the project website uses Kevin MacLeod's “Jazz Brunch” under CC BY 4.0. See [media credits](docs/MEDIA-CREDITS.md) for the source, license and edits. The music is not licensed under MIT.

README 与项目网站的演示视频使用 Kevin MacLeod 的《Jazz Brunch》，许可为 CC BY 4.0。来源、许可链接与修改说明见[媒体来源](docs/MEDIA-CREDITS.md)；音乐不适用 MIT 许可。

## PDF preview / PDF 预览

The browser preview uses Mozilla `pdfjs-dist` 6.4.299 under Apache-2.0. Its bundled CMaps, Foxit/Liberation fonts, and the OpenJPEG/JBIG2 JavaScript decoders retain their upstream licenses. The Vite build copies the decoder files and emits their notices, together with the PDF.js/font/CMap licenses, as `pdf-assets/THIRD-PARTY-NOTICES.txt`. Keep this file when distributing the built site or container. No proprietary printer SDK is involved in PDF preview.

网页预览使用 Apache-2.0 许可的 Mozilla `pdfjs-dist` 6.4.299。随附的 CMap、Foxit/Liberation 字体和 OpenJPEG/JBIG2 JavaScript 解码器保留各自上游许可。Vite 构建会复制解码器，并将其声明及 PDF.js/字体/CMap 许可证输出为 `pdf-assets/THIRD-PARTY-NOTICES.txt`；分发网页构建产物或容器时应保留该文件。PDF 预览不使用专有打印 SDK。
