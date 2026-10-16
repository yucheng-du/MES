import type { DB } from "./db.js";
import { reportEquipmentSnapshot } from "./equipment.js";
/** Freeze the source equipment evidence in the same transaction as completion. */
export async function freezeReportEquipment(db: DB, report: any) {
  if (
    !report.device_id ||
    !report.started_at ||
    !report.completed_at ||
    report.device_metrics
  )
    return report;
  report.device_metrics = await reportEquipmentSnapshot(
    db,
    report.device_id,
    report.started_at,
    report.completed_at,
  );
  await db.query("UPDATE reports SET device_metrics=$2 WHERE id=$1", [
    report.id,
    JSON.stringify(report.device_metrics),
  ]);
  return report;
}
