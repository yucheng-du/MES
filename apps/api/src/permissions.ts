import type { FastifyRequest } from "fastify";
import { resourceDefinitions } from "@mes/shared";
export type PermissionUser = {
  role: string;
  allowedPermissions?: string[];
  deniedPermissions?: string[];
};
export function hasPermission(
  user: PermissionUser,
  key: string,
  roles: readonly string[] = [],
) {
  if (user.role === "admin") return true;
  if (user.deniedPermissions?.includes(key)) return false;
  if (user.allowedPermissions?.includes(key)) return true;
  return !roles.length || roles.includes(user.role);
}
export function permissionKey(req: FastifyRequest) {
  const parts = req.url
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .slice(1)
    .map((part) => decodeURIComponent(part));
  if (
    parts[0] === "users" &&
    parts[1] === req.actor?.id &&
    parts[2] === "password"
  )
    return "";
  if (
    !parts[0] ||
    [
      "auth",
      "health",
      "events",
      "lookups",
      "catalog",
      "permissions",
      "android",
    ].includes(parts[0])
  )
    return "";
  const action =
    [
      "/api/reports/batch-review",
      "/api/resources/:key/:id/transition",
    ].includes(req.routeOptions.url ?? "") &&
    typeof req.body === "object" &&
    req.body
      ? (req.body as any).action
      : undefined;
  const tail = parts.at(-1);
  const mode = ["GET", "HEAD"].includes(req.method)
    ? "read"
    : [
          "approve",
          "reject",
          "pay",
          "confirm",
          "approve-payment",
          "reject-payment",
          "return",
          "reverse",
        ].includes(action || tail)
      ? "approve"
      : "write";
  return parts[0] === "resources"
    ? `resources:${parts[1]}:${mode}`
    : `${parts[0]}:${mode}`;
}
export function permissionCatalog(domains: Set<string>) {
  const names: Record<string, string> = {
    products: "产品与工艺",
    "sales-orders": "销售订单",
    "work-orders": "生产工单",
    tasks: "生产任务",
    reports: "报工审批",
    scraps: "报废审核",
    inventory: "成品库存",
    "stock-movements": "库存流水",
    payroll: "计件薪酬",
    users: "成员与权限",
    "audit-logs": "操作记录",
    telemetry: "设备运行",
    integrations: "设备集成",
    files: "业务附件",
    statistics: "经营统计",
    "production-settings": "生产设置",
    "auto-review": "报工自动审核",
    production: "生产设置",
    boards: "车间看板",
    "material-inventory": "物料库存",
    "andon-alarms": "安灯报警",
    settings: "系统设置",
    dashboard: "工作概览",
  };
  const entries = [...domains]
    .filter(
      (k) =>
        ![
          "resources",
          "auth",
          "health",
          "events",
          "lookups",
          "catalog",
          "permissions",
          "android",
        ].includes(k),
    )
    .map((key) => ({ key, label: names[key] || key }));
  entries.push(
    ...resourceDefinitions.map((def) => ({
      key: `resources:${def.key}`,
      label: def.title,
    })),
  );
  return entries.flatMap((entry) =>
    ["read", "write", "approve"].map((mode) => ({
      key: `${entry.key}:${mode}`,
      label: entry.label,
      action: mode,
    })),
  );
}
