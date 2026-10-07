/**
 * Client-side auth (Spec §6). The access token is kept in localStorage and sent
 * as a Bearer header; the socket handshake reuses it. On 401 we try a refresh
 * once, then log out.
 */

import { API_BASE } from "./env";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
}

const ACCESS_KEY = "iot.access";
const REFRESH_KEY = "iot.refresh";

export function getAccess(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function storeTokens(pair: TokenPair) {
  window.localStorage.setItem(ACCESS_KEY, pair.access_token);
  window.localStorage.setItem(REFRESH_KEY, pair.refresh_token);
}

export function logout() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.location.href = "/login";
}

let refreshPromise: Promise<boolean> | null = null;

export async function refresh(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = window.localStorage.getItem(REFRESH_KEY);

    if (!refreshToken) {
      return false;
    }

    console.log("[auth] refresh() called");

    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          refresh_token: refreshToken,
        }),
      });

      console.log("[auth] refresh response:", res.status);

      if (!res.ok) {
        return false;
      }

      const body = await res.json();
      storeTokens(body.data as TokenPair);

      console.log("[auth] refresh success");

      return true;
    } catch (err) {
      console.error("[auth] refresh error:", err);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}
