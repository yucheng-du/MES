import { t, getLocale } from "./i18n";
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { App } from "antd";
import { createIntentSender, type ActionInput } from "./intent-client";
import { readAllPages } from "./pagination";
export type Row = { id: string; [key: string]: any };
export type List<T = Row> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type User = {
  id: string;
  name: string;
  username: string;
  role: string;
  active?: boolean;
  allowedPermissions?: string[];
  deniedPermissions?: string[];
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  }).catch(() => {
    throw new Error("网络连接失败，请检查连接后重试。");
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      response.status,
      data?.error?.message || `请求未完成（${response.status}）`,
      data?.error?.details,
    );
  return data as T;
}
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 1,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
export const queryString = (params: Record<string, unknown>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  return p.toString();
};
export function useList(
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [path, params],
    queryFn: () => api<List>(`${path}?${queryString(params)}`),
    enabled,
  });
}
export function fetchAllRecords(
  path: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
) {
  return readAllPages<Row>((page, pageSize) =>
    api<List>(`${path}?${queryString({ ...params, page, pageSize })}`, {
      signal,
    }),
  );
}

/** Shared complete reference list. The server is still read page by page. */
export function useOptions(
  path: string,
  params: Record<string, unknown> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: [path, "options", params],
    queryFn: ({ signal }) => fetchAllRecords(path, params, signal),
    enabled,
  });
}
const actionSender = createIntentSender(({ path, data, method }) =>
  api(path, {
    method,
    body: data === undefined ? undefined : JSON.stringify(data),
  }),
);
export const clearActionIntents = actionSender.clear;
export function useAction(success = t("操作已完成")) {
  const { message } = App.useApp();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ActionInput) => actionSender.send(input),
    onSuccess: () => {
      void client.invalidateQueries();
      if (success) void message.success(t(success));
    },
    onError: (e: Error) => void message.error(t(e.message)),
  });
}
export const requestId = () => crypto.randomUUID();
export const money = (n: unknown) =>
  new Intl.NumberFormat(getLocale(), {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(Number(n || 0));
export const number = (n: unknown) =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 }).format(
    Number(n || 0),
  );
export const dateTime = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString(getLocale(), { hour12: false }) : "—";
export const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : "—");
export const roleNames: Record<string, string> = {
  admin: "系统管理员",
  manager: "生产主管",
  operator: "车间操作员",
  quality: "质量管理员",
  warehouse: "仓库管理员",
  viewer: "只读查看",
};

/** A denied capability overrides extra grants; administrators retain recovery access. */
export function can(user: User, key: string, roles: readonly string[] = []) {
  if (user.role === "admin") return true;
  if (user.deniedPermissions?.includes(key)) return false;
  if (user.allowedPermissions?.includes(key)) return true;
  return !roles.length || roles.includes(user.role);
}
