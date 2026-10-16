import { Button } from "antd";
import { GlobalOutlined } from "@ant-design/icons";
import { useLocale } from "../i18n";

export function LanguageSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <Button
      className="language-switch"
      icon={<GlobalOutlined />}
      onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
      aria-label={locale === "zh-CN" ? "Switch to English" : "切换为中文"}
    >
      {locale === "zh-CN" ? "English" : "中文"}
    </Button>
  );
}
