import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool } from "../apps/api/src/db.js";
import { migrate } from "../apps/api/src/migrate.js";
import {
  deviceSummary,
  ingestDeviceEvent,
} from "../apps/api/src/integrations.js";

test("设备重复事件、乱序、心跳与跨日统计使用真实 PostgreSQL", async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(
    url && new URL(url).pathname.endsWith("_test"),
    "只允许明确的 _test 数据库",
  );
  const pool = createPool(url);
  const userId = randomUUID(),
    deviceId = randomUUID();
  try {
    await migrate(pool);
    await pool.query(
      "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,'设备测试','not-a-login','admin')",
      [userId, `test-${userId}`],
    );
    await pool.query(
      "INSERT INTO records(id,resource,code,name,status,created_by) VALUES($1,'devices',$2,'测试设备','active',$3)",
      [deviceId, `TEST-${deviceId}`, userId],
    );
    const at = "2026-01-01T10:00:00+08:00";
    const first = await ingestDeviceEvent(
      pool,
      { deviceId, eventId: "first", status: "running", occurredAt: at },
      "manual",
      userId,
    );
    assert.equal(first.applied, true);
    const duplicate = await ingestDeviceEvent(
      pool,
      { deviceId, eventId: "first", status: "running", occurredAt: at },
      "manual",
      userId,
    );
    assert.equal(duplicate.duplicate, true);
    await assert.rejects(() =>
      ingestDeviceEvent(
        pool,
        { deviceId, eventId: "first", status: "fault", occurredAt: at },
        "manual",
        userId,
      ),
    );
    const late = await ingestDeviceEvent(
      pool,
      {
        deviceId,
        eventId: "late",
        status: "idle",
        occurredAt: "2026-01-01T08:00:00+08:00",
      },
      "manual",
      userId,
    );
    assert.equal(late.applied, false);
    assert.equal(
      (
        await pool.query(
          "SELECT status FROM device_states WHERE device_id=$1",
          [deviceId],
        )
      ).rows[0].status,
      "running",
    );
    await ingestDeviceEvent(
      pool,
      {
        deviceId,
        eventId: "stop",
        status: "offline",
        occurredAt: "2026-01-01T18:00:00+08:00",
      },
      "manual",
      userId,
    );
    const summary = await deviceSummary(pool, "2026-01-01");
    const item = summary.items.find((x) => x.id === deviceId)!;
    assert.equal(item.seconds.unknown, 8 * 3600);
    assert.equal(item.seconds.idle, 2 * 3600);
    assert.equal(item.seconds.running, 8 * 3600);
    assert.equal(item.seconds.offline, 6 * 3600);
    const nextDay = (await deviceSummary(pool, "2026-01-02")).items.find(
      (x) => x.id === deviceId,
    )!;
    assert.equal(nextDay.seconds.offline, 86400);
    assert.equal(
      Object.values(nextDay.seconds).reduce((a, b) => a + b, 0),
      86400,
    );
    const heartbeat = await ingestDeviceEvent(
      pool,
      { deviceId, status: "offline" },
      "mqtt",
      null,
    );
    assert.equal(heartbeat.heartbeat, true);
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM device_events WHERE device_id=$1",
            [deviceId],
          )
        ).rows[0].count,
      ),
      3,
    );
    await assert.rejects(() =>
      ingestDeviceEvent(
        pool,
        { deviceId, status: "running", occurredAt: "2099-01-01T00:00:00Z" },
        "manual",
        userId,
      ),
    );
  } finally {
    await pool.query("DELETE FROM audit_logs WHERE actor_id=$1", [userId]);
    await pool.query("DELETE FROM device_states WHERE device_id=$1", [
      deviceId,
    ]);
    await pool.query("DELETE FROM device_events WHERE device_id=$1", [
      deviceId,
    ]);
    await pool.query("DELETE FROM records WHERE id=$1", [deviceId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.end();
  }
});
