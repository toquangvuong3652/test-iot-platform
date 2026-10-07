"use client";

import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { getAccess } from "./auth";
import { WS_BASE } from "./env";

export type RealtimeEvent =
  | { type: "telemetry"; deviceId: string; metrics: Record<string, number>; ts: string }
  | { type: "status"; deviceId: string; state: "online" | "offline" | "error"; reason?: string; ts: string }
  | { type: "alarm"; id: string; deviceId: string; severity: string; message: string; triggeredAt: string }
  | { type: "ack"; commandId: string; deviceId: string; state: "acked" | "failed"; result?: unknown; ts: string };

/**
 * Live tenant feed via the consumer's socket.io gateway (Spec §3).
 * The JWT is passed in the socket handshake auth; the gateway joins us to
 * `tenant:{tenant_id}` and we only ever see our own tenant's events.
 */
export function useRealtime(onEvent: (e: RealtimeEvent) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    const token = getAccess();
    if (!token) return;

    // WS_BASE is the consumer's socket.io origin (cross-origin; WS upgrades
    // are not proxied through Next, so the URL is explicit — see lib/env.ts).
    // Fall back to same-origin ("/") when WS_BASE is unset (dev convenience).
    const socket: Socket = io(WS_BASE || "/", {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => console.info("[rt] connected", socket.id));
    socket.on("disconnect", (r) => console.warn("[rt] disconnected", r));

    // Payload shapes are guaranteed by the consumer's gateway emits (Spec §3);
    // the cast bridges the untyped socket payload to the union.
    const map = (event: RealtimeEvent["type"]) => (payload: unknown) => {
      cb.current({ type: event, ...(payload as object) } as RealtimeEvent);
    };
    socket.on("telemetry", map("telemetry"));
    socket.on("status", map("status"));
    socket.on("alarm", map("alarm"));
    socket.on("ack", map("ack"));

    return () => {
      socket.disconnect();
    };
  }, []);
}
