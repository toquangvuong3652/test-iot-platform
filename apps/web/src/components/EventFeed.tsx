export interface FeedItem {
  ts: string;
  kind: "telemetry" | "status" | "alarm" | "ack";
  text: string;
}

/** Rolling, newest-first feed of everything the socket pushed this session. */
export function EventFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <div className="muted">Waiting for live events…</div>;
  }
  const color = (k: FeedItem["kind"]) =>
    k === "alarm" ? "var(--warn)" : k === "ack" ? "var(--accent)" : k === "status" ? "var(--ok)" : "var(--muted)";
  return (
    <div className="feed mono">
      {items.map((it, i) => (
        <div key={`${it.ts}-${i}`} className="item row spread">
          <span style={{ color: color(it.kind) }}>
            [{new Date(it.ts).toLocaleTimeString()}] {it.text}
          </span>
        </div>
      ))}
    </div>
  );
}
