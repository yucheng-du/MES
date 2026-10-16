# Testing

[简体中文](TESTING.zh-CN.md) · [Project README](../README.md)

Run commands from the repository root unless stated otherwise. Install dependencies with `npm ci`, and use Node.js 22.13+.

## Types, build, and frontend units

```bash
npm run typecheck
npm run build
npm run test:web
```

Type checks cover the API, web application, and shared package. The build checks the API and creates the production web bundle. Frontend unit tests cover request retries and idempotency, paginated options, equipment events, and automatic approval form and presentation logic.

## Database tests

Use PostgreSQL 17 and configure `.env` with a dedicated connection such as:

```dotenv
TEST_DATABASE_URL=postgres://mes:change_me@127.0.0.1:5432/mes_test
EQUIPMENT_TEST_DATABASE_URL=postgres://mes:change_me@127.0.0.1:5432/mes_equipment_parity_test
```

Create the database and replace the example credentials before running. `npm run db:local` can create a local development cluster and test database as described in the README.

```bash
npm test
npm run test:integrations
```

The scripts load `.env`. A test database URL must be explicitly set and its database name must end in `_test`. The API suite **drops and recreates the public schema**, and resets data between cases. The suffix guard does not make a valuable database safe: use a database reserved only for these tests. Run the database suites sequentially, not concurrently against the same database.

Coverage includes authentication and role checks, process snapshots, partial completion, concurrent receipt, order-scoped inventory, duplicate requests, transaction rollback, scrap, payroll sources, attachments, account deactivation, and task feedback. Automatic approval cases exercise delay and activation boundaries, manual handoff, resubmission, concurrency, failure recovery, pagination, startup, and shutdown. Equipment integration checks use real PostgreSQL for duplicate and conflicting messages, late events, heartbeats, daily boundaries, and unknown periods.

## Browser workflows

Browser tests require a **separate development server with seeded demo users**. They do not start the application automatically and do not use `TEST_DATABASE_URL` to choose the server's database.

Follow the README to configure a development database, run migrations and seed, then start the server in a separate terminal:

```bash
npm run dev
```

In the test terminal:

```bash
npx playwright install chromium
npm run test:e2e
```

The default target is `http://127.0.0.1:5173`. To use another isolated development instance:

```bash
MES_BASE_URL=http://127.0.0.1:5174 npm run test:e2e
```

The instance must serve both the web application and its `/api` proxy at that origin, accept the origin in `APP_ORIGIN`, and use the demo accounts. Tests create users, customers, products, work orders, reports, stock movements, and other records, and exercise automatic approval settings. They may leave test records behind. Never target a production URL or a database containing data you need to preserve.

Workflow coverage includes production through pay and shipment, read-only access, file uploads, response-loss retries, task feedback, temporary connection failure, large option lists, and server-side automatic approval. The worker scenario waits for a real scheduled check with browser pages closed and can take longer than a normal page test.

Playwright retains screenshots and traces on failure; the HTML report is written to `playwright-report/`. These artifacts can contain business data and should not be committed or shared without review.

## Language and layout checks

For UI changes, exercise both Chinese and English on desktop and a narrow mobile viewport. Check login and header switching, persistence after refresh, forms that remain open during a switch, validation, notifications, status labels, and dynamic quantities. Confirm that user-entered data remains unchanged and that amounts remain CNY. Check drawers, tables, menus, and automatic approval settings for clipped labels or page-level horizontal overflow.

## Android

From `apps/android`:

```bash
./scripts/build-debug.sh
```

The default community build compiles without private printer binaries and runs its unit tests and lint checks. The optional vendor build requires locally supplied SDKs and explicit selection. See the [Android guide](../apps/android/README.md) for toolchain and build commands.

## Verification boundaries

Automated checks cover representative business flows and constraints. They do not verify every factory's operating procedure. A successful build or unit test is not evidence of actual camera scanning, Bluetooth pairing, printed labels, MQTT broker connectivity, or cloud recovery.

Before deployment, verify the Compose stack, HTTPS issuance, backup restoration, and relevant business flows in the intended environment. Hardware acceptance requires the actual Android device, printer, label stock, and equipment integration. Keep these results separate from automated test output; do not treat a prior local run as acceptance of a new deployment.

## Extended workflow checks

Equipment extensions use a separate `EQUIPMENT_TEST_DATABASE_URL`, whose database name must end in `_equipment_parity_test`; other database tests use `TEST_DATABASE_URL`. Both databases are disposable and their schemas are rebuilt. The local helper preserves an existing `.env`; add the equipment connection from `.env.example` when upgrading.

Added tests cover route selection and assignment, qualifications and station shifts, sales lines and archive guards, responsible scrap and pay attribution, multi-line purchasing and partial payments, checklist execution, safety exams, per-user permissions and restricted attachments, SMS challenges, report date rules, aged stock, equipment time/state aggregation, Android file bridges, and actual PDF rendering. Browser tests also verify that language changes preserve the page URL, open forms and entered values.

`tests/project-site.spec.ts` builds and serves the static introduction itself. It checks no-navigation switching, persisted selection and mobile layout. The publishing workflow deploys the introduction only after successful main-branch CI.
