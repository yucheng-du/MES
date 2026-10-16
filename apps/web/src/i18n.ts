import { equipmentParityMessages } from "./locales/equipment-parity";
import { managementParityMessages } from "./locales/management-parity";
import { productionParityMessages } from "./locales/production-parity";
import { administrationMessages } from "./locales/administration";
import { useSyncExternalStore } from "react";
import { commonMessages } from "./locales/common";
import { productionMessages } from "./locales/production";
import { managementMessages } from "./locales/management";
import { serverMessages } from "./locales/server";

export type Locale = "zh-CN" | "en-US";
export const localeStorageKey = "mes.locale";
export const messages: Record<string, string> = {
  ...administrationMessages,
  ...productionParityMessages,
  ...managementParityMessages,
  ...equipmentParityMessages,
  ...managementMessages,
  ...productionMessages,
  ...serverMessages,
  ...commonMessages,
};
function initialLocale(): Locale {
  try {
    return globalThis.localStorage?.getItem(localeStorageKey) === "en-US"
      ? "en-US"
      : "zh-CN";
  } catch {
    return "zh-CN";
  }
}
let locale: Locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export function setLocale(next: Locale, notifyNative = true) {
  if (next !== "zh-CN" && next !== "en-US") return;
  try {
    globalThis.localStorage?.setItem(localeStorageKey, next);
  } catch {
    /* Private browsing can disable storage. */
  }
  if (locale !== next) {
    locale = next;
    listeners.forEach((listener) => listener());
  }
  if (notifyNative && typeof window !== "undefined")
    window.MesNative?.setLanguage?.(next);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLocale() {
  return {
    locale: useSyncExternalStore(subscribe, getLocale, () => "zh-CN" as Locale),
    setLocale,
  };
}
const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(messages)
  .filter(([key]) => /\{\w+\}/.test(key))
  .map(([key, value]) => {
    const names = [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    const pattern = new RegExp(
      "^" +
        key
          .split(/\{\w+\}/)
          .map(escapeRegex)
          .join("([\\s\\S]*?)") +
        "$",
    );
    return { pattern, names, value };
  });
const interpolate = (text: string, params: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : token,
  );
/** Translate system-owned text only. Business names, notes, codes and stored values stay unchanged. */
export function t(
  source: string,
  params: Record<string, string | number> = {},
): string {
  if (locale === "zh-CN") return interpolate(source, params);
  if (Object.hasOwn(messages, source))
    return interpolate(messages[source], params);
  // Server messages may already contain values; preserve those values while translating the template.
  if (/[\u3400-\u9fff]/.test(source)) {
    for (const { pattern, names, value } of patterns) {
      const match = pattern.exec(source);
      if (match)
        return interpolate(
          value,
          Object.fromEntries(
            names.map((name, index) => [
              name,
              name === "field" ? t(match[index + 1]) : match[index + 1],
            ]),
          ),
        );
    }
  }
  return interpolate(source, params);
}
