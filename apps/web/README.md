# MES Web

[简体中文](README.zh-CN.md) · English · [Project README](../../README.md)

React 19, TypeScript, Vite 8, and Ant Design 6, with React Query for server state. Business data comes from `/api`; front-end demo data does not substitute for real writes. Development proxies API traffic to `127.0.0.1:4300`. Production builds output `dist`; the project deployment serves static files and the API under the same origin.

## Run and verify

Install workspace dependencies at the repository root using Node.js 22.12 or later. From that root:

```bash
npm run dev
npm run typecheck -w @mes/web
npm run test:web
npm run build -w @mes/web
```

`npm run dev` starts both API and web. With an API already running, use `npm run dev -w @mes/web` to start only Vite. `build` runs TypeScript checks before bundling. Request-intent tests cover concurrent call coalescing, retries after uncertain network/server outcomes, new intents after explicit rejection, and equipment event IDs. Browser workflows live in the root `tests` directory; see [testing](../../docs/TESTING.md).

## Source map

- `src/App.tsx`, `src/auth-context.ts`: cookie sessions, navigation, mobile drawer, and SSE. Reconnection refreshes cached data; disconnection is visible.
- `src/api.ts`, `src/intent-client.ts`: HTTP errors, queries, writes, and idempotent intents. Concurrent identical submissions send once. Network errors and 5xx responses retain the original `requestId`/`eventId` for retry; success or explicit 4xx responses release the intent. Signing out clears intents.
- `src/pages/Production.tsx`: product routes, sales orders, work orders, and traceability. Product edits use `revision`. Work order progress uses `completedQuantity`; `goodQuantity` is the target after approved scrap.
- `src/pages/Execution.tsx`: personal shop floor station, receipt/start/completion, report review, and scrap. The station shows the current worker's active reports. Physical completion advances operations; approval confirms piecework pay.
- `src/pages/Operations.tsx`: finished goods movements, pay, users, and audit records.
- `src/pages/Resources.tsx`: 34 registers generated from `@mes/shared` field and role definitions. Submission, approval, archive, and deletion call real APIs. Work tasks and Andon records have separate handling feedback; approval requires `feedbackAt` for the current round. These registers implement their defined fields and workflow rather than every possible specialized management process.
- `src/pages/Devices.tsx`: actual equipment state, connection status, stale-data indicators, daily durations, and manual state entry.
- `src/components/Attachments.tsx`: authenticated file upload, linking, and download.
- `src/components/common.tsx`: shared presentation, action reasons, and native/browser label printing.
- `src/i18n.ts`, `src/locales/*`, `src/components/LanguageSwitch.tsx`: locale state, message catalogs, and the language switch.

## Chinese and English authoring

Supported locales are `zh-CN` and `en-US`; Chinese is the default. The login screen and application header expose a one-click switch. The selection persists in local storage under `mes.locale` and follows cross-tab storage updates. Ant Design, dates, number display, document language, and page metadata follow the selection. Amounts remain **CNY**; a language change does not convert currency or change business rules.

`t(source, params?)` uses stable Chinese source text as its key. English strings live in the named exports under `src/locales`: `commonMessages`, `productionMessages`, `managementMessages`, and `serverMessages`, merged by `src/i18n.ts`. Keep shared keys consistent rather than adding conflicting translations to different catalogs.

When adding UI:

1. Call `useLocale()` in components that render translated strings, so language changes trigger a render. Call `t()` during rendering or the relevant action, not at module initialization where it would freeze the language.
2. Add the Chinese source key and English translation to the appropriate catalog. Use `{name}`-style placeholders and `t("...{name}...", { name })` rather than constructing translated sentences by concatenation.
3. Translate shared resource titles, groups, descriptions, field labels, option labels, and units at display boundaries. Keep stored keys, enums, routes, identifiers, and request bodies unchanged.
4. Translate system-owned text only. Product/customer names, worker names, user notes, entered units, codes, and raw audit data stay as entered. Pass these as interpolation values or render them directly; do not treat arbitrary business data as translation keys.
5. Use the shared formatting helpers in `src/api.ts` for dates, numbers, and money. Add new API-owned messages or parameterized errors to `serverMessages` when English display needs them.
6. Run `npm run test:web`, type checks, and relevant browser checks. `src/i18n.test.ts` checks locale switching, preserved interpolation values, server message translation, resource metadata coverage, and literal translation-key coverage. Visual checks are still needed for longer English labels and mobile layouts.

Unknown translation keys fall back to source text; that fallback keeps the application usable but is not a substitute for adding a translation. The catalog can also match known server message templates whose values have already been inserted, preserving the values while translating the system text.

## Mobile and hardware

Responsive navigation, detail drawers, horizontally scrollable tables, and large shop floor actions support desktops, tablets, and phones. Android capabilities are detected through `window.MesNative`; scanning, printer selection, and printing use the documented message bridge. Scan timeouts are recoverable. Browsers support manual work order entry and printable work order labels with real QR codes.

The optional native `setLanguage(locale)` method synchronizes web changes with Android. Native changes emit `mes-language` with `{ locale }`; the web handler applies the locale without echoing it. The current container initializes web locale from its native preference before page scripts run. See the [bridge contract](../../docs/API-CONTRACT.md#android-bridge).

The Android community build does not include a printer SDK and cannot print to vendor devices. The optional vendor build requires separately supplied licensed dependencies. Camera, Bluetooth, label layout, and physical-device compatibility still require acceptance on actual hardware. No offline production-write queue is provided.

Products, orders, work orders, workstations, and generic references use `useOptions` to read every API page and share cached options, with name/code search in selectors. Active station reports are filtered by the server for the current worker and read across all pages, so historical record volume does not hide in-progress work. Pagination tests cover over 100 records, server page-size limits, and non-paginated lookup responses. SSE recovery refreshes lists after interruption.
