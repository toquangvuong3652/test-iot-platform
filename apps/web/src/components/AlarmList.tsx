"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export interface AlarmRow {
  id: string;
  deviceId: string;
  // Present on rows fetched from the api, absent on live realtime events
  // (the consumer's alarm emit doesn't carry the rule object). Unused in UI.
  rule?: Record<string, unknown>;
  message: string;
  severity: string;
  state: "active" | "acknowledged" | "resolved";
  triggeredAt: string;
}

/** Active alarms + acknowledge action (member+). */
export function AlarmList({ alarms }: { alarms: AlarmRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function ack(id: string) {
    setBusy(id);
    try {
      await api(`/alarms/${id}/ack`, { method: "POST" });
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  if (alarms.length === 0) {
    return <div className="muted">No active alarms. All quiet.</div>;
  }

  return (
    <div className="feed" style={{ maxHeight: 300 }}>
      {alarms.map((a) => (
        <div key={a.id} className="item row wrap spread">
          <div>
            <span className={`badge active`}>{a.severity}</span>{" "}
            <span className="mono">{a.deviceId.slice(0, 8)}…</span>{" "}
            — {a.message}
            <div className="muted">{new Date(a.triggeredAt).toLocaleString()}</div>
          </div>
          {a.state === "active" && (
            <button className="ghost" disabled={busy === a.id} onClick={() => void ack(a.id)}>
              {busy === a.id ? "…" : "Acknowledge"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
