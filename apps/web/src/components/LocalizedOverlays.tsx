import { Drawer as AntDrawer, Modal as AntModal, Space } from "antd";
import type { DrawerProps, ModalProps } from "antd";
import { LanguageSwitch } from "./LanguageSwitch";

/** Keep language selection inside the active dialog, without closing a form. */
export function Drawer({ extra, rootClassName, ...props }: DrawerProps) {
  return (
    <AntDrawer
      {...props}
      rootClassName={`localized-drawer ${rootClassName || ""}`}
      extra={
        <Space wrap>
          <LanguageSwitch />
          {extra}
        </Space>
      }
    />
  );
}
export function Modal({ title, children, ...props }: ModalProps) {
  return (
    <AntModal {...props} title={title}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 16,
        }}
      >
        <LanguageSwitch />
      </div>
      {children}
    </AntModal>
  );
}
