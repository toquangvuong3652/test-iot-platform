"use client";

export interface DeviceRow {
  id: string;
  name: string;
  status: "online" | "offline" | "error";
  lastSeenAt: string | null;
  _count?: { alarms: number; commands: number };
  machineType?: { id: string; name: string } | null;
}

export function DeviceList({
  devices,
  live,
  selected,
  onSelect,
}: {
  devices: DeviceRow[];
  live: Record<string, Record<string, number>>;
  selected: string | null;
  onSelect: (id: string, name: string) => void;
}) {
  if (devices.length === 0) {
    return <div className="muted">No devices yet.</div>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Device</th>
          <th>Status</th>
          <th>Live metrics</th>
          <th>Last seen</th>
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => (
          <tr
            key={d.id}
            className={selected === d.id ? "clickable selected" : "clickable"}
            onClick={() => onSelect(d.id, d.name)}
          >
            <td>
              <div>{d.name}</div>
              <div className="muted mono">{d.id.slice(0, 8)}…</div>
            </td>
            <td>
              <span className={`badge ${d.status}`}>{d.status}</span>
            </td>
            <td className="mono">
              {live[d.id]
                ? Object.entries(live[d.id])
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" · ")
                : "—"}
            </td>
            <td className="muted">
              {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleTimeString() : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
