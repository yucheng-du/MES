import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { audit, camel, ensure, one, type DB } from "./db.js";

export const deviceStatuses = [
  "offline",
  "idle",
  "running",
  "fault",
  "maintenance",
  "deactivated",
  "scrapped",
] as const;
export type DeviceStatus = (typeof deviceStatuses)[number];
export const deviceEventSchema = z
  .object({
    deviceId: z.string().uuid().optional(),
    deviceNo: z.string().trim().min(1).max(100).optional(),
    eventId: z.string().min(1).max(160).optional(),
    status: z.enum(deviceStatuses),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => v.deviceId || v.deviceNo, "必须指定设备");
export type DeviceEventInput = z.infer<typeof deviceEventSchema>;

/** Called inside the caller's transaction; does not commit, publish, or create another transaction. */
export async function recordDeviceStatus(
  db: DB,
  deviceId: string,
  status: DeviceStatus,
  actorId: string | null,
  eventId: string,
  options: {
    occurredAt?: string;
    reason?: string;
    source?: "mqtt" | "manual";
    heartbeat?: boolean;
  } = {},
) {
  const source = options.source ?? "manual";
  const occurredAt = options.occurredAt
    ? new Date(options.occurredAt)
    : new Date();
  ensure(
    Number.isFinite(occurredAt.getTime()) &&
      occurredAt.getTime() <= Date.now() + 60_000,
    "设备事件时间不能在未来",
    400,
    "INVALID_TIME",
  );
  const device = await one(
    db,
    "SELECT * FROM records WHERE id=$1 AND resource='devices' AND status<>'archived' FOR UPDATE",
    [deviceId],
    "设备不存在或已归档",
  );
  const previous = (
    await db.query("SELECT * FROM device_states WHERE device_id=$1", [deviceId])
  ).rows[0];
  const existing = (
    await db.query(
      "SELECT * FROM device_events WHERE device_id=$1 AND event_key=$2",
      [deviceId, eventId],
    )
  ).rows[0];
  if (existing) {
    ensure(
      existing.status === status &&
        (!options.occurredAt ||
          new Date(existing.occurred_at).getTime() === occurredAt.getTime()) &&
        existing.reason === (options.reason ?? ""),
      "事件标识已被不同内容使用",
    );
    return {
      deviceId,
      duplicate: true,
      applied: false,
      heartbeat: false,
      suppressed: false,
    };
  }
  const held =
    ["maintenance", "deactivated", "scrapped"].includes(previous?.status) ||
    ["deactivated", "scrapped"].includes(device.data?.lifecycle);
  if (source === "mqtt" && (held || device.data?.networked === false)) {
    await db.query(
      "UPDATE device_states SET last_seen_at=now() WHERE device_id=$1",
      [deviceId],
    );
    return {
      deviceId,
      duplicate: false,
      applied: false,
      heartbeat: true,
      suppressed: true,
    };
  }
  const heartbeat =
    !!options.heartbeat &&
    previous?.status === status &&
    occurredAt.getTime() >= new Date(previous.occurred_at).getTime();
  const scale = Number(device.data?.pieceScale ?? 1);
  ensure(
    Number.isFinite(scale) && scale > 0 && scale <= 1000000,
    "设备计件比例必须大于零",
    400,
  );
  if (!heartbeat)
    await db.query(
      `INSERT INTO device_events(id,device_id,event_key,status,occurred_at,time_source,source,piece_scale,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        deviceId,
        eventId,
        status,
        occurredAt,
        options.occurredAt ? "device" : "server",
        source,
        scale,
        options.reason ?? "",
        actorId,
      ],
    );
  const applied =
    !previous ||
    occurredAt.getTime() >= new Date(previous.occurred_at).getTime();
  if (applied)
    await db.query(
      `INSERT INTO device_states(device_id,status,occurred_at,last_seen_at) VALUES($1,$2,$3,now()) ON CONFLICT(device_id) DO UPDATE SET status=excluded.status,occurred_at=CASE WHEN $4 THEN device_states.occurred_at ELSE excluded.occurred_at END,last_seen_at=now()`,
      [deviceId, status, occurredAt, heartbeat],
    );
  else
    await db.query(
      "UPDATE device_states SET last_seen_at=now() WHERE device_id=$1",
      [deviceId],
    );
  if (source === "manual")
    await audit(db, actorId, "device-status", "devices", deviceId, {
      status,
      occurredAt: occurredAt.toISOString(),
      applied,
      reason: options.reason ?? "",
    });
  return { deviceId, duplicate: false, applied, heartbeat, suppressed: false };
}

export function decodeDeviceMessage(
  topic: string,
  raw: Buffer | string,
): DeviceEventInput {
  ensure(Buffer.byteLength(raw) <= 16384, "设备消息过大", 400);
  const deviceNo = topic.split("/").at(-1) ?? "";
  ensure(
    deviceNo.length > 0 && deviceNo.length <= 100 && !/[+#]/.test(deviceNo),
    "设备采集主题无效",
    400,
  );
  const data = JSON.parse(raw.toString());
  ensure(
    data && typeof data === "object" && !Array.isArray(data),
    "设备采集消息无效",
    400,
  );
  const legacy: Record<number, DeviceStatus> = {
    0: "offline",
    1: "fault",
    2: "idle",
    3: "running",
  };
  const legacyStatus =
    typeof data.RGY === "number" && Number.isInteger(data.RGY)
      ? legacy[data.RGY]
      : undefined;
  ensure(
    data.status !== undefined || legacyStatus !== undefined,
    "设备采集状态无效",
    400,
  );
  ensure(
    data.status === undefined ||
      data.RGY === undefined ||
      data.status === legacyStatus,
    "设备采集状态相互冲突",
    400,
  );
  ensure(
    data.deviceNo === undefined || data.deviceNo === deviceNo,
    "设备编号与采集主题不一致",
    400,
  );
  return deviceEventSchema.parse({
    deviceNo,
    status: data.status ?? legacyStatus,
    eventId: data.eventId,
    occurredAt: data.occurredAt,
  });
}

export async function resolveDevice(db: DB, input: DeviceEventInput) {
  if (input.deviceId) return input.deviceId;
  const rows = (
    await db.query(
      "SELECT id FROM records WHERE resource='devices' AND status<>'archived' AND (code=$1 OR data->>'deviceNo'=$1)",
      [input.deviceNo],
    )
  ).rows;
  ensure(rows.length > 0, "设备不存在或已归档", 404, "NOT_FOUND");
  ensure(
    rows.length === 1,
    "采集编号对应多个设备，请修正绑定",
    409,
    "AMBIGUOUS_DEVICE",
  );
  return rows[0].id as string;
}

export const bindingSchema = z
  .object({
    deviceNo: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    networked: z.boolean(),
    pieceScale: z.number().positive().max(1000000),
  })
  .strict();
export async function bindDevice(
  db: DB,
  deviceId: string,
  body: unknown,
  actorId: string,
) {
  const input = bindingSchema.parse(body);
  await one(
    db,
    "SELECT id FROM records WHERE id=$1 AND resource='devices' AND status<>'archived' FOR UPDATE",
    [deviceId],
    "设备不存在或已归档",
  );
  // Use the catalog identity lock after the row lock, matching catalog updates.
  await db.query("SELECT pg_advisory_xact_lock(72811402)");
  ensure(
    !(
      await db.query(
        "SELECT 1 FROM records WHERE resource='devices' AND id<>$1 AND (code=$2 OR data->>'deviceNo'=$2)",
        [deviceId, input.deviceNo],
      )
    ).rowCount,
    "采集编号已绑定其他设备",
  );
  const updated = await one(
    db,
    "UPDATE records SET data=data||$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
    [deviceId, JSON.stringify(input)],
  );
  await audit(db, actorId, "device-binding", "devices", deviceId, input);
  return camel(updated);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const statisticsQuery = z.object({
  from: date,
  to: date,
  deviceId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
type Event = {
  id: string;
  device_id: string;
  status: DeviceStatus;
  occurred_at: Date;
  received_at: Date;
  piece_scale: number;
  source: string;
  reason: string;
  actor_id: string | null;
  event_key: string;
};
type Transition = Event & {
  previousStatus: DeviceStatus | "unknown";
  previousAt: Date | null;
  duration: number | null;
  changed: boolean;
};
function transitions(events: Event[]): Transition[] {
  let state: DeviceStatus | "unknown" = "unknown",
    at: Date | null = null;
  return events.map((e) => {
    const changed = e.status !== state;
    const result = {
      ...e,
      previousStatus: state,
      previousAt: at,
      duration: at
        ? (new Date(e.occurred_at).getTime() - at.getTime()) / 1000
        : null,
      changed,
    };
    if (changed) {
      state = e.status;
      at = new Date(e.occurred_at);
    }
    return result;
  });
}
const emptySeconds = () =>
  Object.fromEntries(
    [...deviceStatuses, "unknown"].map((s) => [s, 0]),
  ) as Record<DeviceStatus | "unknown", number>;
const emptyCounts = () =>
  Object.fromEntries(deviceStatuses.map((s) => [s, 0])) as Record<
    DeviceStatus,
    number
  >;

/** Freeze a precise report window inside the caller's transaction. Unknown time is never downtime. */
export async function reportEquipmentSnapshot(
  db: DB,
  deviceId: string,
  from: string | Date,
  to: string | Date,
) {
  const start = new Date(from),
    finish = new Date(to);
  ensure(
    Number.isFinite(start.getTime()) &&
      Number.isFinite(finish.getTime()) &&
      finish >= start &&
      finish.getTime() <= Date.now() + 60_000,
    "设备报工统计时间无效",
    400,
    "INVALID_TIME",
  );
  // Ingest locks the same device row before inserting an event. This shared lock prevents
  // an event/configuration race while the surrounding production transaction freezes its report.
  const device = await one(
    db,
    "SELECT id,code,name,data FROM records WHERE id=$1 AND resource='devices' FOR SHARE",
    [deviceId],
    "设备不存在或已归档",
  );
  const events = (
    await db.query(
      `WITH previous AS (SELECT * FROM device_events WHERE device_id=$1 AND occurred_at<$2 ORDER BY occurred_at DESC,received_at DESC,id DESC LIMIT 1)
    SELECT * FROM previous UNION ALL SELECT * FROM device_events WHERE device_id=$1 AND occurred_at >=$2 AND occurred_at<$3 ORDER BY occurred_at,received_at,id LIMIT 200001`,
      [deviceId, start, finish],
    )
  ).rows as Event[];
  ensure(events.length <= 200000, "统计事件过多，请缩小日期范围", 400);
  const seconds = emptySeconds(),
    counts = emptyCounts();
  let state: DeviceStatus | "unknown" = "unknown",
    cursor = start.getTime();
  let powerOnCount = 0,
    effectiveOperatingCount = 0,
    operatingPieces = 0;
  const cycleScales = new Set<number>();
  for (const event of transitions(events)) {
    const at = new Date(event.occurred_at).getTime();
    if (at < start.getTime()) {
      state = event.status;
      continue;
    }
    seconds[state] += (at - cursor) / 1000;
    cursor = at;
    if (event.changed && event.previousStatus !== "unknown") {
      counts[event.status]++;
      if (event.previousStatus === "offline" && event.status !== "offline")
        powerOnCount++;
      if (event.previousStatus === "running" && event.status === "idle") {
        effectiveOperatingCount++;
        operatingPieces += Number(event.piece_scale);
        cycleScales.add(Number(event.piece_scale));
      }
    }
    state = event.status;
  }
  seconds[state] += (finish.getTime() - cursor) / 1000;
  const totalSeconds = (finish.getTime() - start.getTime()) / 1000;
  const knownSeconds = totalSeconds - seconds.unknown;
  const powerOnSeconds = seconds.idle + seconds.running + seconds.fault;
  return {
    version: 1,
    deviceId,
    deviceCode: device.code as string,
    deviceName: device.name as string,
    from: start.toISOString(),
    to: finish.toISOString(),
    windowBoundary: "[from,to)",
    configuredPieceScale: Number(device.data?.pieceScale ?? 1),
    cyclePieceScales: [...cycleScales].sort((a, b) => a - b),
    totalSeconds,
    knownSeconds,
    seconds,
    counts,
    percent: Object.fromEntries(
      Object.entries(seconds).map(([status, duration]) => [
        status,
        totalSeconds ? (duration / totalSeconds) * 100 : 0,
      ]),
    ),
    powerOnSeconds,
    powerOnPercent: totalSeconds ? (powerOnSeconds / totalSeconds) * 100 : 0,
    runningSeconds: seconds.running,
    shutdownSeconds: seconds.offline,
    nonRunningKnownSeconds: knownSeconds - seconds.running,
    powerOnCount,
    shutdownCount: counts.offline,
    effectiveOperatingCount,
    operatingPieces: Number(operatingPieces.toFixed(3)),
  };
}

export async function deviceStatistics(
  pool: DB,
  raw: unknown,
  timezone = "Asia/Shanghai",
) {
  const q = statisticsQuery.parse(raw);
  ensure(q.from <= q.to, "统计结束日期不能早于开始日期", 400);
  const bounds = await one(
    pool,
    `SELECT ($1::date::timestamp AT TIME ZONE $3) AS start, LEAST((($2::date+1)::timestamp AT TIME ZONE $3),now()) AS finish,($2::date-$1::date) AS days,to_char($1::date,'YYYY-MM-DD') AS from_date,to_char($2::date,'YYYY-MM-DD') AS to_date`,
    [q.from, q.to, timezone],
  );
  ensure(
    bounds.from_date === q.from && bounds.to_date === q.to,
    "统计日期无效",
    400,
  );
  ensure(bounds.days <= 365, "统计区间不能超过366天", 400);
  ensure(
    new Date(bounds.finish) > new Date(bounds.start),
    "不能统计未来日期",
    400,
    "INVALID_DATE",
  );
  const days = (
    await pool.query(
      `SELECT to_char(d,'YYYY-MM-DD') AS day,(d::timestamp AT TIME ZONE $3) AS start,LEAST(((d+interval '1 day')::timestamp AT TIME ZONE $3),$4::timestamptz) AS finish FROM generate_series($1::date,$2::date,interval '1 day') d WHERE (d::timestamp AT TIME ZONE $3)<$4::timestamptz`,
      [q.from, q.to, timezone, bounds.finish],
    )
  ).rows;
  const devices = (
    await pool.query(
      "SELECT id,code,name,data FROM records WHERE resource='devices' AND ($1::uuid IS NOT NULL OR status<>'archived') AND ($1::uuid IS NULL OR id=$1) ORDER BY code,id",
      [q.deviceId ?? null],
    )
  ).rows;
  const ids = devices.map((d) => d.id);
  const events = (
    await pool.query(
      `WITH previous AS (SELECT DISTINCT ON(device_id) * FROM device_events WHERE device_id=ANY($1::uuid[]) AND occurred_at<$2 ORDER BY device_id,occurred_at DESC,received_at DESC,id DESC) SELECT * FROM previous UNION ALL SELECT * FROM device_events WHERE device_id=ANY($1::uuid[]) AND occurred_at >=$2 AND occurred_at<$3 ORDER BY device_id,occurred_at,received_at,id LIMIT 200001`,
      [ids, bounds.start, bounds.finish],
    )
  ).rows as Event[];
  ensure(events.length <= 200000, "统计事件过多，请缩小日期范围", 400);
  const grouped = new Map<string, Transition[]>();
  for (const d of devices)
    grouped.set(d.id, transitions(events.filter((e) => e.device_id === d.id)));
  const items = [];
  const totals = {
    seconds: emptySeconds(),
    counts: emptyCounts(),
    powerOnCount: 0,
    shutdownCount: 0,
    effectiveOperatingCount: 0,
    operatingPieces: 0,
    totalSeconds: 0,
    knownSeconds: 0,
    powerOnSeconds: 0,
  };
  for (const day of days)
    for (const device of devices) {
      const start = new Date(day.start).getTime(),
        finish = new Date(day.finish).getTime();
      const seconds = emptySeconds(),
        counts = emptyCounts();
      let state: DeviceStatus | "unknown" = "unknown",
        cursor = start,
        powerOnCount = 0,
        effectiveOperatingCount = 0,
        operatingPieces = 0;
      for (const event of grouped.get(device.id) ?? []) {
        const when = new Date(event.occurred_at).getTime();
        if (when >= finish) break;
        if (when < start) {
          state = event.status;
          continue;
        }
        seconds[state] += (when - cursor) / 1000;
        cursor = when;
        if (event.changed && event.previousStatus !== "unknown") {
          counts[event.status]++;
          if (event.previousStatus === "offline" && event.status !== "offline")
            powerOnCount++;
          if (event.previousStatus === "running" && event.status === "idle") {
            effectiveOperatingCount++;
            operatingPieces += Number(event.piece_scale);
          }
        }
        state = event.status;
      }
      seconds[state] += (finish - cursor) / 1000;
      const totalSeconds = (finish - start) / 1000,
        knownSeconds = totalSeconds - seconds.unknown;
      const powerOnSeconds = seconds.idle + seconds.running + seconds.fault;
      const percent = Object.fromEntries(
        Object.entries(seconds).map(([s, n]) => [
          s,
          totalSeconds ? (n / totalSeconds) * 100 : 0,
        ]),
      );
      items.push({
        id: `${device.id}:${day.day}`,
        deviceId: device.id,
        code: device.code,
        name: device.name,
        day: day.day,
        seconds,
        percent,
        counts,
        totalSeconds,
        knownSeconds,
        powerOnSeconds,
        powerOnPercent: totalSeconds
          ? (powerOnSeconds / totalSeconds) * 100
          : 0,
        powerOnCount,
        shutdownCount: counts.offline,
        effectiveOperatingCount,
        operatingPieces: Number(operatingPieces.toFixed(3)),
      });
      for (const s of [...deviceStatuses, "unknown"] as const)
        totals.seconds[s] += seconds[s];
      for (const s of deviceStatuses) totals.counts[s] += counts[s];
      Object.assign(totals, {
        powerOnCount: totals.powerOnCount + powerOnCount,
        shutdownCount: totals.shutdownCount + counts.offline,
        effectiveOperatingCount:
          totals.effectiveOperatingCount + effectiveOperatingCount,
        operatingPieces: totals.operatingPieces + operatingPieces,
        totalSeconds: totals.totalSeconds + totalSeconds,
        knownSeconds: totals.knownSeconds + knownSeconds,
        powerOnSeconds: totals.powerOnSeconds + powerOnSeconds,
      });
    }
  return {
    from: q.from,
    to: q.to,
    timezone,
    finish: new Date(bounds.finish).toISOString(),
    items: items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    total: items.length,
    page: q.page,
    pageSize: q.pageSize,
    totals: {
      ...totals,
      operatingPieces: Number(totals.operatingPieces.toFixed(3)),
      percent: Object.fromEntries(
        Object.entries(totals.seconds).map(([s, n]) => [
          s,
          totals.totalSeconds ? (n / totals.totalSeconds) * 100 : 0,
        ]),
      ),
      powerOnPercent: totals.totalSeconds
        ? (totals.powerOnSeconds / totals.totalSeconds) * 100
        : 0,
    },
  };
}

export const historyQuery = z.object({
  deviceId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  status: z.enum(deviceStatuses).optional(),
  previousStatus: z.enum(deviceStatuses).optional(),
  durationMin: z.coerce.number().min(0).optional(),
  durationMax: z.coerce.number().min(0).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export async function deviceHistory(db: DB, raw: unknown) {
  const q = historyQuery.parse(raw);
  ensure(
    !q.from || !q.to || new Date(q.from).getTime() <= new Date(q.to).getTime(),
    "结束时间不能早于开始时间",
    400,
  );
  ensure(
    q.durationMin === undefined ||
      q.durationMax === undefined ||
      q.durationMin <= q.durationMax,
    "最小时长不能大于最大时长",
    400,
  );
  // Collapse identical-state observations before LAG so duration starts at the real state transition.
  const cte = `WITH observed AS (SELECT e.*,lag(status) OVER(PARTITION BY device_id ORDER BY occurred_at,received_at,id) AS prior FROM device_events e WHERE ($1::uuid IS NULL OR device_id=$1)), changed AS (SELECT * FROM observed WHERE status IS DISTINCT FROM prior), timeline AS (SELECT *,lag(status) OVER(PARTITION BY device_id ORDER BY occurred_at,received_at,id) AS previous_status,lag(occurred_at) OVER(PARTITION BY device_id ORDER BY occurred_at,received_at,id) AS previous_at FROM changed), filtered AS (SELECT *,extract(epoch FROM occurred_at-previous_at)::float AS duration FROM timeline WHERE ($2::timestamptz IS NULL OR occurred_at >=$2) AND ($3::timestamptz IS NULL OR occurred_at<$3) AND ($4::text IS NULL OR status=$4) AND ($5::text IS NULL OR previous_status=$5) AND ($6::float IS NULL OR extract(epoch FROM occurred_at-previous_at)>=$6) AND ($7::float IS NULL OR extract(epoch FROM occurred_at-previous_at)<=$7))`;
  const params = [
    q.deviceId ?? null,
    q.from ?? null,
    q.to ?? null,
    q.status ?? null,
    q.previousStatus ?? null,
    q.durationMin ?? null,
    q.durationMax ?? null,
  ];
  const total = Number(
    (await one(db, `${cte} SELECT count(*) AS total FROM filtered`, params))
      .total,
  );
  const rows = (
    await db.query(
      `${cte} SELECT f.*,r.code,r.name,u.name AS actor_name FROM filtered f JOIN records r ON r.id=f.device_id LEFT JOIN users u ON u.id=f.actor_id ORDER BY occurred_at DESC,received_at DESC,id DESC LIMIT $8 OFFSET $9`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    )
  ).rows;
  return { items: camel(rows), total, page: q.page, pageSize: q.pageSize };
}
