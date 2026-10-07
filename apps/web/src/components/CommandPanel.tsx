"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface CommandRow {
  id: string;
  type: string;
  state: "pending" | "acked" | "failed" | "expired";
  payload: Record<string, unknown>;
  ackPayload: Record<string, unknown> | null;
  publishedAt: string;
  ackedAt: string | null;
  device: { id: string; name: string };
}

/**
 * Command panel: fire a downlink `cmd` (member+admin) and watch it move
 * pending -> acked / failed / expired in realtime (the consumer emits `ack`).
 */
export function CommandPanel({
  deviceId,
  onFired,
  refreshKey,
}: {
  deviceId: string | null;
  onFired: () => void;
  refreshKey: number;
}) {
  const [type, setType] = useState("setpoint");
  const [payload, setPayload] = useState('{ "target": 25 }');
  const [rows, setRows] = useState<CommandRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await api<CommandRow[]>("/commands?take=30"));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function fire() {
    if (!deviceId) return;
    setErr(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
    } catch {
      setErr("Payload must be valid JSON object");
      return;
    }
    setBusy(true);
    try {
      await api("/commands", {
        method: "POST",
        body: JSON.stringify({ deviceId, type, payload: parsed }),
      });
      onFired();
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div className="row wrap" style={{ marginBottom: 8 }}>
          <select
            style={{ width: 160 }}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="setpoint">setpoint</option>
            <option value="restart">restart</option>
            <option value="calibrate">calibrate</option>
          </select>
          <textarea
            style={{ flex: 1, minHeight: 34 }}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            className="mono"
            spellCheck={false}
          />
          <button onClick={fire} disabled={!deviceId || busy}>
            {busy ? "…" : "Send"}
          </button>
        </div>
        {!deviceId && <div className="muted">Select a device first.</div>}
        {err && <div className="error">{err}</div>}
      </div>

      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Device</th>
            <th>State</th>
            <th>Sent</th>
            <th>Ack</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="muted" colSpan={5}>
                No commands yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.type}</td>
              <td className="mono">{r.device.name}</td>
              <td>
                <span className={`badge ${r.state}`}>{r.state}</span>
              </td>
              <td className="muted">{new Date(r.publishedAt).toLocaleTimeString()}</td>
              <td className="muted">
                {r.ackedAt ? new Date(r.ackedAt).toLocaleTimeString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
