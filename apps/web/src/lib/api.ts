import { clearAuthTokens, getAccessToken, getRefreshToken, setAuthTokens } from "./auth-tokens";
import { useAppStore } from "./store";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const API_URL = `${API_BASE_URL}/api/v1`;
const IS_REMOTE_API = !API_BASE_URL.includes("localhost");

function apiUnreachableMessage() {
  if (IS_REMOTE_API) {
    return `Cannot reach API at ${API_BASE_URL}. The server may be waking up on Render — wait 30–60 seconds and try again.`;
  }
  return `Cannot reach API at ${API_BASE_URL}. Make sure the backend is running on port 4000.`;
}

async function readApiPayload(response: Response): Promise<{ success?: boolean; data?: unknown; error?: string }> {
  const text = await response.text();
  if (!text) {
    return {
      success: response.ok,
      error: response.ok ? undefined : `Request failed (${response.status})`,
    };
  }

  try {
    return JSON.parse(text) as { success?: boolean; data?: unknown; error?: string };
  } catch {
    const trimmed = text.trim();
    if (/too many requests/i.test(trimmed)) {
      return {
        success: false,
        error: "Too many requests. Please wait a minute and try again.",
      };
    }
    return {
      success: false,
      error: trimmed.slice(0, 180) || `Request failed (${response.status})`,
    };
  }
}

async function fetchWithRetry(url: string, init?: RequestInit) {
  const maxAttempts = IS_REMOTE_API ? 4 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fetch(url, { ...init, cache: "no-store" });
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  throw lastError ?? new Error(apiUnreachableMessage());
}

export async function wakeApi() {
  const response = await fetchWithRetry(`${API_BASE_URL}/health`);
  if (!response.ok) {
    throw new Error(apiUnreachableMessage());
  }
  return response.json();
}

async function getCsrfToken() {
  const response = await fetchWithRetry(`${API_BASE_URL}/csrf-token`, {
    credentials: "include",
  }).catch(() => {
    throw new Error(apiUnreachableMessage());
  });
  const payload = await readApiPayload(response);
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error ?? "Failed to get CSRF token");
  }
  return (payload.data as { csrfToken: string }).csrfToken;
}

async function refreshSession() {
  const refreshToken = getRefreshToken();
  const csrfToken = await getCsrfToken();
  const response = await fetchWithRetry(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "csrf-token": csrfToken,
    },
    body: JSON.stringify(refreshToken ? { refreshToken } : {}),
  });

  const payload = await readApiPayload(response);
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

  const response = await fetchWithRetry(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "csrf-token": csrfToken } : {}),
      ...(init?.headers ?? {}),
    },
  }).catch(() => {
    throw new Error(apiUnreachableMessage());
  });

  const payload = await readApiPayload(response);
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
