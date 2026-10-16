import { createApp } from "../apps/api/src/app.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool, transaction, digest } from "../apps/api/src/db.js";
import { migrate } from "../apps/api/src/migrate.js";
import { ingestDeviceEvent } from "../apps/api/src/integrations.js";
import {
  bindDevice,
  decodeDeviceMessage,
  deviceHistory,
  deviceStatistics,
  recordDeviceStatus,
  reportEquipmentSnapshot,
} from "../apps/api/src/equipment.js";

test("equipment protocol accepts legacy lamps and rejects ambiguous identities/statuses", () => {
  assert.equal(
    decodeDeviceMessage("device/send/D-1", '{"RGY":3}').status,
    "running",
  );
  assert.equal(
    decodeDeviceMessage("device/send/D-1", '{"status":"idle","RGY":2}')
      .deviceNo,
    "D-1",
  );
  for (const data of [
    '{"RGY":"3"}',
    '{"RGY":4}',
    '{"status":"idle","RGY":3}',
    '{"status":"idle","deviceNo":"OTHER"}',
    "[]",
    "null",
  ])
    assert.throws(() => decodeDeviceMessage("device/send/D-1", data));
  assert.throws(() => decodeDeviceMessage("device/send/+", '{"RGY":1}'));
  assert.throws(() =>
    decodeDeviceMessage("device/send/D-1", " ".repeat(16385)),
  );
});

const url = process.env.EQUIPMENT_TEST_DATABASE_URL;
test(
  "equipment parity uses an independent PostgreSQL database",
  {
    skip: !url
      ? "Set EQUIPMENT_TEST_DATABASE_URL to a dedicated *_equipment_parity_test database"
      : false,
  },
  async (t) => {
    assert.ok(
      url && new URL(url).pathname.endsWith("_equipment_parity_test"),
      "Dedicated equipment parity database required",
    );
    const pool = createPool(url);
    const owner = randomUUID();
    const ids: string[] = [];
    const device = async (data: Record<string, unknown> = {}) => {
      const id = randomUUID();
      ids.push(id);
      await pool.query(
        "INSERT INTO records(id,resource,code,name,status,data,created_by) VALUES($1,'devices',$2,'Equipment parity','active',$3,$4)",
        [id, `EQ-${id}`, data, owner],
      );
      return id;
    };
    const event = (
      deviceId: string,
      status: any,
      at: string,
      eventId = randomUUID(),
    ) =>
      ingestDeviceEvent(
        pool,
        { deviceId, status, occurredAt: at, eventId },
        "manual",
        owner,
      );
    try {
      await migrate(pool);
      await pool.query(
        "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,'Equipment test','not-a-login','admin')",
        [owner, `eq-${owner}`],
      );
      await t.test(
        "range clips exact boundaries and attributes overnight cycles to completion day",
        async () => {
          const id = await device({ pieceScale: 3 });
          await event(id, "offline", "2026-01-01T23:00:00Z");
          await event(id, "idle", "2026-01-02T00:00:00Z");
          await event(id, "running", "2026-01-02T23:00:00Z");
          await event(id, "idle", "2026-01-03T01:00:00Z");
          await event(id, "offline", "2026-01-04T00:00:00Z");
          const result = await deviceStatistics(
            pool,
            { from: "2026-01-02", to: "2026-01-03", deviceId: id },
            "UTC",
          );
          assert.equal(result.total, 2);
          assert.equal(result.totals.totalSeconds, 172800);
          assert.equal(result.totals.powerOnCount, 1);
          assert.equal(result.totals.shutdownCount, 0);
          assert.equal(result.items[0].seconds.running, 3600);
          assert.equal(result.items[1].seconds.running, 3600);
          assert.equal(result.items[0].effectiveOperatingCount, 0);
          assert.equal(result.items[1].effectiveOperatingCount, 1);
          assert.equal(result.totals.operatingPieces, 3);
          assert.equal(result.totals.seconds.unknown, 0);
          assert.equal(
            Object.values(result.totals.seconds).reduce((a, b) => a + b, 0),
            172800,
          );
        },
      );
      await t.test(
        "snapshot scales survive configuration edits and repeated status never creates cycles",
        async () => {
          const id = await device({ pieceScale: 2 });
          await event(id, "running", "2026-02-01T00:00:00Z");
          await event(id, "running", "2026-02-01T01:00:00Z");
          await event(id, "idle", "2026-02-01T02:00:00Z", "completed");
          await pool.query(
            "UPDATE records SET data=data||'{\"pieceScale\":9}'::jsonb WHERE id=$1",
            [id],
          );
          const duplicate = await event(
            id,
            "idle",
            "2026-02-01T02:00:00Z",
            "completed",
          );
          assert.equal(duplicate.duplicate, true);
          await assert.rejects(() =>
            event(id, "fault", "2026-02-01T02:00:00Z", "completed"),
          );
          const result = await deviceStatistics(
            pool,
            { from: "2026-02-01", to: "2026-02-01", deviceId: id },
            "UTC",
          );
          assert.equal(result.totals.effectiveOperatingCount, 1);
          assert.equal(result.totals.operatingPieces, 2);
          assert.equal(result.totals.counts.running, 0);
          const history = await deviceHistory(pool, {
            deviceId: id,
            status: "idle",
            durationMin: 7200,
            durationMax: 7200,
          });
          assert.equal(history.total, 1);
          assert.equal(history.items[0].duration, 7200);
        },
      );
      await t.test(
        "late events recompute historical transitions without rolling current state backward",
        async () => {
          const id = await device();
          await event(id, "offline", "2026-03-01T00:00:00Z");
          await event(id, "idle", "2026-03-01T04:00:00Z");
          const late = await event(id, "running", "2026-03-01T02:00:00Z");
          assert.equal(late.applied, false);
          const result = await deviceStatistics(
            pool,
            { from: "2026-03-01", to: "2026-03-01", deviceId: id },
            "UTC",
          );
          assert.equal(result.totals.seconds.running, 7200);
          assert.equal(result.totals.effectiveOperatingCount, 1);
          assert.equal(
            (
              await pool.query(
                "SELECT status FROM device_states WHERE device_id=$1",
                [id],
              )
            ).rows[0].status,
            "idle",
          );
        },
      );
      await t.test(
        "DST days use real timezone seconds and no-data time stays unknown",
        async () => {
          const id = await device();
          const spring = await deviceStatistics(
            pool,
            { from: "2026-03-08", to: "2026-03-08", deviceId: id },
            "America/Los_Angeles",
          );
          assert.equal(spring.totals.totalSeconds, 23 * 3600);
          assert.equal(spring.totals.seconds.unknown, 23 * 3600);
          assert.equal(spring.totals.powerOnCount, 0);
          const fall = await deviceStatistics(
            pool,
            { from: "2025-11-02", to: "2025-11-02", deviceId: id },
            "America/Los_Angeles",
          );
          assert.equal(fall.totals.totalSeconds, 25 * 3600);
          for (const query of [
            { from: "2099-01-01", to: "2099-01-01" },
            { from: "2026-01-02", to: "2026-01-01" },
            { from: "2025-01-01", to: "2026-02-01" },
            { from: "2026-02-30", to: "2026-02-30" },
          ])
            await assert.rejects(() =>
              deviceStatistics(pool, { ...query, deviceId: id }, "UTC"),
            );
        },
      );
      await t.test(
        "manual maintenance and lifecycle holds resist lamp overwrite and transaction rollback",
        async () => {
          const id = await device();
          await event(id, "maintenance", "2026-04-01T00:00:00Z");
          const ignored = await ingestDeviceEvent(
            pool,
            { deviceId: id, status: "running", eventId: "lamp" },
            "mqtt",
            null,
          );
          assert.equal(ignored.suppressed, true);
          assert.equal(
            (
              await pool.query(
                "SELECT status FROM device_states WHERE device_id=$1",
                [id],
              )
            ).rows[0].status,
            "maintenance",
          );
          await assert.rejects(() =>
            transaction(pool, async (db) => {
              await recordDeviceStatus(db, id, "idle", owner, "rollback");
              throw new Error("rollback");
            }),
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*) AS n FROM device_events WHERE device_id=$1",
                [id],
              )
            ).rows[0].n,
            1,
          );
          await transaction(pool, (db) =>
            recordDeviceStatus(db, id, "idle", owner, "resume"),
          );
          const heartbeat = await ingestDeviceEvent(
            pool,
            { deviceId: id, status: "idle" },
            "mqtt",
            null,
          );
          assert.equal(heartbeat.heartbeat, true);
        },
      );
      await t.test(
        "binding is unique, cross-code conflicts are blocked, and disabled collection does not alter state",
        async () => {
          const id = await device(),
            other = await device();
          await transaction(pool, (db) =>
            bindDevice(
              db,
              id,
              { deviceNo: "SENSOR-PARITY", networked: true, pieceScale: 1.5 },
              owner,
            ),
          );
          await assert.rejects(() =>
            transaction(pool, (db) =>
              bindDevice(
                db,
                other,
                { deviceNo: "SENSOR-PARITY", networked: true, pieceScale: 1 },
                owner,
              ),
            ),
          );
          await assert.rejects(() =>
            transaction(pool, (db) =>
              bindDevice(
                db,
                other,
                { deviceNo: `EQ-${id}`, networked: true, pieceScale: 1 },
                owner,
              ),
            ),
          );
          const result = await ingestDeviceEvent(
            pool,
            decodeDeviceMessage("device/send/SENSOR-PARITY", '{"RGY":3}'),
            "mqtt",
            null,
          );
          assert.equal(result.deviceId, id);
          await transaction(pool, (db) =>
            bindDevice(
              db,
              id,
              { deviceNo: "SENSOR-PARITY", networked: false, pieceScale: 1.5 },
              owner,
            ),
          );
          const ignored = await ingestDeviceEvent(
            pool,
            { deviceNo: "SENSOR-PARITY", status: "fault" },
            "mqtt",
            null,
          );
          assert.equal(ignored.suppressed, true);
        },
      );
      await t.test(
        "transition history filters by timestamps/state/duration and paginates deterministic rows",
        async () => {
          const id = await device();
          await event(id, "offline", "2026-05-01T00:00:00Z");
          await event(id, "running", "2026-05-01T01:00:00Z");
          await event(id, "idle", "2026-05-01T01:30:00Z");
          const filtered = await deviceHistory(pool, {
            deviceId: id,
            previousStatus: "running",
            from: "2026-05-01T01:30:00Z",
            to: "2026-05-01T02:00:00Z",
            durationMin: 1800,
            durationMax: 1800,
          });
          assert.equal(filtered.total, 1);
          assert.equal(filtered.items[0].status, "idle");
          const page = await deviceHistory(pool, {
            deviceId: id,
            page: 2,
            pageSize: 1,
          });
          assert.equal(page.total, 3);
          assert.equal(page.items[0].status, "running");
        },
      );
      await t.test(
        "precise report windows clip partial states and freeze event-scale pieces without inventing unknown downtime",
        async () => {
          const id = await device({ pieceScale: 2 });
          await event(id, "running", "2026-06-01T23:00:00Z");
          await event(id, "idle", "2026-06-02T00:30:00Z");
          await pool.query(
            "UPDATE records SET data=data||'{\"pieceScale\":3.5}'::jsonb WHERE id=$1",
            [id],
          );
          await event(id, "running", "2026-06-02T00:45:00Z");
          await event(id, "idle", "2026-06-02T01:00:00Z");
          await event(id, "offline", "2026-06-02T01:30:00Z");
          const frozen = await transaction(pool, (db) =>
            reportEquipmentSnapshot(
              db,
              id,
              "2026-06-02T00:00:00Z",
              "2026-06-02T02:00:00Z",
            ),
          );
          assert.equal(frozen.totalSeconds, 7200);
          assert.equal(frozen.runningSeconds, 2700);
          assert.equal(frozen.powerOnSeconds, 5400);
          assert.equal(frozen.shutdownSeconds, 1800);
          assert.equal(frozen.effectiveOperatingCount, 2);
          assert.equal(frozen.operatingPieces, 5.5);
          assert.deepEqual(frozen.cyclePieceScales, [2, 3.5]);
          assert.equal(frozen.deviceName, "Equipment parity");
          assert.equal(frozen.configuredPieceScale, 3.5);
          const exact = await reportEquipmentSnapshot(
            pool,
            id,
            "2026-06-02T00:30:00Z",
            "2026-06-02T01:00:00Z",
          );
          assert.equal(exact.effectiveOperatingCount, 1);
          assert.equal(exact.operatingPieces, 2);
          assert.equal(exact.runningSeconds, 900);
          await pool.query(
            "UPDATE records SET name='Renamed equipment',data=data||'{\"pieceScale\":9}'::jsonb WHERE id=$1",
            [id],
          );
          await event(id, "fault", "2026-06-02T00:15:00Z");
          assert.equal(frozen.deviceName, "Equipment parity");
          assert.equal(frozen.operatingPieces, 5.5);
          assert.equal(frozen.runningSeconds, 2700);
          const noData = await device();
          const unknown = await reportEquipmentSnapshot(
            pool,
            noData,
            "2026-06-02T00:00:00Z",
            "2026-06-02T01:00:00Z",
          );
          assert.equal(unknown.seconds.unknown, 3600);
          assert.equal(unknown.shutdownSeconds, 0);
          assert.equal(unknown.nonRunningKnownSeconds, 0);
          const empty = await reportEquipmentSnapshot(
            pool,
            noData,
            "2026-06-02T00:00:00Z",
            "2026-06-02T00:00:00Z",
          );
          assert.equal(empty.totalSeconds, 0);
          await assert.rejects(() =>
            reportEquipmentSnapshot(
              pool,
              id,
              "2026-06-02T01:00:00Z",
              "2026-06-02T00:00:00Z",
            ),
          );
        },
      );
      await t.test(
        "report snapshots retain all seven states and exclude faults from completed cycle production",
        async () => {
          const id = await device();
          for (const [status, at] of [
            ["offline", "2026-07-01T23:00:00Z"],
            ["idle", "2026-07-02T00:30:00Z"],
            ["running", "2026-07-02T01:00:00Z"],
            ["fault", "2026-07-02T01:30:00Z"],
            ["maintenance", "2026-07-02T02:00:00Z"],
            ["deactivated", "2026-07-02T02:30:00Z"],
            ["scrapped", "2026-07-02T03:00:00Z"],
            ["offline", "2026-07-02T03:30:00Z"],
          ])
            await event(id, status, at);
          const snapshot = await reportEquipmentSnapshot(
            pool,
            id,
            "2026-07-02T00:00:00Z",
            "2026-07-02T04:00:00Z",
          );
          assert.equal(snapshot.totalSeconds, 14400);
          assert.equal(snapshot.knownSeconds, 14400);
          assert.equal(snapshot.seconds.offline, 3600);
          assert.equal(snapshot.seconds.unknown, 0);
          for (const status of [
            "idle",
            "running",
            "fault",
            "maintenance",
            "deactivated",
            "scrapped",
          ] as const) {
            assert.equal(snapshot.seconds[status], 1800);
            assert.equal(snapshot.counts[status], 1);
          }
          assert.equal(snapshot.powerOnSeconds, 5400);
          assert.equal(snapshot.nonRunningKnownSeconds, 12600);
          assert.equal(snapshot.effectiveOperatingCount, 0);
          assert.equal(snapshot.operatingPieces, 0);
        },
      );
      await t.test(
        "telemetry endpoints enforce sessions, read/write overrides and binding revisions",
        async () => {
          const app = await createApp({
            pool,
            origins: ["http://equipment.test"],
          });
          const token = randomUUID();
          const id = await device();
          await pool.query(
            "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
            [digest(token), owner],
          );
          const headers = {
            cookie: `mes_session=${token}`,
            origin: "http://equipment.test",
          };
          try {
            assert.equal(
              (
                await app.inject({
                  method: "GET",
                  url: "/api/telemetry/devices",
                })
              ).statusCode,
              401,
            );
            await pool.query("UPDATE users SET role='viewer' WHERE id=$1", [
              owner,
            ]);
            assert.equal(
              (
                await app.inject({
                  method: "GET",
                  url: "/api/telemetry/devices",
                  headers,
                })
              ).statusCode,
              200,
            );
            assert.equal(
              (
                await app.inject({
                  method: "POST",
                  url: "/api/telemetry/events",
                  headers,
                  payload: { deviceId: id, status: "idle" },
                })
              ).statusCode,
              403,
            );
            await pool.query(
              "UPDATE users SET allowed_permissions=ARRAY['telemetry:write'] WHERE id=$1",
              [owner],
            );
            assert.equal(
              (
                await app.inject({
                  method: "POST",
                  url: "/api/telemetry/events",
                  headers,
                  payload: { deviceId: id, status: "idle" },
                })
              ).statusCode,
              200,
            );
            const before = (
              await pool.query("SELECT revision FROM records WHERE id=$1", [id])
            ).rows[0].revision;
            const binding = await app.inject({
              method: "PATCH",
              url: `/api/telemetry/devices/${id}/binding`,
              headers,
              payload: {
                deviceNo: `AUTH-${id}`,
                networked: true,
                pieceScale: 2,
              },
            });
            assert.equal(binding.statusCode, 200, binding.body);
            assert.equal(binding.json().revision, before + 1);
            await pool.query(
              "UPDATE users SET denied_permissions=ARRAY['telemetry:read','telemetry:write'] WHERE id=$1",
              [owner],
            );
            assert.equal(
              (
                await app.inject({
                  method: "GET",
                  url: "/api/telemetry/events",
                  headers,
                })
              ).statusCode,
              403,
            );
            assert.equal(
              (
                await app.inject({
                  method: "POST",
                  url: "/api/telemetry/events",
                  headers,
                  payload: { deviceId: id, status: "running" },
                })
              ).statusCode,
              403,
            );
          } finally {
            await app.close();
          }
        },
      );
      await t.test(
        "concurrent binding requests cannot assign the same collection identity",
        async () => {
          const left = await device(),
            right = await device(),
            deviceNo = `RACE-${randomUUID()}`;
          const results = await Promise.allSettled(
            [left, right].map((id) =>
              transaction(pool, (db) =>
                bindDevice(
                  db,
                  id,
                  { deviceNo, networked: true, pieceScale: 1 },
                  owner,
                ),
              ),
            ),
          );
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT id FROM records WHERE data->>'deviceNo'=$1",
                [deviceNo],
              )
            ).rowCount,
            1,
          );
        },
      );
    } finally {
      await pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [owner]);
      await pool.query(
        "DELETE FROM device_events WHERE device_id=ANY($1::uuid[])",
        [ids],
      );
      await pool.query(
        "DELETE FROM device_states WHERE device_id=ANY($1::uuid[])",
        [ids],
      );
      await pool.query("DELETE FROM records WHERE id=ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM users WHERE id=$1", [owner]);
      await pool.end();
    }
  },
);
