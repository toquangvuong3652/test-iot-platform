import { getAccess, refresh, logout } from "./auth";
import { API_BASE } from "./env";

/**
 * API client for the standard envelope { data, error }.
 * On 401, attempts one refresh and retries; on failure, logs out.
 */
export async function api<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  const token = getAccess();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && !retried) {
    console.log("[api] ENTER 401 BLOCK:", path);

    console.log("[api] BEFORE refresh");
    const ok = await refresh();
    console.log("[api] AFTER refresh:", ok);

    if (ok) {
      console.log("[api] RETRY:", path);
      return api<T>(path, init, true);
    }

    console.log("[api] LOGOUT");
    logout();
    throw new Error("Session expired");
  }

  const body = await res.json().catch(() => ({ data: null, error: { code: "bad_response", message: res.statusText } }));
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body.data as T;
}

