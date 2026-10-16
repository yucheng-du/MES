import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { resourceDefinitions } from "@mes/shared";
import { getLocale, messages, setLocale, t } from "./i18n";

test("language changes preserve interpolated data and support switching back", () => {
  setLocale("en-US");
  assert.equal(getLocale(), "en-US");
  assert.equal(t("账号"), "Username");
  assert.equal(
    t("已选择打印机：{printer}", { printer: "车间 $& {x}" }),
    "Printer selected: 车间 $& {x}",
  );
  assert.equal(t("自定义产品名"), "自定义产品名");
  setLocale("zh-CN");
  assert.equal(
    t("已选择打印机：{printer}", { printer: "Printer A" }),
    "已选择打印机：Printer A",
  );
});

test("server errors translate fields and quantities without changing the values", () => {
  setLocale("en-US");
  assert.equal(t("账号或密码错误"), "Incorrect username or password");
  assert.equal(t("联系人不能为空"), "Contact is required");
  assert.equal(
    t("入库超出已完工可入库量 12.5"),
    "Stock receipt exceeds the completed quantity available: 12.5",
  );
  assert.equal(
    t("自动审核已停用，需要人工审核"),
    "Automatic review is disabled; manual review is required",
  );
  setLocale("zh-CN");
});

test("every business record definition has English display metadata", () => {
  const missing = new Set<string>();
  const check = (value?: string) => {
    if (
      value &&
      /[\u3400-\u9fff]/.test(value) &&
      !Object.hasOwn(messages, value)
    )
      missing.add(value);
  };
  for (const resource of resourceDefinitions) {
    [resource.title, resource.group, resource.description].forEach(check);
    const inspectFields = (fields: typeof resource.fields) => {
      for (const field of fields) {
        [field.label, field.unit].forEach(check);
        field.options?.forEach((option) => check(option.label));
        if (field.fields) inspectFields(field.fields);
      }
    };
    inspectFields(resource.fields);
  }
  assert.deepEqual([...missing], []);
});

test("Web translation keys and display metadata have English text", () => {
  const root = fileURLToPath(new URL("./", import.meta.url));
  const missing = new Set<string>();
  function inspect(folder: string) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== "locales") inspect(path);
      if (
        !entry.isFile() ||
        !/\.(ts|tsx)$/.test(entry.name) ||
        entry.name.endsWith(".test.ts")
      )
        continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        // Board columns and other display metadata pass their labels to t()
        // dynamically. Check those literals too, not just direct t("…") calls.
        if (
          entry.name.endsWith(".tsx") &&
          entry.name !== "LanguageSwitch.tsx" &&
          ts.isStringLiteral(node) &&
          /[\u3400-\u9fff]/.test(node.text) &&
          !Object.hasOwn(messages, node.text)
        )
          missing.add(node.text);
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === "t" &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const key = node.arguments[0].text;
          if (/[\u3400-\u9fff]/.test(key) && !Object.hasOwn(messages, key))
            missing.add(key);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  inspect(root);
  assert.deepEqual([...missing], []);
});
