/**
 * MQTT topic contract — single source of truth (PROTOCOL.md §4).
 * Both api (downlink publish) and consumer (uplink subscribe) MUST build
 * topics through these helpers so firmware/backend can never drift.
 */

export type TopicKind =
  | "telemetry"
  | "status"
  | "cmd"
  | "ack"
  | "rpc/request"
  | "rpc/response";

/** Build a concrete topic for a (tenant, device, kind) triple. */
export const topic = (tenantId: string, deviceId: string, kind: TopicKind): string =>
  `tenants/${tenantId}/devices/${deviceId}/${kind}`;

/** Consumer subscriptions (wildcard tenant + device). */
export const SUB_ALL_TELEMETRY = "tenants/+/devices/+/telemetry";
export const SUB_ALL_STATUS = "tenants/+/devices/+/status";
export const SUB_ALL_ACK = "tenants/+/devices/+/ack";
export const SUB_ALL_RPC_RESPONSE = "tenants/+/devices/+/rpc/response";

/** Parse a concrete topic back into its parts. Returns null if it does not match. */
export interface ParsedTopic {
  tenantId: string;
  deviceId: string;
  kind: TopicKind;
}

const KINDS: TopicKind[] = ["telemetry", "status", "cmd", "ack", "rpc/request", "rpc/response"];

export function parseTopic(t: string): ParsedTopic | null {
  const m = t.match(/^tenants\/([^/]+)\/devices\/([^/]+)\/(telemetry|status|cmd|ack|rpc\/request|rpc\/response)$/);
  if (!m) return null;
  const kind = m[3] as TopicKind;
  if (!KINDS.includes(kind)) return null;
  return { tenantId: m[1], deviceId: m[2], kind };
}

/** MQTT keepalive (seconds). MUST stay well under Cloudflare's ~100s WS idle timeout. */
export const MQTT_KEEPALIVE_S = 30;

/** Command ack timeout (seconds) before a pending command is marked expired. */
export const COMMAND_ACK_TIMEOUT_S = 15;
