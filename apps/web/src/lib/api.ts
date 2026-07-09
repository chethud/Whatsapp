import { clearAuthTokens, getAccessToken, getRefreshToken, setAuthTokens } from "./auth-tokens";
import { useAppStore } from "./store";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const API_URL = `${API_BASE_URL}/api/v1`;

async function getCsrfToken() {
  const response = await fetch(`${API_BASE_URL}/csrf-token`, {
    credentials: "include",
    cache: "no-store",
  }).catch(() => {
    throw new Error(`Cannot reach API at ${API_BASE_URL}. Make sure the backend is running on port 4000.`);
  });
  const payload = await response.json();
  return payload.data.csrfToken as string;
}

async function refreshSession() {
  const refreshToken = getRefreshToken();
  const csrfToken = await getCsrfToken();
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "csrf-token": csrfToken,
    },
    body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error ?? "Session expired");
  }

  const { accessToken, refreshToken: nextRefreshToken } = payload.data as {
    accessToken: string;
    refreshToken: string;
  };

  setAuthTokens(accessToken, nextRefreshToken);
  useAppStore.getState().setAccessToken(accessToken);
  return accessToken;
}

function clearSession() {
  clearAuthTokens();
  useAppStore.getState().setAccessToken(null);
  useAppStore.getState().setUser(null);
}

type ApiOptions = {
  skipAuthRetry?: boolean;
};

export async function api<T>(path: string, init?: RequestInit, options?: ApiOptions): Promise<T> {
  const token = getAccessToken();
  const method = init?.method?.toUpperCase() ?? "GET";
  const csrfToken = ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? await getCsrfToken() : undefined;

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "csrf-token": csrfToken } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  }).catch(() => {
    throw new Error(`Cannot reach API at ${API_BASE_URL}. Make sure the backend is running on port 4000.`);
  });

  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    if (
      response.status === 401 &&
      !options?.skipAuthRetry &&
      !path.startsWith("/auth/login") &&
      !path.startsWith("/auth/refresh")
    ) {
      try {
        await refreshSession();
        return api<T>(path, init, { skipAuthRetry: true });
      } catch {
        clearSession();
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.assign("/login");
        }
        throw new Error("Session expired. Please sign in again.");
      }
    }

    throw new Error(payload.error ?? "Request failed");
  }

  return payload.data as T;
}
