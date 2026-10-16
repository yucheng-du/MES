import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { localeStorageKey, setLocale, t, useLocale } from "./i18n";
import { queryClient } from "./api";
import Application from "./App";
import "./styles.css";
function LocalizedApplication() {
  const { locale } = useLocale();
  dayjs.locale(locale === "zh-CN" ? "zh-cn" : "en");
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("MES · 制造执行系统");
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        t("开源制造执行系统，集成生产、质量、库存和计件工资管理。"),
      );
  }, [locale]);
  useEffect(() => {
    const native = (event: Event) => {
      const value = (event as CustomEvent).detail?.locale;
      if (value === "zh-CN" || value === "en-US") setLocale(value, false);
    };
    const storage = (event: StorageEvent) => {
      if (
        event.key === localeStorageKey &&
        (event.newValue === "zh-CN" || event.newValue === "en-US")
      )
        setLocale(event.newValue, false);
    };
    window.addEventListener("mes-language", native);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener("mes-language", native);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return (
    <ConfigProvider
      locale={locale === "zh-CN" ? zhCN : enUS}
      button={{ loadingIcon: <LoadingOutlined aria-hidden="true" /> }}
      form={{ validateMessages: { required: t("此项为必填项") } }}
      theme={{
        token: {
          colorPrimary: "#176b64",
          colorInfo: "#176b64",
          colorSuccess: "#298467",
          colorWarning: "#c58a34",
          colorError: "#c85c54",
          colorText: "#243a3a",
          colorTextSecondary: "#71827f",
          colorBgLayout: "#f4f6f5",
          borderRadius: 8,
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Table: {
            headerBg: "#f6f8f7",
            headerColor: "#69807b",
            cellPaddingBlock: 15,
          },
          Button: { controlHeight: 38 },
          Input: { controlHeight: 38 },
          Select: { controlHeight: 38 },
          Menu: { itemSelectedBg: "#e6f1ed", itemSelectedColor: "#176b64" },
        },
      }}
    >
      <App>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Application />
          </BrowserRouter>
        </QueryClientProvider>
      </App>
    </ConfigProvider>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalizedApplication />
  </React.StrictMode>,
);
