# Features and validation scope

[简体中文](FEATURES.zh-CN.md) · [README](../README.md)

MES preserves the core production workflow and adds dedicated operations for the management domains below. A form or menu alone is not evidence that a workflow is complete: the linked tests exercise state transitions and their database effects.

| Area                       | Available operations                                                                                                                                                                    | Automated evidence                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Products and routes        | Product attributes and drawings, multiple shared/product routes, typed steps, instructions, immutable order snapshots, archive/restore                                                  | `production-parity.test.ts`, `production-parity.spec.ts`       |
| Sales and work orders      | Order editing, line changes/copying, fulfillment/closure, guarded deletion, task assignments and qualification expiry                                                                   | Production parity and existing business/browser suites         |
| Shop floor                 | Station configuration, on/off duty, worker/station/device assignment, receipt/start/partial completion, idle intervals, manager corrections                                             | Production parity and existing business/browser suites         |
| Quality and pay            | Manual/batch/automatic review, scrap types and responsibility, conditional self-scrap approval, discovery rewards and wage reversals, hourly pay, manual signed adjustments             | Production, management and administration database suites      |
| Purchasing                 | Material lines, quotations, contracts, partial payment requests/approval/payment, receipts/issues, expense limits and reimbursement confirmation                                        | `management-parity.test.ts`, `management-parity.spec.ts`       |
| Equipment and maintenance  | Seven states, unique collection bindings, interval/daily statistics, transition history, templates and per-item maintenance/inspection completion, repair, mold/tool lifecycle          | Equipment integration and management suites                    |
| Work and safety            | Assigned task progress, hourly-work application/approval/completion/confirmation, complaints and improvements, checklist executions, learning and scored exams                          | Management database/browser suites                             |
| Andon                      | Station contacts with escalation delays, response and resolution, local alarm timeline, optional deduplicated HTTPS notifications                                                       | Management database suite with a fake delivery adapter         |
| People and access          | Department/job/contact profile, restricted personnel attachments, per-user grants/denials, own password, account archive, session revocation, optional SMS login                        | `administration.test.ts`, `administration.spec.ts`             |
| Stock and reports          | Order-specific finished stock, materials/consumables, shortage and aged-stock alerts, approved-date production/scrap reports, process/order/item/pay summaries, CSV export, live boards | Administration and existing inventory suites                   |
| Documents and Android      | Authenticated image/text/PDF preview, pagination and zoom, same-origin PDF resources, file/photo upload and save, QR/torch, update confirmation and optional vendor printing            | Equipment browser tests and Android unit/build/lint checks     |
| Languages and introduction | Same-page Chinese/English switching, preserved forms and stored language, responsive app, independent GitHub Pages introduction                                                         | `i18n.spec.ts`, `project-site.spec.ts`, workflow browser tests |

The tests live in `apps/api/test/` and `tests/`. See [test setup](TESTING.md) and the CI run for the commit you deploy.

## Deliberate behavior changes

- Archived or financially effective records keep their history; reversal and guarded closure replace destructive deletion where required. A stale revision is rejected.
- Approval, stock changes and pay are transactional and idempotent. A manager entering a report does not become the worker receiving its discovery reward.
- Reports use approval dates for approved production and scrap summaries. Unobserved equipment time remains unknown. Language does not alter amounts, stored business data or currency.
- Credentials stay on the server. There is no public test-user/admin backdoor, plaintext-code viewer, browser-visible MQTT password, or arbitrary server upload/deployment endpoint. Administrator creation and deployment use documented local commands and CI.

## Environment-dependent acceptance

Automated tests use synthetic records and fake notification providers. Actual SMS/Andon delivery requires configured services; camera, printer, Bluetooth and physical equipment require their real devices. A community Android build cannot include a proprietary printer SDK; the optional vendor build needs separately licensed local files. Existing factory data needs a separately planned import and reconciliation. A static project website is not a hosted MES production installation.
