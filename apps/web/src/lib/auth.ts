import { api } from "./api";
import { useAppStore, type AuthUser } from "./store";

export async function bootstrapAuth() {
  const { setAccessToken, setUser } = useAppStore.getState();

  try {
    const user = await api<AuthUser>("/auth/me");
    setUser(user);
    return user;
  } catch {
    try {
      const refreshed = await api<{
        accessToken: string;
        user: AuthUser;
      }>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setAccessToken(refreshed.accessToken);
      setUser(refreshed.user);
      return refreshed.user;
    } catch {
      setAccessToken(null);
      setUser(null);
      return null;
    }
  }
}

export async function logout() {
  const { setAccessToken, setUser } = useAppStore.getState();
  try {
    await api("/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // Ignore logout failures and clear local state anyway.
  }
  setAccessToken(null);
  setUser(null);
}
