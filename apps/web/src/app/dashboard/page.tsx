"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useRealtime, type RealtimeEvent } from "@/lib/realtime";
import { logout } from "@/lib/auth";
import { DeviceList, type DeviceRow } from "@/components/DeviceList";
import { MetricChart } from "@/components/MetricChart";
import { CommandPanel } from "@/components/CommandPanel";
import { AlarmList, type AlarmRow } from "@/components/AlarmList";
import { EventFeed, type FeedItem } from "@/components/EventFeed";

interface Summary {
  online: number;
  offline: number;
  error: number;
  total: number;
  activeAlarms: number;
}

export default function DashboardPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [alarms, setAlarms] = useState<AlarmRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string>("");
  // live values per device: { deviceId: { metric: value } }
  const [live, setLive] = useState<Record<string, Record<string, number>>>({});
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [cmdNonce, setCmdNonce] = useState(0); // bump to refresh command list

  const load = useCallback(async () => {
    try {
      const [d, s, a] = await Promise.all([
        api<DeviceRow[]>("/devices"),
        api<Summary>("/dashboard/summary"),
        api<AlarmRow[]>("/alarms?state=active"),
      ]);
      setDevices(d);
      setSummary(s);
      setAlarms(a);
      // seed live values from the latest per device
      setLive((prev) => {
        const next = { ...prev };
        for (const row of d) next[row.id] = next[row.id] ?? {};
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000); // light refresh for status drift
    return () => clearInterval(t);
  }, [load]);

  const onEvent = useCallback((e: RealtimeEvent) => {
    if (e.type === "telemetry") {
      setLive((prev) => ({
        ...prev,
        [e.deviceId]: { ...(prev[e.deviceId] ?? {}), ...e.metrics },
      }));
      setFeed((f) =>
        [
          { ts: e.ts, kind: "telemetry" as const, text: `${e.deviceId} — ${Object.entries(e.metrics).map(([k, v]) => `${k}=${v}`).join(" ")}` },
          ...f,
        ].slice(0, 60),
      );
    } else if (e.type === "status") {
      setDevices((ds) =>
        ds.map((d) => (d.id === e.deviceId ? { ...d, status: e.state } : d)),
      );
      setFeed((f) =>
        [
          { ts: e.ts, kind: "status" as const, text: `${e.deviceId} → ${e.state}${e.reason ? ` (${e.reason})` : ""}` },
          ...f,
        ].slice(0, 60),
      );
    } else if (e.type === "alarm") {
      setAlarms((a) => [{ id: e.id, deviceId: e.deviceId, severity: e.severity, message: e.message, state: "active", triggeredAt: e.triggeredAt }, ...a]);
      setFeed((f) =>
        [{ ts: e.triggeredAt, kind: "alarm" as const, text: `${e.severity.toUpperCase()} ${e.deviceId} — ${e.message}` }, ...f].slice(0, 60),
      );
    } else if (e.type === "ack") {
      setCmdNonce((n) => n + 1);
      setFeed((f) =>
        [{ ts: e.ts, kind: "ack" as const, text: `command ${e.commandId.slice(0, 8)} → ${e.state}` }, ...f].slice(0, 60),
      );
    }
  }, []);

  useRealtime(onEvent);

  const liveForSelected = selected ? live[selected] : undefined;

  return (
    <>
      <div className="topbar">
        <div className="row">
          <strong>IoT Platform</strong>
          <span className="muted mono">{selectedName ? `· ${selectedName}` : ""}</span>
        </div>
        <button className="ghost" onClick={() => logout()}>
          Sign out
        </button>
      </div>
      <div className="main">
        {summary && (
          <div className="grid cols-3">
            <div className="card stat">
              <span className="num" style={{ color: "var(--ok)" }}>{summary.online}</span>
              <span className="lbl">Online</span>
            </div>
            <div className="card stat">
              <span className="num" style={{ color: "var(--muted)" }}>{summary.offline}</span>
              <span className="lbl">Offline</span>
            </div>
            <div className="card stat">
              <span className="num" style={{ color: summary.activeAlarms ? "var(--warn)" : "var(--muted)" }}>
                {summary.activeAlarms}
              </span>
              <span className="lbl">Active alarms</span>
            </div>
          </div>
        )}

        <div className="grid cols-2">
          <div className="card">
            <h2>Devices</h2>
            <DeviceList
              devices={devices}
              live={live}
              selected={selected}
              onSelect={(id, name) => {
                setSelected(id);
                setSelectedName(name);
              }}
            />
          </div>
          <div className="card">
            <h2>{selectedName ? `Telemetry — ${selectedName}` : "Telemetry"}</h2>
            <MetricChart deviceId={selected} live={liveForSelected} />
          </div>
        </div>

        <div className="grid cols-2">
          <div className="card">
            <h2>Commands</h2>
            <CommandPanel deviceId={selected} onFired={() => setCmdNonce((n) => n + 1)} refreshKey={cmdNonce} />
          </div>
          <div className="card">
            <h2>Active alarms</h2>
            <AlarmList alarms={alarms} />
          </div>
        </div>

        <div className="card">
          <h2>Live event feed</h2>
          <EventFeed items={feed} />
        </div>
      </div>
    </>
  );
}
