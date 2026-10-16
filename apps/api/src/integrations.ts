import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import mqtt, { type MqttClient } from "mqtt";
import { z } from "zod";
import { actor } from "./auth.js";
import { camel, ensure, transaction } from "./db.js";
import {
  bindDevice,
  decodeDeviceMessage,
  deviceEventSchema,
  deviceHistory,
  deviceStatistics,
  recordDeviceStatus,
  resolveDevice,
} from "./equipment.js";
import { registerFiles } from "./files.js";

export async function ingestDeviceEvent(
  pool: pg.Pool,
  raw: unknown,
  source: "mqtt" | "manual",
  actorId: string | null,
) {
  const input = deviceEventSchema.parse(raw);
  return transaction(pool, async (db) => {
    const deviceId = await resolveDevice(db, input);
    return recordDeviceStatus(
      db,
      deviceId,
      input.status,
      actorId,
      input.eventId ?? randomUUID(),
      {
        occurredAt: input.occurredAt,
        reason: input.reason,
        source,
        heartbeat: !input.eventId,
      },
    );
  });
}

export async function deviceSummary(
  pool: pg.Pool,
  day: string,
  timezone = "Asia/Shanghai",
) {
  const result = await deviceStatistics(
    pool,
    { from: day, to: day, pageSize: 500 },
    timezone,
  );
  return {
    ...result,
    day,
    items: result.items.map((item) => ({ ...item, id: item.deviceId })),
  };
}

export async function registerIntegrations(
  app: FastifyInstance,
  pool: pg.Pool,
  publish: (event: { resource: string; id?: string }) => void,
) {
  await registerFiles(app, pool);
  let client: MqttClient | undefined;
  let connected = false;
  let lastMessageAt: string | null = null;
  let lastError: string | null = null;
  const url = process.env.MQTT_URL;
  app.get("/api/telemetry/devices", async (req) => {
    actor(req);
    const rows = (
      await pool.query(`SELECT r.id,r.code,r.name,r.data,s.status,s.occurred_at,s.last_seen_at,
      (s.last_seen_at IS NULL OR s.last_seen_at < now()-interval '5 minutes') AS stale
      FROM records r LEFT JOIN device_states s ON s.device_id=r.id WHERE r.resource='devices' AND r.status<>'archived' ORDER BY r.code`)
    ).rows;
    return {
      items: camel(rows),
      total: rows.length,
      connection: { configured: !!url, connected, lastMessageAt, lastError },
    };
  });
  app.get("/api/telemetry/summary", async (req) => {
    actor(req);
    const query = z
      .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(req.query);
    return deviceSummary(
      pool,
      query.day,
      process.env.FACTORY_TIMEZONE ?? "Asia/Shanghai",
    );
  });
  app.get("/api/telemetry/devices/:id/events", async (req) => {
    actor(req);
    const deviceId = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    return deviceHistory(pool, { ...(req.query as object), deviceId });
  });
  app.get("/api/telemetry/statistics", async (req) => {
    actor(req);
    return deviceStatistics(
      pool,
      req.query,
      process.env.FACTORY_TIMEZONE ?? "Asia/Shanghai",
    );
  });
  app.get("/api/telemetry/events", async (req) => {
    actor(req);
    return deviceHistory(pool, req.query);
  });
  app.patch("/api/telemetry/devices/:id/binding", async (req) => {
    const user = actor(req, "manager");
    const id = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const result = await transaction(pool, (db) =>
      bindDevice(db, id, req.body, user.id),
    );
    publish({ resource: "devices", id });
    return result;
  });
  app.post("/api/telemetry/events", async (req) => {
    const user = actor(req, "manager");
    const result = await ingestDeviceEvent(pool, req.body, "manual", user.id);
    publish({ resource: "devices", id: result.deviceId });
    return result;
  });
  app.get("/api/integrations/status", async (req) => {
    actor(req, "manager");
    return {
      mqtt: { configured: !!url, connected, lastMessageAt, lastError },
      failures: camel(
        (
          await pool.query(
            "SELECT * FROM integration_failures ORDER BY created_at DESC LIMIT 50",
          )
        ).rows,
      ),
    };
  });
  if (url) {
    const parsed = new URL(url);
    ensure(
      ["mqtts:", "wss:", "mqtt:", "ws:"].includes(parsed.protocol),
      "无效 MQTT 协议",
      500,
      "CONFIG_ERROR",
    );
    if (process.env.NODE_ENV === "production")
      ensure(
        ["mqtts:", "wss:"].includes(parsed.protocol) ||
          process.env.ALLOW_PRIVATE_MQTT === "true",
        "生产环境 MQTT 要求 TLS；可信私网需显式开启 ALLOW_PRIVATE_MQTT",
        500,
        "CONFIG_ERROR",
      );
    client = mqtt.connect(url, {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      clientId: `mes-next-${randomUUID()}`,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      clean: true,
      rejectUnauthorized: true,
    });
    client.on("connect", () => {
      connected = true;
      lastError = null;
      client!.subscribe(process.env.MQTT_TOPIC ?? "device/send/+", { qos: 1 });
    });
    client.on("close", () => {
      connected = false;
    });
    client.on("error", (error) => {
      lastError = error.message;
      app.log.warn({ event: "mqtt-error" }, "设备采集连接异常");
    });
    // Chain by device identity: preserve ingress order without serializing all machines.
    const inflight = new Map<string, Promise<void>>();
    client.on("message", (topic, payload) => {
      const deviceNo = topic.split("/").at(-1) ?? "";
      const pending = (inflight.get(deviceNo) ?? Promise.resolve()).then(
        async () => {
          try {
            const input = decodeDeviceMessage(topic, payload);
            const result = await ingestDeviceEvent(pool, input, "mqtt", null);
            lastMessageAt = new Date().toISOString();
            if (result.applied && !result.heartbeat)
              publish({ resource: "devices", id: result.deviceId });
          } catch (error) {
            const reason =
              error instanceof Error
                ? error.message.slice(0, 300)
                : "设备消息处理失败";
            app.log.warn({ event: "mqtt-invalid", reason }, "设备事件未入账");
            await pool
              .query(
                "INSERT INTO integration_failures(id,integration,reason) VALUES($1,'mqtt',$2)",
                [randomUUID(), reason],
              )
              .catch(() => {});
          }
        },
      );
      inflight.set(deviceNo, pending);
      void pending.finally(() => {
        if (inflight.get(deviceNo) === pending) inflight.delete(deviceNo);
      });
    });
  }
  app.addHook("onClose", async () => {
    if (client) await client.endAsync();
  });
}
