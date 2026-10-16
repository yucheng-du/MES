import { createApp } from "./app.js";
import { createPool, id, transaction, ensure } from "./db.js";
import { hashPassword } from "./auth.js";
import { migrate } from "./migrate.js";
ensure(process.env.NODE_ENV !== "production", "演示数据不能在生产环境创建");
const pool = createPool();
try {
  await migrate(pool);
  const existing = (await pool.query("SELECT id FROM users LIMIT 1")).rowCount;
  if (existing) {
    console.log("Seed skipped: database already has users.");
  } else {
    const hash = await hashPassword("MesDemo2026!");
    await transaction(pool, async (db) => {
      for (const [username, name, role] of [
        ["admin", "Demo Admin", "admin"],
        ["manager", "Demo Manager", "manager"],
        ["operator", "Demo Operator", "operator"],
        ["quality", "Demo Quality", "quality"],
        ["warehouse", "Demo Warehouse", "warehouse"],
        ["viewer", "Demo Viewer", "viewer"],
      ])
        await db.query(
          "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
          [id(), username, name, hash, role],
        );
    });
    const app = await createApp({ pool });
    const origin =
      process.env.APP_ORIGIN?.split(",")[0].trim() || "http://localhost:5173";
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { username: "admin", password: "MesDemo2026!" },
    });
    ensure(login.statusCode === 200, "演示登录失败");
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const api = async (
      method: "POST" | "GET",
      url: string,
      payload?: unknown,
    ) => {
      const result = await app.inject({
        method,
        url: `/api${url}`,
        headers: { origin, cookie },
        payload: payload as any,
      });
      if (result.statusCode >= 400)
        throw new Error(`Seed ${url}: ${result.body}`);
      return result.json();
    };
    const customer = await api("POST", "/resources/customers", {
      code: "C-001",
      name: "Demo Customer",
      data: { contact: "Demo Contact", address: "Demo Industrial Park" },
    });
    await api("POST", "/resources/suppliers", {
      code: "S-001",
      name: "Demo Supplier",
      data: { contact: "Demo Supplier Contact" },
    });
    await api("POST", "/resources/departments", {
      code: "D-001",
      name: "生产一班",
      data: { manager: "Demo Manager" },
    });
    const device = await api("POST", "/resources/devices", {
      code: "DEV-001",
      name: "一号数控加工中心",
      data: {
        model: "CNC-650",
        deviceNo: "CNC001",
        location: "加工车间",
        networked: false,
      },
    });
    await api("POST", "/resources/workstations", {
      code: "ST-001",
      name: "精加工一号工位",
      data: {
        deviceId: device.id,
        location: "加工车间",
        processName: "精加工",
      },
    });
    await api("POST", "/resources/materials", {
      code: "MAT-001",
      name: "铝合金棒料",
      data: { unit: "千克", safetyStock: 200 },
    });
    await api("POST", "/resources/auxiliary-materials", {
      code: "AUX-001",
      name: "切削液",
      data: { unit: "升", safetyStock: 20 },
    });
    const product = await api("POST", "/products", {
      code: "P-1001",
      name: "液压阀体",
      unit: "件",
      safetyStock: 100,
      steps: [
        { name: "精加工", unitPrice: 2.5, expectedMinutes: 3 },
        { name: "终检", unitPrice: 0.5, expectedMinutes: 1 },
      ],
    });
    const product2 = await api("POST", "/products", {
      code: "P-1002",
      name: "连接法兰",
      unit: "件",
      safetyStock: 50,
      steps: [{ name: "精加工", unitPrice: 1.8, expectedMinutes: 2 }],
    });
    const so = await api("POST", "/sales-orders", {
      customerId: customer.id,
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      items: [
        { productId: product.id, quantity: 500, unitPrice: 35 },
        { productId: product2.id, quantity: 200, unitPrice: 20 },
      ],
      notes: "演示订单，可完整执行生产到发货流程",
    });
    let wo = await api("POST", "/work-orders", {
      productId: product.id,
      salesOrderId: so.id,
      quantity: 80,
      priority: "urgent",
    });
    for (const task of wo.tasks) {
      const r = await api("POST", `/tasks/${task.id}/receive`, {
        requestId: id(),
      });
      await api("POST", `/reports/${r.id}/start`, {});
      await api("POST", `/reports/${r.id}/complete`, {
        quantity: 80,
        requestId: id(),
      });
      await api("POST", `/reports/${r.id}/approve`, { requestId: id() });
    }
    await api("POST", "/stock-movements", {
      productId: product.id,
      salesOrderId: so.id,
      direction: "in",
      quantity: 80,
      reason: "演示工单正常完工入库",
      requestId: id(),
    });
    await api("POST", "/stock-movements", {
      productId: product.id,
      salesOrderId: so.id,
      direction: "out",
      quantity: 20,
      reason: "演示订单部分发货",
      requestId: id(),
    });
    await api("POST", "/work-orders", {
      productId: product.id,
      salesOrderId: so.id,
      quantity: 120,
    });
    await api("POST", "/work-orders", {
      productId: product2.id,
      salesOrderId: so.id,
      quantity: 60,
    });
    await app.close();
    console.log(
      "Demo seeded. Accounts admin/manager/operator/quality/warehouse/viewer use MesDemo2026!",
    );
  }
} finally {
  await pool.end();
}
