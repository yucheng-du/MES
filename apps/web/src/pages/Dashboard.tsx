import { t, useLocale } from "../i18n";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, Empty, Progress, Skeleton, Table, Tag } from "antd";
import {
  ApartmentOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  InboxOutlined,
  ScanOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { api, dateOnly, money, number, type Row } from "../api";
import { useUser } from "../auth-context";
import { PageHeading, Panel, QueryError, Status } from "../components/common";
export default function Dashboard() {
  const { locale } = useLocale();
  const user = useUser();
  const query = useQuery({
    queryKey: ["/dashboard"],
    queryFn: () => api("/dashboard"),
  });
  if (query.error)
    return <QueryError error={query.error} retry={query.refetch} />;
  const d = query.data;
  const m = d?.metrics;
  const stats = [
    {
      label: t("进行中的工单"),
      value: m?.activeWorkOrders,
      unit: t("单"),
      icon: <ApartmentOutlined />,
      tone: "green",
      note: t("正在推进的生产计划"),
    },
    {
      label: t("今日成品完工"),
      value: m?.todayCompleted,
      unit: t("件"),
      icon: <CheckCircleOutlined />,
      tone: "blue",
      note: t("末道工序完成的合格数量"),
    },
    {
      label: t("等待报工审核"),
      value: m?.pendingReports,
      unit: t("笔"),
      icon: <FileDoneOutlined />,
      tone: "amber",
      note:
        m?.manualReviewReports === undefined
          ? t("审核后确认计件工资")
          : t("其中 {count} 笔需要人工核对", {
              count: number(m.manualReviewReports),
            }),
    },
    {
      label: t("当前成品库存"),
      value: m?.inventoryQuantity,
      unit: t("件"),
      icon: <InboxOutlined />,
      tone: "purple",
      note: t("全厂可用成品数量"),
    },
  ];
  const statusEntries = Array.isArray(d?.productionByStatus)
    ? d.productionByStatus
    : Object.entries(d?.productionByStatus || {}).map(([status, count]) => ({
        status,
        count,
      }));
  const total = statusEntries.reduce(
    (s: number, r: any) => s + Number(r.count || 0),
    0,
  );
  return (
    <>
      <div className="dashboard-welcome">
        <div>
          <div className="eyebrow">{t("OVERVIEW / 今天的工厂")}</div>
          <h1>{t("{name}，工作顺利。", { name: user.name })}</h1>
          <p>{t("从全局看进度，从细节保交付。今天的生产，从这里开始。")}</p>
        </div>
        <div className="today-label">
          <span>
            {new Date().toLocaleDateString(locale, {
              month: "long",
              day: "numeric",
            })}
          </span>
          <small>
            {new Date().toLocaleDateString(locale, { weekday: "long" })}
          </small>
        </div>
      </div>
      <section className="overview-hero">
        <div className="hero-copy">
          <Tag bordered={false}>{t("让每一道工序，顺畅衔接")}</Tag>
          <h2>
            {t("生产有计划，")}
            <br />
            {t("交付有把握。")}
          </h2>
          <p>
            {t("把现场进度、品质审核和库存交接，")}
            <br />
            {t("连成一条看得见的生产线。")}
          </p>
          <Link to="/work-orders">
            <Button type="primary" icon={<ArrowRightOutlined />}>
              {t("查看生产工单")}
            </Button>
          </Link>
        </div>
        <div className="factory-illustration" aria-hidden="true">
          <div className="illustration-grid" />
          <div className="plant-back">
            <i />
            <i />
            <i />
          </div>
          <div className="plant-main">
            <div className="plant-roof" />
            <div className="plant-windows">
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="plant-door" />
          </div>
          <div className="plant-cube cube-one" />
          <div className="plant-cube cube-two" />
          <div className="plant-line line-one" />
          <div className="plant-line line-two" />
          <div className="plant-badge">
            <span /> MES · CONNECTED
          </div>
        </div>
      </section>
      <div className="metric-grid">
        {stats.map((s) => (
          <div className="metric-card" key={s.label}>
            <div className="metric-top">
              <span>{s.label}</span>
              <div className={`metric-icon ${s.tone}`}>{s.icon}</div>
            </div>
            <div className="metric-value">
              {m ? number(s.value) : "—"}
              <small>{s.unit}</small>
            </div>
            <p>{s.note}</p>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <Panel
          title={t("生产进行时")}
          description={t("最近下达的工单与当前进度")}
          action={
            <Link to="/work-orders">
              {t("全部工单")}
              <ArrowRightOutlined />
            </Link>
          }
        >
          <Table<Row>
            rowKey="id"
            loading={query.isLoading}
            pagination={false}
            dataSource={d?.recentWorkOrders?.slice(0, 6) || []}
            scroll={{ x: 460 }}
            columns={[
              {
                title: t("工单 / 产品"),
                render: (_, r) => (
                  <div className="cell-stack">
                    <Link to={`/work-orders/${r.id}`} className="mono">
                      {r.code}
                    </Link>
                    <span>{r.productName}</span>
                  </div>
                ),
              },
              {
                title: t("完工进度"),
                width: 170,
                render: (_, r) => (
                  <div className="progress-cell">
                    <span>
                      {number(r.completedQuantity)} / {number(r.quantity)}
                    </span>
                    <Progress
                      size="small"
                      percent={Math.min(
                        100,
                        Math.round(
                          (Number(r.completedQuantity || 0) /
                            Number(r.quantity || 1)) *
                            100,
                        ),
                      )}
                      showInfo={false}
                    />
                  </div>
                ),
              },
              {
                title: t("状态"),
                dataIndex: "status",
                render: (v) => <Status value={v} />,
              },
            ]}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("还没有工单，下达第一张生产计划。")}
                />
              ),
            }}
          />
        </Panel>
        <div className="dashboard-side">
          <Panel title={t("需要关注")} description={t("把下一步行动安排好")}>
            <Link to="/reports?reviewMode=manual" className="attention-item">
              <div className="attention-icon amber">
                <FileDoneOutlined />
              </div>
              <div>
                <strong>{t("报工需人工审核")}</strong>
                <span>{t("核对异常原因，确认计件工资")}</span>
              </div>
              <b>
                {m?.manualReviewReports === undefined
                  ? "—"
                  : number(m.manualReviewReports)}
              </b>
              <ArrowRightOutlined />
            </Link>
            <Link to="/resources/andon-events" className="attention-item">
              <div className="attention-icon rose">
                <WarningOutlined />
              </div>
              <div>
                <strong>{t("现场安灯问题")}</strong>
                <span>{t("及时响应，恢复生产")}</span>
              </div>
              <b>{number(m?.openAndons)}</b>
              <ArrowRightOutlined />
            </Link>
            <Link to="/station" className="station-shortcut">
              <ScanOutlined />
              <div>
                <strong>{t("前往车间工作站")}</strong>
                <span>{t("扫码 · 收料 · 开工 · 完工")}</span>
              </div>
              <ArrowRightOutlined />
            </Link>
          </Panel>
          <Panel title={t("工单状态分布")}>
            <div className="status-distribution">
              {statusEntries.length ? (
                statusEntries.map((r: any) => (
                  <div key={r.status}>
                    <div>
                      <Status value={r.status} />
                      <strong>
                        {r.count} <small>{t("单")}</small>
                      </strong>
                    </div>
                    <Progress
                      showInfo={false}
                      percent={total ? (Number(r.count) / total) * 100 : 0}
                      strokeColor={
                        r.status === "working"
                          ? "#176b64"
                          : r.status === "complete"
                            ? "#76aaa0"
                            : "#c3d4ce"
                      }
                      size="small"
                    />
                  </div>
                ))
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("暂无工单统计")}
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
      <div className="dashboard-bottom">
        <Panel
          title={t("库存关注")}
          description={t("低于安全库存的产品")}
          action={
            <Link to="/inventory">
              {t("管理库存")}
              <ArrowRightOutlined />
            </Link>
          }
        >
          <div className="low-stock-list">
            {d?.lowStock?.length ? (
              d.lowStock.slice(0, 4).map((r: Row) => (
                <div key={r.id || r.productId}>
                  <span>{r.productName || r.name}</span>
                  <Tag color="gold">
                    {t("现有 {quantity} / 安全 {safety}", {
                      quantity: number(r.quantity),
                      safety: number(r.safetyStock),
                    })}
                  </Tag>
                </div>
              ))
            ) : (
              <div className="quiet-state">
                <CheckCircleOutlined /> {t("当前没有低库存提醒")}
              </div>
            )}
          </div>
        </Panel>
        {["admin", "manager"].includes(user.role) ? (
          <div className="payroll-summary">
            <div>
              <span>{t("本月已入账薪酬")}</span>
              <strong>{m ? money(m.payrollThisMonth) : "—"}</strong>
              <p>{t("有来源的付出，看得见的回报。")}</p>
            </div>
            <Link to="/payroll">
              <Button>
                {t("查看工资明细")}
                <ArrowRightOutlined />
              </Button>
            </Link>
          </div>
        ) : (
          <Panel
            title={t("今日质量记录")}
            description={t("当天审核通过的报废数量")}
          >
            <div className="quality-day-count">
              {number(m?.todayScrap)} <small>{t("件")}</small>
              <Link to="/scraps">
                {t("查看报废记录")}
                <ArrowRightOutlined />
              </Link>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
