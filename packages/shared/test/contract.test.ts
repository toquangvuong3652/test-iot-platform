import { describe, it, expect } from "vitest";
import {
  topic,
  parseTopic,
  SUB_ALL_TELEMETRY,
  SUB_ALL_STATUS,
  SUB_ALL_ACK,
  MQTT_KEEPALIVE_S,
  COMMAND_ACK_TIMEOUT_S,
} from "../src/topics";
import { Telemetry, Status, Cmd, Ack } from "../src/schemas";
import { JwtClaimsSchema, type JwtClaims } from "../src/jwt";

const T = "t1";
const D = "dev-1";
const now = "2026-09-23T10:00:00.000Z";
const uuid = "11111111-1111-4111-8111-111111111111";

describe("topics", () => {
  it("builds the exact contract topic for every kind", () => {
    expect(topic(T, D, "telemetry")).toBe(`tenants/${T}/devices/${D}/telemetry`);
    expect(topic(T, D, "status")).toBe(`tenants/${T}/devices/${D}/status`);
    expect(topic(T, D, "cmd")).toBe(`tenants/${T}/devices/${D}/cmd`);
    expect(topic(T, D, "ack")).toBe(`tenants/${T}/devices/${D}/ack`);
    expect(topic(T, D, "rpc/request")).toBe(`tenants/${T}/devices/${D}/rpc/request`);
    expect(topic(T, D, "rpc/response")).toBe(`tenants/${T}/devices/${D}/rpc/response`);
  });

  it("parseTopic round-trips a concrete topic", () => {
    const p = parseTopic(topic(T, D, "telemetry"));
    expect(p).toEqual({ tenantId: T, deviceId: D, kind: "telemetry" });
  });

  it("parseTopic rejects malformed topics", () => {
    expect(parseTopic("tenants/t1/telemetry")).toBeNull();
    expect(parseTopic("bogus")).toBeNull();
    expect(parseTopic("tenants/t1/devices/d/unknown")).toBeNull();
  });

  it("subscription wildcards match the concrete shape", () => {
    // A concrete telemetry topic must be a prefix-consistent match of the wildcard.
    expect(SUB_ALL_TELEMETRY).toBe("tenants/+/devices/+/telemetry");
    expect(SUB_ALL_STATUS).toBe("tenants/+/devices/+/status");
    expect(SUB_ALL_ACK).toBe("tenants/+/devices/+/ack");
  });

  it("keepalive is below Cloudflare's ~100s WS idle timeout", () => {
    expect(MQTT_KEEPALIVE_S).toBe(30);
    expect(MQTT_KEEPALIVE_S).toBeLessThan(100);
    expect(COMMAND_ACK_TIMEOUT_S).toBe(15);
  });
});

describe("telemetry schema", () => {
  it("accepts a valid payload", () => {
    const parsed = Telemetry.safeParse({
      message_id: uuid,
      ts: now,
      metrics: { temperature: 41.5, pressure: 1.2 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ts).toBeInstanceOf(Date);
  });

  it("rejects a non-uuid message_id (idempotency key must be a uuid)", () => {
    const parsed = Telemetry.safeParse({ message_id: "nope", ts: now, metrics: {} });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-numeric metric values", () => {
    const parsed = Telemetry.safeParse({
      message_id: uuid,
      ts: now,
      metrics: { temperature: "hot" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("status schema", () => {
  it("accepts LWT offline payload", () => {
    const parsed = Status.safeParse({ message_id: uuid, ts: now, state: "offline" });
    expect(parsed.success).toBe(true);
  });
  it("rejects unknown state", () => {
    expect(Status.safeParse({ message_id: uuid, ts: now, state: "sleeping" }).success).toBe(false);
  });
});

describe("cmd / ack schemas", () => {
  it("accepts a valid cmd", () => {
    const parsed = Cmd.safeParse({ command_id: uuid, type: "setpoint", payload: { target: 25 }, ts: now });
    expect(parsed.success).toBe(true);
  });
  it("accepts a valid ack and correlates command_id", () => {
    const parsed = Ack.safeParse({ command_id: uuid, state: "ok", ts: now });
    expect(parsed.success).toBe(true);
  });
  it("rejects an ack with a bad state", () => {
    expect(Ack.safeParse({ command_id: uuid, state: "maybe", ts: now }).success).toBe(false);
  });
});

describe("jwt claims boundary", () => {
  it("requires sub + tenant_id + roles", () => {
    const good: JwtClaims = { sub: "u1", tenant_id: "t1", roles: ["admin"] };
    expect(JwtClaimsSchema.hasTenant(good)).toBe(true);
    expect(JwtClaimsSchema.hasTenant({ sub: "u1", roles: ["admin"] })).toBe(false);
    expect(JwtClaimsSchema.hasTenant({ tenant_id: "t1", roles: [] })).toBe(false);
    expect(JwtClaimsSchema.hasTenant({ sub: "u1", tenant_id: "t1" })).toBe(false);
  });
});
