import Boards from "./pages/Boards";
import { SmsLogin } from "./components/SmsLogin";
import Statistics from "./pages/Statistics";
import { AccountPassword } from "./components/AccountPassword";
import { Drawer } from "./components/LocalizedOverlays";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { t, useLocale } from "./i18n";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  App as AntApp,
  Alert,
  Avatar,
  Button,
  Dropdown,
  Form,
  Input,
  Menu,
  Spin,
  Tag,
} from "antd";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ArrowRightOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ControlOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  ScanOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import {
  can,
  api,
  ApiError,
  clearActionIntents,
  type User,
  roleNames,
} from "./api";
import { QueryError } from "./components/common";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import {
  Products,
  SalesOrders,
  WorkOrders,
  WorkOrderDetail,
} from "./pages/Production";
import { Reports, Scraps, Station } from "./pages/Execution";
import { Inventory, Payroll, Users, AuditLogs } from "./pages/Operations";
import Resources from "./pages/Resources";
import { UserContext } from "./auth-context";
function Brand({ light = false }: { light?: boolean }) {
  useLocale();
  return (
    <div className={`brand ${light ? "light" : ""}`}>
      <div className="brand-mark">
        <span />
        <span />
        <span />
      </div>
      <div>
        <strong>MES</strong>
        <small>{t("制造有序 · 协作有据")}</small>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: () => void }) {
  useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="login-page">
      <div className="login-story">
        <Brand light />
        <div className="login-story-main">
          <div className="eyebrow">FOR THE PEOPLE WHO MAKE THINGS</div>
          <h1>
            {t("把复杂留给系统。")}
            <br />
            {t("让制造，")}
            <span>{t("回归有序。")}</span>
          </h1>
          <p>
            {t("从订单到交付，连接整间工厂。")}
            <br />
            {t("连接车间、质量与仓库，让每个人看见同一份进度。")}
          </p>
          <div className="process-art" aria-hidden="true">
            <div>
              01 <strong>{t("计划")}</strong>
            </div>
            <i />
            <div>
              02 <strong>{t("生产")}</strong>
            </div>
            <i />
            <div>
              03 <strong>{t("交付")}</strong>
            </div>
          </div>
        </div>
        <div className="login-story-footer">
          {t("MES")}
          <span>{t("为小工厂的每一天而设计")}</span>
        </div>
      </div>
      <main className="login-form-pane">
        <div className="login-language">
          <LanguageSwitch />
        </div>
        <div className="login-form">
          <Tag bordered={false} color="green">
            {t("一个工作空间，连接整间工厂")}
          </Tag>
          <h2>{t("欢迎回来")}</h2>
          <p>{t("登录你的账号，继续今天的生产。")}</p>
          {error && (
            <Alert type="error" showIcon title={t(error)} className="mb-20" />
          )}
          <Form
            name="login"
            layout="vertical"
            requiredMark={false}
            onFinish={async (values) => {
              setLoading(true);
              setError("");
              try {
                await api("/auth/login", {
                  method: "POST",
                  body: JSON.stringify(values),
                });
                onLogin();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setLoading(false);
              }
            }}
          >
            <Form.Item
              name="username"
              label={t("账号")}
              rules={[{ required: true, message: t("请输入账号") }]}
            >
              <Input
                size="large"
                autoComplete="username"
                placeholder={t("输入账号")}
                prefix={<UserOutlined />}
              />
            </Form.Item>
            <Form.Item
              name="password"
              label={t("密码")}
              rules={[{ required: true, message: t("请输入密码") }]}
            >
              <Input.Password
                size="large"
                autoComplete="current-password"
                placeholder={t("输入密码")}
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={loading}
            >
              {t("进入工作台")}
              <ArrowRightOutlined />
            </Button>
          </Form>
          <SmsLogin onLogin={onLogin} />
          <div className="login-help">
            <SafetyCertificateOutlined />{" "}
            {t("账号由工厂管理员分配，所有关键操作可追溯。")}
          </div>
        </div>
        <div className="login-footer">MES · MANUFACTURING EXECUTION SYSTEM</div>
      </main>
    </div>
  );
}
function Shell({
  user,
  authError,
  reconnect,
}: {
  user: User;
  authError?: unknown;
  reconnect?: () => unknown;
}) {
  useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const client = useQueryClient();
  const { message } = AntApp.useApp();
  const [live, setLive] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/events", { withCredentials: true });
    source.onopen = () => {
      setLive(true);
      void client.invalidateQueries();
    };
    source.onerror = () => setLive(false);
    source.addEventListener("change", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void client.invalidateQueries(), 400);
    });
    const native = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.type === "printer")
        void (d.error
          ? message.error(t(d.error))
          : message.success(
              t("已选择打印机：{printer}", { printer: d.value || t("已配置") }),
            ));
      if (d?.type === "print")
        void (d.error
          ? message.error(t(d.error))
          : message.success(t("标签已发送到打印机")));
    };
    window.addEventListener("mes-native", native);
    return () => {
      source.close();
      clearTimeout(timer);
      window.removeEventListener("mes-native", native);
    };
  }, [client, message]);
  const navItems = [
    {
      type: "group" as const,
      label: t("工作空间"),
      children: [
        { key: "/", icon: <DashboardOutlined />, label: t("工作概览") },
        { key: "/boards", icon: <BarChartOutlined />, label: t("车间看板") },
        { key: "/station", icon: <ScanOutlined />, label: t("车间工作站") },
      ],
    },
    {
      type: "group" as const,
      label: t("生产与交付"),
      children: [
        {
          key: "/sales-orders",
          icon: <FileTextOutlined />,
          label: t("销售订单"),
        },
        {
          key: "/work-orders",
          icon: <ApartmentOutlined />,
          label: t("生产工单"),
        },
        { key: "/reports", icon: <FileDoneOutlined />, label: t("报工审批") },
        {
          key: "/scraps",
          icon: <SafetyCertificateOutlined />,
          label: t("报废审核"),
        },
        { key: "/inventory", icon: <DatabaseOutlined />, label: t("成品库存") },
        { key: "/devices", icon: <ToolOutlined />, label: t("设备运行") },
      ],
    },
    {
      type: "group" as const,
      label: t("资源与经营"),
      children: [
        ...(can(user, "statistics:read", ["admin", "manager"])
          ? [
              {
                key: "/statistics",
                icon: <BarChartOutlined />,
                label: t("经营统计"),
              },
            ]
          : []),
        {
          key: "/products",
          icon: <AppstoreOutlined />,
          label: t("产品与工艺"),
        },
        {
          key: "/resources/customers",
          icon: <ShopOutlined />,
          label: t("业务台账"),
        },
        ...(can(user, "payroll:read", ["admin", "manager", "operator"])
          ? [
              {
                key: "/payroll",
                icon: <WalletOutlined />,
                label: t("计件薪酬"),
              },
            ]
          : []),
        ...(can(user, "users:read", ["admin", "manager"])
          ? [{ key: "/users", icon: <TeamOutlined />, label: t("成员与权限") }]
          : []),
        ...(can(user, "audit-logs:read", ["admin", "manager"])
          ? [
              {
                key: "/audit-logs",
                icon: <ControlOutlined />,
                label: t("操作记录"),
              },
            ]
          : []),
      ],
    },
  ];
  const selected = location.pathname.startsWith("/resources/")
    ? "/resources/customers"
    : location.pathname.startsWith("/work-orders/")
      ? "/work-orders"
      : location.pathname;
  const nav = (
    <>
      <Link to="/" className="brand-link">
        <Brand />
      </Link>
      <Menu
        mode="inline"
        selectedKeys={[selected]}
        items={navItems.map((group) => ({
          ...group,
          children: group.children.filter((item) => {
            const domain: Record<string, string> = {
              "/": "dashboard",
              "/station": "tasks",
              "/products": "products",
              "/sales-orders": "sales-orders",
              "/work-orders": "work-orders",
              "/reports": "reports",
              "/scraps": "scraps",
              "/inventory": "inventory",
              "/devices": "telemetry",
              "/users": "users",
              "/payroll": "payroll",
              "/audit-logs": "audit-logs",
              "/statistics": "statistics",
            };
            return !domain[item.key] || can(user, `${domain[item.key]}:read`);
          }),
        }))}
        onClick={({ key }) => {
          navigate(key);
          setMobileOpen(false);
        }}
      />
      <div className="sidebar-foot">
        <div className="sidebar-foot-icon">
          <ToolOutlined />
        </div>
        <strong>{t("生产全流程，清晰可追溯")}</strong>
        <p>{t("用清晰的流程，做好每一件产品。")}</p>
        <span>MES / 1.0</span>
      </div>
    </>
  );
  return (
    <UserContext.Provider value={user}>
      <div className="app-shell">
        <aside className="sidebar">{nav}</aside>
        <Drawer
          placement="left"
          width={260}
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          styles={{ body: { padding: 0 } }}
          title={null}
        >
          {nav}
        </Drawer>
        <div className="app-main">
          <header className="topbar">
            <div className="topbar-left">
              <Button
                className="mobile-menu"
                type="text"
                icon={<MenuOutlined />}
                onClick={() => setMobileOpen(true)}
                aria-label={t("打开导航")}
              />
              <span className="workspace-mark">
                <span />
                {t("我的工厂")}
              </span>
              <span className="topbar-divider" />
              <span className="topbar-description">{t("生产协作空间")}</span>
            </div>
            <div className="topbar-right">
              <AccountPassword />
              <LanguageSwitch />
              <span className={`live-status ${live ? "connected" : ""}`}>
                <i />
                {live ? t("实时同步") : t("连接恢复中")}
              </span>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: "profile",
                      label: t(roleNames[user.role] || user.role),
                      disabled: true,
                    },
                    { type: "divider" },
                    {
                      key: "logout",
                      icon: <LogoutOutlined />,
                      label: t("退出登录"),
                      onClick: async () => {
                        await api("/auth/logout", { method: "POST" });
                        clearActionIntents();
                        client.clear();
                        window.location.assign("/");
                      },
                    },
                  ],
                }}
              >
                <button className="profile-button">
                  <Avatar
                    size={32}
                    style={{ background: "#e7efeb", color: "#176b64" }}
                  >
                    {user.name?.slice(-2) || "M"}
                  </Avatar>
                  <span>{user.name || user.username}</span>
                </button>
              </Dropdown>
            </div>
          </header>
          <main className="page-content">
            {!!authError && (
              <div className="mb-20">
                <QueryError
                  error={authError}
                  retry={reconnect!}
                  retryLabel={t("重新连接")}
                />
              </div>
            )}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/boards" element={<Boards />} />
              <Route path="/statistics" element={<Statistics />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/products" element={<Products />} />
              <Route path="/sales-orders" element={<SalesOrders />} />
              <Route path="/work-orders" element={<WorkOrders />} />
              <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
              <Route path="/station" element={<Station />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/scraps" element={<Scraps />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route
                path="/payroll"
                element={
                  can(user, "payroll:read", [
                    "admin",
                    "manager",
                    "operator",
                  ]) ? (
                    <Payroll />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/users"
                element={
                  can(user, "users:read", ["admin", "manager"]) ? (
                    <Users />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route path="/audit-logs" element={<AuditLogs />} />
              <Route path="/resources/:key" element={<Resources />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <footer className="app-footer">
            <span>{t("MES")}</span>
            <span>{t("以数据连接制造，让协作更简单。")}</span>
          </footer>
        </div>
      </div>
    </UserContext.Provider>
  );
}
export default function Application() {
  useLocale();
  const client = useQueryClient();
  const auth = useQuery({
    queryKey: ["auth"],
    queryFn: () => api<{ user: User }>("/auth/me"),
    retry: false,
  });
  if (auth.isLoading)
    return (
      <div className="boot-screen">
        <Brand />
        <Spin size="large" />
        <p>{t("正在连接工作空间…")}</p>
      </div>
    );
  const needsLogin =
    auth.error instanceof ApiError && auth.error.status === 401;
  if (auth.error && !needsLogin && auth.data?.user)
    return (
      <Shell
        user={auth.data.user}
        authError={auth.error}
        reconnect={auth.refetch}
      />
    );
  if (auth.error && !needsLogin)
    return (
      <div className="boot-screen">
        <Brand />
        <div className="auth-reconnect">
          <h2>{t("暂时无法连接工作空间")}</h2>
          <p>{t("你的登录信息会保留，连接恢复后即可继续工作。")}</p>
          <QueryError
            error={auth.error}
            retry={auth.refetch}
            retryLabel={t("重新连接")}
          />
        </div>
      </div>
    );
  if (needsLogin || !auth.data?.user)
    return (
      <Login
        onLogin={() => {
          clearActionIntents();
          client.removeQueries({
            predicate: (query) => query.queryKey[0] !== "auth",
          });
          void client.invalidateQueries({ queryKey: ["auth"] });
        }}
      />
    );
  return <Shell user={auth.data.user} />;
}
