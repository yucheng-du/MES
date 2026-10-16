# API contract

[简体中文](API-CONTRACT.zh-CN.md) · English

## Conventions

All HTTP paths below are relative to `/api`. Successful JSON responses contain an entity or `{ items, total, page, pageSize }`. Errors use `{ error: { code, message, details? } }` with an appropriate HTTP status. Fields use camelCase, identifiers use UUIDs, timestamps use ISO format, and monetary calculations use decimal arithmetic or integer cents. List endpoints support `q`, `status`, `page`, and `pageSize` where applicable.

Authentication uses an HttpOnly session cookie. Browser requests include credentials. State-changing requests validate the configured origin or an accepted same-origin request context; local development uses the Vite proxy. Production uses HTTPS. Enum values, identifiers, and API paths do not change with the display language. Server-owned messages and resource metadata use Chinese source text, which the web message catalog translates for English display. Business data remains as entered. Amounts remain CNY in both languages.

## Identity and live updates

- `POST /auth/login` `{ username, password }` → `{ user }`.
- `POST /auth/logout`; `GET /auth/me` → `{ user }`.
- `GET /events`: authenticated SSE, event `change`, data `{ resource, id? }`. Clients refetch authorized data rather than receiving business details in the event.
- `GET /health`: process and database health. `GET /dashboard`: aggregated dashboard data.
- Roles: `admin`, `manager`, `operator`, `quality`, `warehouse`, `viewer`. Shared definitions guide navigation and access intent; the API enforces permissions.

## Production, inventory, and pay

- `GET/POST /products`, `PATCH /products/:id`. Updates require `revision`. Product fields: `{ id, code, name, unit, safetyStock, steps: [{ name, unitPrice, expectedMinutes }] }`.
- `GET/POST /sales-orders`, `GET /sales-orders/:id`. Create with `{ customerId, dueDate?, items: [{ productId, quantity, unitPrice? }], notes? }`.
- `GET/POST /work-orders`, `GET /work-orders/:id`. Create with `{ productId, salesOrderId?, quantity, priority?, dueDate?, notes? }`. Tasks are generated from a snapshot of the product steps. Detail contains `{ ...workOrder, tasks, reports, scraps }`.
- `POST /work-orders/:id/close` `{ reason }`.
- `POST /tasks/:id/receive` `{ workstationId?, quantity?, requestId }` → report; `POST /reports/:id/start`; `POST /reports/:id/complete` `{ quantity, requestId }`; `POST /reports/:id/approve` `{ requestId }`; `POST /reports/:id/reject` and `/reports/:id/resubmit` `{ reason }`.
- `GET /reports`; `GET/POST /scraps`. Scrap creation uses `{ workOrderId, taskId?, reportId?, quantity, reason, responsibleUserId?, requestId }`. Approval and rejection use `POST /scraps/:id/approve` or `/scraps/:id/reject` with `requestId`; approval accepts optional `deductionUnitPrice` and `rewardUnitPrice`, and rejection requires `reason`.
- `GET /inventory`; `GET/POST /stock-movements` `{ productId, salesOrderId?, direction: 'in'|'out', quantity, reason?, requestId }`. Movements are idempotent, cannot make inventory negative, and cannot receive more than the completed quantity available for the order/product. Demo balances are also created through stock movements.
- `GET /payroll` supports month and worker filtering. Approval creates pay entries with a unique source key.
- `GET /material-inventory` returns material and consumable balances. Approved receipt/issue records create actual stock movements and cannot make stock negative.
- `GET /audit-logs`; administrator-only `GET/POST /users` and `PATCH /users/:id`. Password changes use the separate `POST /users/:id/password` action.
- `GET /lookups/users` returns limited IDs and names for selectors, without accounts or pay. Administrators and managers may read all pay, hourly-work, and safety reward/penalty records. Operators may read their own; other roles are denied those records.

The API validates worker ownership, state, and quantity for production actions. Physical completion advances production; report approval confirms piecework pay. Rejection does not reverse physical completion. The next operation opens only when the current operation is fully completed. `goodQuantity` is the target after approved scrap; `completedQuantity` is actual final-operation output. They are not interchangeable.

Each task and selected workstation may have only one active received/working report. A worker can manage several explicitly assigned stations, while unassigned active work remains limited to one report. Partial completion returns the remaining quantity to the same operation. This contract does not provide simultaneous batch splitting across multiple workers on one operation.

## Automatic report approval

- `GET/PATCH /settings/auto-review`: administrators and managers only; returns `{ settings, summary, lastRun }`. `PATCH` requires `revision`, `enabled`, `delayMinutes`, `maxAmount`, `minDurationRatio`, and `requireFullQuantity`. Ratios use 0–1. Settings expose `eligibleFrom`, `activatedAt`, and update actor/time.
- `POST /settings/auto-review/run`: administrators and managers only; returns `{ run }`. It respects the current switch, delay, and rules rather than forcing exceptions through.
- `summary` includes `pendingAutomatic`, `awaitingDelay`, `readyAutomatic`, `manualRequired`, `approvedAutomatically`, and `approvedManually`. `lastRun` includes state, trigger, start/finish times, rule revision, scan/approval/manual/skipped/error counts, and error information.
- Report rows include `approvalMode: null|manual|automatic`, `autoReviewStatus: not_applicable|pending|manual|approved`, Chinese-source `autoReviewReasons`, and `autoReviewEligibleAt`. `reviewMode=manual|pending_auto|automatic` filters manual review, pending automatic review, or automatic approvals respectively.
- The server checks every 60 seconds and at startup. No open browser is required. Manual and automatic approval share the approval transaction and unique pay-source constraint. Manual rejection and exception referral persist through resubmission and rule changes.
- Reports completed before activation are not automatically approved retrospectively. After disabling succeeds, further reports cannot be approved using the previous settings. See [automatic approval](AUTO-REVIEW.md) for defaults and rules.

## Management records

Shared `resourceDefinitions` define each resource key, Chinese source title, group, fields, references, and workflow flag. `GET /catalog` returns the same definitions. Endpoints:

- `GET/POST /resources/:key`.
- `GET/PATCH/DELETE /resources/:key/:id`.
- `POST /resources/:key/:id/transition` `{ action, revision, notes? }`, where `action` is `submit`, `approve`, `reject`, `archive`, or `restore`, subject to the record's permitted transitions.

A record contains `{ id, code?, name, status, data, revision, createdAt, updatedAt }`. The API validates required fields, numbers, options, references, roles, legal states, and reference integrity. Clients cannot set arbitrary statuses. Updates, deletion, and transitions require the current `revision`; deleting a referenced record returns a conflict. Approved records are archived instead of deleted.

Master-data examples (use `GET /catalog` for the complete resource list): `customers`, `suppliers`, `departments`, `materials`, `auxiliary-materials`, `devices`, `workstations`, `molds`, `tools`.

Workflow record examples: `purchase-orders`, `purchase-receipts`, `purchase-issues`, `auxiliary-receipts`, `auxiliary-issues`, `purchase-comparisons`, `reimbursements`, `inspections`, `maintenance-plans`, `maintenance-records`, `inspection-records`, `repair-records`, `mold-maintenance`, `tool-maintenance`, `andon-events`, `safety-incidents`, `safety-checklists`, `safety-training`, `safety-penalties`, `work-tasks`, `work-hours`, `customer-complaints`, `improvements`, `documents`, `contracts`.

The UI builds consistent list, search, edit, and approval views from these definitions. Production uses dedicated interfaces and transaction logic. Management records have the fields and transitions explicitly defined here; a record name does not imply a full purchasing, scheduling, or maintenance-planning engine.

After submission, work tasks and Andon records use `POST /resources/:key/:id/feedback` `{ revision, feedback }` to record handling results. Only the assignee or an administrator/manager may respond. The server writes `result` or `resolution`, plus `feedbackBy` and `feedbackAt`. Approval requires feedback in the current round. Resubmission clears prior feedback credentials; prefilled draft results cannot bypass actual handling.

## Files and equipment

- `POST /files` accepts a multipart `file`, up to 10 MiB per file. Administrators, managers, operators, quality inspectors and warehouse users may upload business files. `GET /files/:id/info` returns metadata; `GET /files/:id` requires authentication to download. Work documents reference persistent files through `attachmentIds`; the API verifies their existence.
- `GET /telemetry/devices` returns latest equipment states, event times, and stale-data indicators. `GET /telemetry/summary?day=YYYY-MM-DD` calculates daily status durations in the factory time zone. `GET /telemetry/devices/:id/events` returns recent event history.
- `POST /telemetry/events` lets administrators/managers record `{ deviceId, status, eventId }`. MQTT ingestion runs on the server; credentials are not sent to the browser. Duplicate events are deduplicated, and late events do not replace a newer current state. See the [equipment protocol](EQUIPMENT.md).
- For actions carrying `requestId`, and equipment events carrying `eventId`, retry with the same key after an uncertain response. Changed parameters represent a different intent and must use a different key.

## Android bridge

Detect native capabilities through `window.MesNative`. Hardware methods:

- `scan(requestId)` emits a `CustomEvent('mes-native')` on `window` with detail `{ requestId, type: 'scan', value?, error? }`.
- `printLabel(requestId, json)` accepts a JSON-encoded label `{ code, productName, quantity, processName? }` and reports with `type: 'print'`.
- `configurePrinter(requestId)` opens printer selection and reports with `type: 'printer'`.

The optional language method is `window.MesNative?.setLanguage?.(locale)`. It returns `void`; the caller supplies no request ID and need not await a response. Native language changes emit `CustomEvent('mes-language', { detail: { locale } })` on `window`, where `locale` is `zh-CN` or `en-US`. Consume this event without echoing another native change. Older containers without `setLanguage` can still use the web language switch independently.

The current Android container initializes `mes.locale` in web local storage from its native preference, defaulting to `zh-CN`, before page scripts run. Web language changes update the native preference for subsequent launches. Native changes synchronize without reloading the page.

Bridge messages are encoded safely and accepted only from the configured HTTPS origin and main frame. External sites do not receive bridge access. Camera or Bluetooth permission denial has a recoverable error path. The community Android build does not include a vendor printer SDK; printing requires the optional vendor build and separately supplied licensed dependencies. Physical scanning and printing require device acceptance testing. See the [Android guide](../apps/android/README.md).

Update this contract when public behavior changes. Do not silently infer compatibility with unlisted request or response shapes.

## People, reporting and restricted files

- Administrator-only `GET /permissions` returns assignable permission keys. User `allowedPermissions` and `deniedPermissions` use these stable keys; denial wins and administrators retain recovery access. Grants do not bypass ownership, state or quantity checks.
- Managers may read basic members through `GET /users` and `/users/:id`; `profile` is administrator-only. Creation, access changes and archiving remain administrator-only. `DELETE /users/:id` archives the account and revokes sessions while retaining business history. It refuses the current account, last administrator and workers with active production reports.
- `POST /auth/refresh` rotates the session and invalidates the old token. `GET /auth/options` returns `{smsLogin}`. `/auth/sms/request` accepts `{mobile}` and `/auth/sms/login` accepts `{mobile,code}`. Configure gateways as documented for deployment; codes are never returned by the API.
- `POST /files?purpose=personnel` is administrator-only. Both metadata and bytes are restricted, and personnel files cannot be referenced as ordinary business attachments. The default purpose is `business`.
- `POST /payroll/adjustments` accepts `{requestId,workerId,quantity,unitPrice,workDate,reason}`. Positive/negative rates increase/decrease pay through a separate source entry, without editing earlier wages.
- `GET /statistics?from=YYYY-MM-DD&to=YYYY-MM-DD&view=...` supports `production`, `scrap`, `stock-in`, `stock-out`, `products`, `orders`, `order-items`, `procedures`, `workers`, and `tasks`. Production/scrap use approval dates of approved records in the factory time zone. Task `group` supports `procedure/workstation/worker/device`; procedure and order-line reports accept `productId/salesOrderId`.
- `GET /inventory/alerts` returns safety-stock shortfalls and aged quantities (current stock minus receipts inside the configured period, floored at zero). `GET /boards?view=...` provides production, equipment, station, stock, materials, quality/incoming/equipment inspection, quality/outstanding-task summaries and movement views, enforcing their read permissions.
- Public read-only `GET /android/latest` returns the highest published `{versionCode,versionName,downloadUrl,remark}` or `null`. Download URLs require HTTPS; account information is never returned.

The field and execution metadata returned by `GET /catalog` and record details describe available actions and states for added workflows. See [feature coverage](FEATURES.md).


## Management execution

`GET /resources/:key/:id/activity` returns `{record,actions,events,items,payments,learners,related,notifications,receipts,receiptsComplete,total,canExecute}`. Each action is `{action,label,fields}`, filtered by state, per-user permissions and assignment. `fields` follows shared FieldDefinition metadata; Chinese source labels are translated by the UI.

`POST /resources/:key/:id/actions/:action` accepts `{revision,data}`. Data must match the action fields; success returns the updated record. Use its new revision for the next request; stale revisions return 409. `check-item` uses `{itemId,result,attachmentIds?}`. `stage` and `workflowData` are server-owned. Actions cover payment requests/review/payment, actual completion/confirmation, item checks, learning acknowledgements, lifecycle changes and inventory reversal. The write endpoint revalidates permissions and prerequisites.

## Production workflow extensions

All paths below are relative to `/api`, use the existing session/CSRF/permission policy, and return camelCase. UUID references are validated. Mutation errors roll back the whole transaction. Chinese source labels and English translations are available in the Web UI; entered names, instructions and notes are retained verbatim.

- Products: existing POST/PATCH `/products[/:id]` now accept `details:{typeId?,materialId?,model?,unitWeight?,drawingIds?,customerIds?,safetyStockDays?}`; unitWeight is grams. `steps` additionally accept `procedureTypeId?,deductionUnitPrice?,rewardUnitPrice?,autoComplete?,operationGuide?,inspectionGuide?,attachmentIds?`. File references must use business visibility. Product and route changes do not rewrite task snapshots. POST `/products/:id/archive|restore` preserves referenced history and toggles eligibility for new work.
- Procedure types: GET/POST `/production/procedure-types`, PATCH `/production/procedure-types/:id`, fields `code,name,active`; deactivation preserves references. Qualifications: GET `/production/qualifications`; PUT `/production/qualifications/:userId/:typeId` with `active,validUntil?` (inclusive date, or null).
- Routes: GET `/production/routes?productId=UUID`; POST `/production/routes` with `productId:UUID|null,name,steps`; PATCH `/:id` requires `revision` and supports `active`. Null product means a shared route. Work-order POST optionally accepts `routeId`, otherwise it snapshots default product steps. GET `/work-orders` supports exact `salesOrderId` and `productId` filters alongside pagination/q/status.
- Work-order lifecycle: existing POST `/work-orders/:id/close` requires reason and no active reports/pending scraps. DELETE `/work-orders/:id` only removes untouched pending orders with no reports or scraps.
- Task assignment: PATCH `/tasks/:id/assignment` with nullable `workerId,workstationId,deviceId`, only for ready/blocked tasks in active work orders. Typed steps require an active unexpired worker qualification and a matching configured station at receipt. Assignment fields become explicit receive constraints. Device lifecycle/fault/maintenance checks apply. Untyped old routes remain compatible with optional workstation.
- Receipt/correction: POST `/tasks/:id/receive` retains `quantity?,workstationId?,requestId`, adds `workerId?,forceComplete?,reason?`. Acting for another worker or `forceComplete:true` requires manager permission; correction requires a reason. Force-complete and configured `autoComplete` record receipt plus completion atomically with audit/idempotency and leave wage review manual. They do not bypass qualifications or device eligibility. A worker can hold simultaneous reports on **different** workstations; each workstation and each task still allows one active report. A worker may have only one active report without a workstation. A typed task requires workstation duty for normal receipt; manager correction may bypass the own-duty requirement but not a disabled/busy station.
- Stations: GET `/production/stations` returns active station state/current worker/report/device. PATCH `/production/stations/:id/config` accepts nullable `procedureTypeId,deviceId` and `idleThresholdMinutes` 1..1440 (default 60); only while off duty and not busy, device assignment exclusive. POST actions `on-duty|off-duty|force-off-duty|enable|disable` use optional reason (force requires it); ordinary duty actions apply to the current worker, busy departure/disable/reconfiguration forbidden. GET `/production/station-logs?stationId=UUID` returns append-only state events and closed/open `no_material` intervals, `durationMinutes` only for no-material, and `thresholdExceeded`. This is local continuous idle evidence; it does not promise external notification. Alarm contacts/local outbox belong to management Andon APIs.
- Reports: GET `/reports` supports `workerId,workOrderId,taskId,reviewMode`; operators remain restricted to their own reports. GET `/reports/:id` has the same own-report constraint. POST `/reports/batch-review` accepts unique `ids` (1..100), `action:'approve'|'reject'`, and `reason` (required for reject). All records must be complete; the batch is atomic and uses the same approval/payroll rules as individual review. Existing report start/complete/approve/reject/resubmit remain.
- Equipment evidence: migration 104 adds nullable `reports.device_metrics`. Normal completion, manager completion and configured automatic completion freeze linked device identity/configuration and exact equipment-window totals in the completion transaction. Payload includes version, windowBoundary `[from,to)`, deviceId/code/name, from/to, per-state seconds and unknown seconds, known/total/powered/running seconds, percentages/counts, power-on/shutdown/effective operating count, operatingPieces, configuredPieceScale and cyclePieceScales. Running cycles completing in the half-open window count using their event piece_scale; time is clipped to report start/end. Unknown time is never converted to offline. Later configuration changes, delayed telemetry, retries or review do not rewrite the snapshot. Pre-feature reports and unlinked devices have null snapshots. This is evidence, not an automatic override of reported good quantity or payroll.
- Scrap types: GET/POST `/production/scrap-types`, PATCH `/:id` with `code,name,deductible,active`. Settings GET/PATCH `/production/settings` uses optimistic `revision, scrapAutoReview, scrapMaxAmount` (CNY).
- Scrap: POST `/scraps` adds optional `scrapTypeId,responsibleReportId` alongside discovery `reportId`. Responsibility and discovery must belong to the same work order; report ownership restrictions remain for operators. Responsible/discovery unit rates derive from snapshotted tasks when a deductible type is selected. Auto approval only when enabled, the actor is the responsible worker, discovery and responsibility identify the same report, the category is deductible, a positive deduction rate exists, and the amount is within the configured cap; all other cases remain pending with a reason. `/scraps/:id/approve` supports optional `responsibleReportId,deductionUnitPrice,rewardUnitPrice`; nonzero explicit price overrides require manager permission. Discovery reward belongs to the discovery report's worker (fallback recording actor only without a report), never a responsible worker rewarding themselves. Later responsible scrap reduces report `completeAdjustment`; already-approved piece wages receive an append-only negative `piece-adjustment`. Pending wage approval uses quantity+completeAdjustment. These changes and scrap wage entries are atomic and idempotent. GET `/scraps` supports `workOrderId,reportId,responsibleReportId`.
- Sales orders: POST accepts `name,priority:'normal'|'urgent'` and item notes. PATCH `/sales-orders/:id` takes `revision,customerId,name?,priority?,dueDate?,notes?,items:[{productId,quantity,unitPrice,notes?}]` as the desired full line list. Open orders only; quantities cannot fall below allocated good/shipped quantities; referenced lines cannot be removed. POST `/:id/copy-items` uses `sourceOrderId,itemIds?,revision`; matching product quantities merge, existing target prices stay intact. POST `/:id/complete` requires all items shipped and no active work orders; POST `/:id/close` requires reason and no active work orders. DELETE `/:id` only succeeds with no production/stock history. These operations are audited; ended orders are immutable.
