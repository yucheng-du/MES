import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Table } from "antd";
import { api, number } from "../api";
import { t, useLocale } from "../i18n";
import { Drawer } from "./LocalizedOverlays";
import { QueryError } from "./common";
export function StockAlerts() {
  useLocale();
  const [open, setOpen] = useState(false);
  const result = useQuery({
    queryKey: ["inventory-alerts"],
    queryFn: () => api<{ items: any[] }>("/inventory/alerts"),
    enabled: open,
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("库存预警")}</Button>
      <Drawer
        title={t("库存预警")}
        width={800}
        open={open}
        onClose={() => setOpen(false)}
      >
        <p>{t("库龄预警按当前库存扣除设定天数内入库量计算。")}</p>
        {result.error ? (
          <QueryError error={result.error} retry={result.refetch} />
        ) : (
          <Table
            rowKey="id"
            loading={result.isPending}
            dataSource={result.data?.items}
            scroll={{ x: 650 }}
            columns={[
              ["code", "编号"],
              ["name", "产品"],
              ["quantity", "库存数量"],
              ["shortage", "安全库存缺口"],
              ["agingQuantity", "超龄库存数量"],
            ].map(([key, label]) => ({
              title: t(label),
              dataIndex: key,
              render: (value: any) =>
                typeof value === "number" ? number(value) : value,
            }))}
          />
        )}
      </Drawer>
    </>
  );
}
