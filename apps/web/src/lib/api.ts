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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token =
    typeof window !== "undefined" ? window.localStorage.getItem("wa_access_token") : undefined;
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
    throw new Error(payload.error ?? "Request failed");
  }

  return payload.data as T;
}
