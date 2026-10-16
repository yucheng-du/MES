import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { actor } from "./auth.js";
import { audit, camel, ensure, id, one, transaction, type DB } from "./db.js";
import { date, uuid } from "./query.js";

export const productionFields = {
  procedureTypeId: uuid.nullish(),
  deductionUnitPrice: z.number().nonnegative().max(100000).default(0),
  rewardUnitPrice: z.number().nonnegative().max(100000).default(0),
  autoComplete: z.boolean().default(false),
  operationGuide: z.string().max(10000).default(""),
  inspectionGuide: z.string().max(10000).default(""),
  attachmentIds: z.array(uuid).max(20).default([]),
};
export const parityStepSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    unitPrice: z.number().nonnegative().max(1000000),
    expectedMinutes: z.number().positive().max(100000),
    ...productionFields,
  })
  .strict();
export function stepMetadata(step: z.infer<typeof parityStepSchema>) {
  const { name: _n, unitPrice: _p, expectedMinutes: _t, ...metadata } = step;
  return metadata;
}
export const productDetailsSchema = z
  .object({
    typeId: uuid.nullish(),
    materialId: uuid.nullish(),
    model: z.string().max(100).default(""),
    unitWeight: z.number().nonnegative().max(1000000000).default(0),
    drawingIds: z.array(uuid).max(20).default([]),
    customerIds: z.array(uuid).max(100).default([]),
    safetyStockDays: z.number().int().nonnegative().max(36500).default(0),
  })
  .strict();
export async function validateFiles(db: DB, ids: string[]) {
  ensure(new Set(ids).size === ids.length, "附件不能重复");
  if (ids.length)
    ensure(
      (
        await db.query(
          "SELECT id FROM uploaded_files WHERE id=ANY($1::uuid[]) AND visibility='business' FOR SHARE",
          [ids],
        )
      ).rowCount === ids.length,
      "附件不存在",
    );
}
export async function validateProductDetails(
  db: DB,
  details: z.infer<typeof productDetailsSchema>,
) {
  for (const [key, resource] of [
    ["typeId", "product-types"],
    ["materialId", "materials"],
  ] as const) {
    if (details[key])
      await one(
        db,
        "SELECT id FROM records WHERE id=$1 AND resource=$2 AND status<>'archived' FOR SHARE",
        [details[key], resource],
        "产品关联台账不存在或已归档",
      );
  }
  ensure(
    new Set(details.customerIds).size === details.customerIds.length,
    "关联客户不能重复",
  );
  if (details.customerIds.length)
    ensure(
      (
        await db.query(
          "SELECT id FROM records WHERE id=ANY($1::uuid[]) AND resource='customers' AND status<>'archived' FOR SHARE",
          [details.customerIds],
        )
      ).rowCount === details.customerIds.length,
      "关联客户不存在或已归档",
    );
  await validateFiles(db, details.drawingIds);
}
export async function validateSteps(
  db: DB,
  steps: z.infer<typeof parityStepSchema>[],
) {
  for (const step of steps) {
    if (step.procedureTypeId)
      await one(
        db,
        "SELECT id FROM procedure_types WHERE id=$1 AND active FOR SHARE",
        [step.procedureTypeId],
        "工序类型不存在或已停用",
      );
    await validateFiles(db, step.attachmentIds);
  }
}
export async function qualified(
  db: DB,
  workerId: string,
  typeId?: string | null,
) {
  await one(
    db,
    "SELECT id FROM users WHERE id=$1 AND active FOR SHARE",
    [workerId],
    "人员不存在或已停用",
  );
  if (typeId)
    ensure(
      (
        await db.query(
          "SELECT 1 FROM worker_qualifications q JOIN procedure_types p ON p.id=q.procedure_type_id WHERE q.user_id=$1 AND q.procedure_type_id=$2 AND q.active AND p.active AND (q.valid_until IS NULL OR q.valid_until>=current_date) FOR SHARE OF q,p",
          [workerId, typeId],
        )
      ).rowCount,
      "人员没有有效的工序资格",
    );
}
async function deviceValid(db: DB, deviceId: string) {
  const device = await one(
    db,
    "SELECT r.*,s.status AS operating_status FROM records r LEFT JOIN device_states s ON s.device_id=r.id WHERE r.id=$1 AND r.resource='devices' AND r.status='active' FOR SHARE OF r",
    [deviceId],
    "设备不存在或已停用",
  );
  ensure(
    !["fault", "maintenance", "deactivated", "scrapped"].includes(
      device.operating_status,
    ) &&
      (!device.data.lifecycle || device.data.lifecycle === "active") &&
      !(device.data.networked && device.operating_status === "offline"),
    "设备当前不可用于生产",
  );
}
export async function stationEvent(
  db: DB,
  stationId: string,
  userId: string | null,
  actorId: string | null,
  event: string,
  reason = "",
  reportId: string | null = null,
) {
  await db.query(
    "INSERT INTO station_events(id,station_id,worker_id,actor_id,event,reason,report_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id(), stationId, userId, actorId, event, reason, reportId],
  );
}
async function endIdle(db: DB, stationId: string) {
  await db.query(
    "UPDATE station_events SET ended_at=clock_timestamp() WHERE station_id=$1 AND event='no_material' AND ended_at IS NULL",
    [stationId],
  );
}
async function beginIdle(db: DB, stationId: string, workerId: string) {
  await db.query(
    "INSERT INTO station_events(id,station_id,worker_id,event) VALUES($1,$2,$3,'no_material') ON CONFLICT DO NOTHING",
    [id(), stationId, workerId],
  );
}
export async function validateTaskReceive(
  db: DB,
  task: any,
  workerId: string,
  stationId?: string | null,
  forced = false,
) {
  const typeId = task.production?.procedureTypeId;
  await qualified(db, workerId, typeId);
  ensure(
    !task.assigned_worker_id || task.assigned_worker_id === workerId,
    "任务已指定其他操作员",
  );
  ensure(
    !task.assigned_station_id || task.assigned_station_id === stationId,
    "任务必须在指定工位收料",
  );
  ensure(
    stationId || (!typeId && !task.assigned_device_id),
    "此任务必须选择已配置的工位",
  );
  if (!stationId) return null;
  const record = await one(
    db,
    "SELECT * FROM records WHERE id=$1 AND resource='workstations' AND status='active' FOR UPDATE",
    [stationId],
    "工位不存在或已归档",
  );
  const state = (
    await db.query(
      "SELECT * FROM station_execution WHERE station_id=$1 FOR UPDATE",
      [stationId],
    )
  ).rows[0];
  if (!state) {
    ensure(!typeId && !task.assigned_device_id, "请先配置工位工序类型和设备");
    ensure(
      !record.data.processName || record.data.processName === task.name,
      "工位不支持此工序",
    );
    ensure(
      !(
        await db.query(
          "SELECT 1 FROM reports WHERE workstation_id=$1 AND status IN ('received','working')",
          [stationId],
        )
      ).rowCount,
      "工位已有进行中的任务",
    );
    return record.data.deviceId ?? null;
  }
  ensure(state.state !== "disabled", "工位已停用");
  ensure(!state.current_report_id, "工位已有进行中的任务");
  if (!forced)
    ensure(
      state.state === "on_duty" && state.worker_id === workerId,
      "请先在此工位上岗",
    );
  ensure(
    !typeId || state.procedure_type_id === typeId,
    "工位工序类型与任务不匹配",
  );
  ensure(
    !task.assigned_device_id || state.device_id === task.assigned_device_id,
    "任务必须使用指定设备",
  );
  if (state.device_id) await deviceValid(db, state.device_id);
  return state.device_id;
}
export async function occupyStation(
  db: DB,
  stationId: string | null | undefined,
  workerId: string,
  reportId: string,
) {
  if (!stationId) return;
  const result = await db.query(
    "UPDATE station_execution SET current_report_id=$2,idle_since=NULL,updated_at=clock_timestamp() WHERE station_id=$1 AND worker_id=$3 AND state='on_duty' RETURNING station_id",
    [stationId, reportId, workerId],
  );
  if (result.rowCount) {
    await endIdle(db, stationId);
    await stationEvent(
      db,
      stationId,
      workerId,
      workerId,
      "receive",
      "",
      reportId,
    );
  }
}
export async function releaseStation(db: DB, report: any, actorId: string) {
  if (!report.workstation_id) return;
  const result = await db.query(
    "UPDATE station_execution SET current_report_id=NULL,idle_since=clock_timestamp(),updated_at=clock_timestamp() WHERE station_id=$1 AND current_report_id=$2 RETURNING worker_id",
    [report.workstation_id, report.id],
  );
  if (result.rowCount) {
    await stationEvent(
      db,
      report.workstation_id,
      report.worker_id,
      actorId,
      "complete",
      "",
      report.id,
    );
    await beginIdle(db, report.workstation_id, result.rows[0].worker_id);
  }
}
/** Called by generic catalog writers so workstation changes cannot bypass execution state. */
export async function guardStationCatalogUpdate(
  db: DB,
  record: any,
  nextData: any,
  status: string,
) {
  if (record.resource !== "workstations") return;
  const state = (
    await db.query(
      "SELECT * FROM station_execution WHERE station_id=$1 FOR UPDATE",
      [record.id],
    )
  ).rows[0];
  if (!state) return;
  ensure(
    state.state !== "on_duty" ||
      (status === record.status &&
        nextData.deviceId === record.data.deviceId &&
        nextData.processName === record.data.processName),
    "在岗工位不能归档或修改设备与工序",
  );
  ensure(
    !state.current_report_id || status === "active",
    "工位仍有进行中的任务",
  );
  ensure(
    (nextData.deviceId ?? null) === state.device_id,
    "请在车间工作站配置中变更设备",
  );
}

const routeSchema = z
  .object({
    productId: uuid.nullish(),
    name: z.string().trim().min(1).max(100),
    steps: z.array(parityStepSchema).min(1).max(50),
  })
  .strict();
export function registerProductionParity(app: FastifyInstance, pool: pg.Pool) {
  app.get("/api/production/procedure-types", async (req) => {
    actor(req);
    return camel(
      (await pool.query("SELECT * FROM procedure_types ORDER BY code")).rows,
    );
  });
  app.post("/api/production/procedure-types", async (req) => {
    const user = actor(req, "manager");
    const input = z
      .object({
        code: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(100),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const row = await one(
        db,
        "INSERT INTO procedure_types(id,code,name) VALUES($1,$2,$3) RETURNING *",
        [id(), input.code, input.name],
      );
      await audit(db, user.id, "create", "procedure-types", row.id);
      return camel(row);
    });
  });
  app.patch("/api/production/procedure-types/:id", async (req) => {
    const user = actor(req, "manager");
    const pid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        code: z.string().trim().min(1).max(80),
        name: z.string().trim().min(1).max(100),
        active: z.boolean(),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const row = await one(
        db,
        "UPDATE procedure_types SET code=$2,name=$3,active=$4 WHERE id=$1 RETURNING *",
        [pid, input.code, input.name, input.active],
      );
      await audit(db, user.id, "update", "procedure-types", pid, input);
      return camel(row);
    });
  });
  app.get("/api/production/qualifications", async (req) => {
    actor(req, "manager", "operator");
    return camel(
      (
        await pool.query(
          "SELECT q.*,u.name AS worker_name,p.name AS procedure_type_name FROM worker_qualifications q JOIN users u ON u.id=q.user_id JOIN procedure_types p ON p.id=q.procedure_type_id ORDER BY u.name,p.name",
        )
      ).rows,
    );
  });
  app.put("/api/production/qualifications/:userId/:typeId", async (req) => {
    const user = actor(req, "manager");
    const params = z.object({ userId: uuid, typeId: uuid }).parse(req.params);
    const input = z
      .object({ active: z.boolean(), validUntil: date.nullish() })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      await one(db, "SELECT id FROM users WHERE id=$1 AND active FOR SHARE", [
        params.userId,
      ]);
      await one(
        db,
        "SELECT id FROM procedure_types WHERE id=$1 AND active FOR SHARE",
        [params.typeId],
      );
      const row = await one(
        db,
        "INSERT INTO worker_qualifications(user_id,procedure_type_id,active,valid_until,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,procedure_type_id) DO UPDATE SET active=$3,valid_until=$4,updated_by=$5,updated_at=now() RETURNING *",
        [
          params.userId,
          params.typeId,
          input.active,
          input.validUntil ?? null,
          user.id,
        ],
      );
      await audit(db, user.id, "qualify", "users", params.userId, {
        ...input,
        procedureTypeId: params.typeId,
      });
      return camel(row);
    });
  });
  app.get("/api/production/routes", async (req) => {
    actor(req);
    const productId = z
      .object({ productId: uuid.optional() })
      .parse(req.query).productId;
    return camel(
      (
        await pool.query(
          "SELECT * FROM production_routes WHERE ($1::uuid IS NULL OR product_id=$1 OR product_id IS NULL) ORDER BY name",
          [productId ?? null],
        )
      ).rows,
    );
  });
  app.post("/api/production/routes", async (req) => {
    const user = actor(req, "manager");
    const input = routeSchema.parse(req.body);
    return transaction(pool, async (db) => {
      if (input.productId)
        await one(
          db,
          "SELECT id FROM products WHERE id=$1 AND active FOR SHARE",
          [input.productId],
        );
      await validateSteps(db, input.steps);
      const row = await one(
        db,
        "INSERT INTO production_routes(id,product_id,name,steps,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [
          id(),
          input.productId ?? null,
          input.name,
          JSON.stringify(input.steps),
          user.id,
        ],
      );
      await audit(db, user.id, "create", "production-routes", row.id);
      return camel(row);
    });
  });
  app.patch("/api/production/routes/:id", async (req) => {
    const user = actor(req, "manager");
    const rid = uuid.parse((req.params as any).id);
    const input = routeSchema
      .extend({ revision: z.number().int().positive(), active: z.boolean() })
      .parse(req.body);
    return transaction(pool, async (db) => {
      const old = await one(
        db,
        "SELECT * FROM production_routes WHERE id=$1 FOR UPDATE",
        [rid],
      );
      ensure(old.revision === input.revision, "工艺已被修改，请刷新后重试");
      if (input.productId)
        await one(
          db,
          "SELECT id FROM products WHERE id=$1 AND active FOR SHARE",
          [input.productId],
        );
      await validateSteps(db, input.steps);
      const row = await one(
        db,
        "UPDATE production_routes SET product_id=$2,name=$3,steps=$4,active=$5,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
        [
          rid,
          input.productId ?? null,
          input.name,
          JSON.stringify(input.steps),
          input.active,
        ],
      );
      await audit(db, user.id, "update", "production-routes", rid);
      return camel(row);
    });
  });
  app.patch("/api/tasks/:id/assignment", async (req) => {
    const user = actor(req, "manager");
    const tid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        workerId: uuid.nullish(),
        workstationId: uuid.nullish(),
        deviceId: uuid.nullish(),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const ref = await one(db, "SELECT work_order_id FROM tasks WHERE id=$1", [
        tid,
      ]);
      await one(
        db,
        "SELECT id FROM work_orders WHERE id=$1 AND status IN ('pending','working') FOR UPDATE",
        [ref.work_order_id],
        "工单已结束",
      );
      const task = await one(db, "SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [
        tid,
      ]);
      ensure(
        ["blocked", "ready"].includes(task.status),
        "已收料的任务不能重新分派",
      );
      if (input.workerId)
        await qualified(db, input.workerId, task.production.procedureTypeId);
      if (input.workstationId) {
        const station = await one(
          db,
          "SELECT r.*,s.procedure_type_id,s.device_id,s.state FROM records r LEFT JOIN station_execution s ON s.station_id=r.id WHERE r.id=$1 AND r.resource='workstations' AND r.status='active' FOR SHARE OF r",
          [input.workstationId],
          "工位不存在或已归档",
        );
        ensure(station.state !== "disabled", "工位已停用");
        ensure(
          !task.production.procedureTypeId ||
            station.procedure_type_id === task.production.procedureTypeId,
          "工位工序类型与任务不匹配",
        );
        ensure(
          !input.deviceId ||
            (station.device_id ?? station.data.deviceId) === input.deviceId,
          "指定工位与设备不匹配",
        );
      }
      if (input.deviceId) await deviceValid(db, input.deviceId);
      const result = await one(
        db,
        "UPDATE tasks SET assigned_worker_id=$2,assigned_station_id=$3,assigned_device_id=$4 WHERE id=$1 RETURNING *",
        [
          tid,
          input.workerId ?? null,
          input.workstationId ?? null,
          input.deviceId ?? null,
        ],
      );
      await audit(db, user.id, "assign", "tasks", tid, input);
      return camel(result);
    });
  });
  app.get("/api/production/stations", async (req) => {
    actor(req);
    return camel(
      (
        await pool.query(
          "SELECT r.id,r.code,r.name,s.procedure_type_id,s.device_id,coalesce(s.state,'off_duty') AS state,s.worker_id,u.name AS worker_name,s.current_report_id,s.idle_since,s.idle_threshold_minutes,(s.station_id IS NOT NULL) AS configured FROM records r LEFT JOIN station_execution s ON s.station_id=r.id LEFT JOIN users u ON u.id=s.worker_id WHERE r.resource='workstations' AND r.status='active' ORDER BY r.name",
        )
      ).rows,
    );
  });
  app.patch("/api/production/stations/:id/config", async (req) => {
    const user = actor(req, "manager");
    const sid = uuid.parse((req.params as any).id);
    const input = z
      .object({
        procedureTypeId: uuid.nullish(),
        deviceId: uuid.nullish(),
        idleThresholdMinutes: z.number().int().min(1).max(1440).default(60),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      await one(
        db,
        "SELECT * FROM records WHERE id=$1 AND resource='workstations' AND status='active' FOR UPDATE",
        [sid],
      );
      const old = (
        await db.query(
          "SELECT * FROM station_execution WHERE station_id=$1 FOR UPDATE",
          [sid],
        )
      ).rows[0];
      ensure(!old || old.state !== "on_duty", "请先离岗再配置工位");
      ensure(
        !(
          await db.query(
            "SELECT 1 FROM reports WHERE workstation_id=$1 AND status IN ('received','working')",
            [sid],
          )
        ).rowCount,
        "工位仍有进行中的任务",
      );
      if (input.procedureTypeId)
        await one(
          db,
          "SELECT id FROM procedure_types WHERE id=$1 AND active FOR SHARE",
          [input.procedureTypeId],
        );
      if (input.deviceId) await deviceValid(db, input.deviceId);
      const row = await one(
        db,
        "INSERT INTO station_execution(station_id,procedure_type_id,device_id,idle_threshold_minutes) VALUES($1,$2,$3,$4) ON CONFLICT(station_id) DO UPDATE SET procedure_type_id=$2,device_id=$3,idle_threshold_minutes=$4,updated_at=now() RETURNING *",
        [
          sid,
          input.procedureTypeId ?? null,
          input.deviceId ?? null,
          input.idleThresholdMinutes,
        ],
      );
      await db.query(
        "UPDATE records SET data=jsonb_set(data,'{deviceId}',$2::jsonb),revision=revision+1,updated_at=now() WHERE id=$1",
        [sid, JSON.stringify(input.deviceId ?? null)],
      );
      await audit(db, user.id, "configure", "workstations", sid, input);
      return camel(row);
    });
  });
  for (const action of [
    "on-duty",
    "off-duty",
    "force-off-duty",
    "enable",
    "disable",
  ] as const)
    app.post(`/api/production/stations/:id/${action}`, async (req) => {
      const user = ["on-duty", "off-duty"].includes(action)
        ? actor(req, "operator", "manager")
        : actor(req, "manager");
      const sid = uuid.parse((req.params as any).id);
      const input = z
        .object({ reason: z.string().trim().max(1000).default("") })
        .strict()
        .parse(req.body ?? {});
      return transaction(pool, async (db) => {
        await one(
          db,
          "SELECT id FROM records WHERE id=$1 AND resource='workstations' AND status='active' FOR UPDATE",
          [sid],
        );
        const station = await one(
          db,
          "SELECT * FROM station_execution WHERE station_id=$1 FOR UPDATE",
          [sid],
          "请先配置工位",
        );
        ensure(!station.current_report_id, "工位仍有进行中的任务");
        let state: string,
          worker: string | null = null;
        if (action === "on-duty") {
          ensure(station.state === "off_duty", "工位不是离岗状态");
          await qualified(db, user.id, station.procedure_type_id);
          if (station.device_id) await deviceValid(db, station.device_id);
          state = "on_duty";
          worker = user.id;
          await beginIdle(db, sid, user.id);
        } else if (action === "off-duty" || action === "force-off-duty") {
          ensure(station.state === "on_duty", "工位不是在岗状态");
          if (action === "off-duty")
            ensure(
              station.worker_id === user.id,
              "只能操作自己在岗的工位",
              403,
              "FORBIDDEN",
            );
          else ensure(input.reason.length > 0, "强制离岗必须填写原因");
          state = "off_duty";
          await endIdle(db, sid);
        } else {
          ensure(
            station.state === (action === "enable" ? "disabled" : "off_duty"),
            "当前工位状态不允许此操作",
          );
          state = action === "enable" ? "off_duty" : "disabled";
        }
        const row = await one(
          db,
          "UPDATE station_execution SET state=$2,worker_id=$3,idle_since=CASE WHEN $3::uuid IS NULL THEN NULL ELSE clock_timestamp() END,updated_at=clock_timestamp() WHERE station_id=$1 RETURNING *",
          [sid, state, worker],
        );
        await stationEvent(
          db,
          sid,
          worker ?? station.worker_id,
          user.id,
          action,
          input.reason,
        );
        await audit(db, user.id, action, "workstations", sid, input);
        return camel(row);
      });
    });
  app.get("/api/production/station-logs", async (req) => {
    actor(req, "manager", "operator");
    const input = z.object({ stationId: uuid.optional() }).parse(req.query);
    const rows = (
      await pool.query(
        "SELECT e.*,r.name AS station_name,u.name AS worker_name,CASE WHEN e.event='no_material' THEN extract(epoch FROM (coalesce(e.ended_at,clock_timestamp())-e.started_at))/60 ELSE NULL END AS duration_minutes,CASE WHEN e.event='no_material' THEN coalesce(e.ended_at,clock_timestamp())-e.started_at >= (s.idle_threshold_minutes*interval '1 minute') ELSE false END AS threshold_exceeded FROM station_events e JOIN records r ON r.id=e.station_id LEFT JOIN users u ON u.id=e.worker_id LEFT JOIN station_execution s ON s.station_id=e.station_id WHERE ($1::uuid IS NULL OR e.station_id=$1) ORDER BY e.started_at DESC LIMIT 500",
        [input.stationId ?? null],
      )
    ).rows;
    return { items: camel(rows) };
  });
  app.get("/api/production/scrap-types", async (req) => {
    actor(req);
    return camel(
      (await pool.query("SELECT * FROM scrap_types ORDER BY code")).rows,
    );
  });
  for (const method of ["post", "patch"] as const)
    app[method](
      `/api/production/scrap-types${method === "patch" ? "/:id" : ""}`,
      async (req) => {
        const user = actor(req, "manager");
        const input = z
          .object({
            code: z.string().trim().min(1).max(80),
            name: z.string().trim().min(1).max(100),
            deductible: z.boolean(),
            active: z.boolean().default(true),
          })
          .strict()
          .parse(req.body);
        return transaction(pool, async (db) => {
          const rid =
            method === "post" ? id() : uuid.parse((req.params as any).id);
          const row = await one(
            db,
            method === "post"
              ? "INSERT INTO scrap_types(id,code,name,deductible,active) VALUES($1,$2,$3,$4,$5) RETURNING *"
              : "UPDATE scrap_types SET code=$2,name=$3,deductible=$4,active=$5 WHERE id=$1 RETURNING *",
            [rid, input.code, input.name, input.deductible, input.active],
          );
          await audit(db, user.id, method, "scrap-types", rid, input);
          return camel(row);
        });
      },
    );
  app.get("/api/production/settings", async (req) => {
    actor(req, "manager");
    return camel(
      await one(pool, "SELECT * FROM production_settings WHERE id=true"),
    );
  });
  app.patch("/api/production/settings", async (req) => {
    const user = actor(req, "manager");
    const input = z
      .object({
        revision: z.number().int().positive(),
        scrapAutoReview: z.boolean(),
        scrapMaxAmount: z.number().nonnegative().max(1000000),
      })
      .strict()
      .parse(req.body);
    return transaction(pool, async (db) => {
      const old = await one(
        db,
        "SELECT * FROM production_settings WHERE id=true FOR UPDATE",
      );
      ensure(old.revision === input.revision, "配置已更新，请刷新后重试");
      const row = await one(
        db,
        "UPDATE production_settings SET scrap_auto_review=$1,scrap_max_amount=$2,revision=revision+1,updated_by=$3 WHERE id=true RETURNING *",
        [input.scrapAutoReview, input.scrapMaxAmount, user.id],
      );
      await audit(db, user.id, "update", "production-settings", null, input);
      return camel(row);
    });
  });
}
