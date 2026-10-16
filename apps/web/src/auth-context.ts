import { createContext, useContext } from "react";
import type { User } from "./api";

// Kept outside the router module so pages and HMR share one stable provider.
export const UserContext = createContext<User | null>(null);
export function useUser(): User {
  const user = useContext(UserContext);
  if (!user)
    throw new Error(
      "User context is unavailable outside the authenticated workspace",
    );
  return user;
}
export const canManage = (user: User) =>
  ["admin", "manager"].includes(user.role);
export const canQuality = (user: User) =>
  ["admin", "manager", "quality"].includes(user.role);
