import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { Handler } from "../src/handler";

/**
 * Handler unit tests with a fake PrismaClient + fake Gateway — no DB, no
 * broker. Covers: idempotent telemetry (P2002 swallowed), unknown device ->
 * DLQ, LWT vs full-envelope status, ack state machine stickiness.
 */

const T = "tenant-A";
const D = "device-1";
const UUID = "11111111-1111-4111-8111-111111111111";

function makePrisma(opts: {
  deviceTenant?: string | null; // null = device row missing
  duplicateTelemetry?: boolean;
  commandTenant?: string | null; // null = command row missing
  activeAlarm?: boolean; // an active alarm already exists for the rule
  rule?: {
    id: string;
    name: string;
    metric: string;
    op: string;
    threshold: number;
    severity: string;
  } | null;
} = {}) {
  const calls: { op: string; args: any }[] = [];
  const rec = (op: string, args: any) => calls.push({ op, args });

  const prisma: any = {
    device: {
      findUnique: async (a: any) => {
        rec("device.findUnique", a);
        if (opts.deviceTenant === null) return null;
        return { id: a.where.id, tenantId: opts.deviceTenant ?? T };
      },
      update: async (a: any) => {
        rec("device.update", a);
        return { ok: true };
      },
    },
    telemetry: {
      create: async (a: any) => {
        rec("telemetry.create", a);
        if (opts.duplicateTelemetry) {
          throw new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: "5.22.0",
            meta: {},
          });
        }
        return { id: "row1", ...a.data };
      },
    },
    alarm: {
      create: async (a: any) => {
        rec("alarm.create", a);
        return { id: "al1", ...a.data, triggeredAt: new Date() };
      },
      findFirst: async (a: any) => {
        rec("alarm.findFirst", a);
        return opts.activeAlarm ? { id: "al-active" } : null;
      },
    },
    command: {
      findUnique: async (a: any) => {
        rec("command.findUnique", a);
        if (opts.commandTenant === null) return null;
        return statefulCommand(a.where.id, opts.commandTenant ?? T);
      },
      update: async (a: any) => {
        rec("command.update", a);
        return { ok: true };
      },
    },
    deviceRule: { findMany: async () => (opts.rule ? [opts.rule] : []) },
    deadLetter: {
      create: async (a: any) => {
        rec("deadLetter.create", a);
        return { id: "dl1", ...a.data };
      },
    },
  };
  return { prisma, calls };
}

// Mutable command row so we can assert terminal-state stickiness.
const commandState: Record<string, any> = {};
function statefulCommand(id: string, tenantId: string): any {
  if (!commandState[id]) {
    commandState[id] = { id, tenantId, deviceId: D, state: "pending" };
  }
  return commandState[id];
}

function makeGateway() {
  return {
    emit: vi.fn(),
  } as any;
}

const buf = (obj: unknown) => Buffer.from(JSON.stringify(obj));
const ts = "2026-09-24T10:00:00.000Z";

describe("Handler — telemetry", () => {
  it("valid telemetry: device->online, idempotent row, gateway emit", async () => {
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: UUID, ts, metrics: { temperature: 41.5 },
    }));
    const ops = calls.map((c) => c.op);
    expect(ops).toContain("device.findUnique");
    expect(ops).toContain("telemetry.create");
    const upd = calls.find((c) => c.op === "device.update")!;
    expect(upd.args.data).toEqual({ status: "online", lastSeenAt: new Date(ts) });
    expect(gw.emit).toHaveBeenCalledWith(T, "telemetry", expect.objectContaining({
      deviceId: D, metrics: { temperature: 41.5 },
    }));
  });

  it("QoS1 redelivery (same message_id) is a no-op, no DLQ, no duplicate emit", async () => {
    const { prisma, calls } = makePrisma({ duplicateTelemetry: true });
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: UUID, ts, metrics: { temperature: 41.5 },
    }));
    expect(calls.find((c) => c.op === "deadLetter.create")).toBeUndefined();
    expect(gw.emit).not.toHaveBeenCalledWith(T, "telemetry", expect.anything());
  });

  it("unknown device -> DLQ with unknown_device, no telemetry row", async () => {
    const { prisma, calls } = makePrisma({ deviceTenant: null });
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: UUID, ts, metrics: { temperature: 1 },
    }));
    const dlq = calls.find((c) => c.op === "deadLetter.create")!;
    expect(dlq.args.data.reason).toBe("unknown_device");
    expect(calls.find((c) => c.op === "telemetry.create")).toBeUndefined();
  });

  it("topic that claims another tenant for the device -> DLQ (tenant mismatch)", async () => {
    const { prisma, calls } = makePrisma({ deviceTenant: "tenant-B" });
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: UUID, ts, metrics: { temperature: 1 },
    }));
    expect(calls.find((c) => c.op === "deadLetter.create")!.args.data.reason).toBe("unknown_device");
  });

  const RULE = {
      id: "rule-1",
      name: "overheat",
      metric: "temperature",
      op: "gt",
      threshold: 40,
      severity: "critical",
    };

  it("rule breach creates an active alarm + gateway emit", async () => {
    const { prisma, calls } = makePrisma({ rule: RULE });
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: UUID, ts, metrics: { temperature: 41.5 },
    }));
    const created = calls.find((c) => c.op === "alarm.create")!;
    expect(created.args.data.severity).toBe("critical");
    expect(created.args.data.rule.id).toBe("rule-1");
    expect(gw.emit).toHaveBeenCalledWith(T, "alarm", expect.objectContaining({
      deviceId: D, severity: "critical",
    }));
  });

  it("rule below threshold: no alarm", async () => {
    const { prisma, calls } = makePrisma({ rule: RULE });
    const h = new Handler(prisma, makeGateway());
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: UUID, ts, metrics: { temperature: 39 },
    }));
    expect(calls.find((c) => c.op === "alarm.create")).toBeUndefined();
  });

  it("alarm dedup: an ACTIVE alarm for the same rule prevents a new row", async () => {
    const { prisma, calls } = makePrisma({ rule: RULE, activeAlarm: true });
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: UUID, ts, metrics: { temperature: 99 },
    }));
    expect(calls.find((c) => c.op === "alarm.findFirst")).toBeDefined();
    expect(calls.find((c) => c.op === "alarm.create")).toBeUndefined();
    expect(gw.emit).not.toHaveBeenCalledWith(T, "alarm", expect.anything());
  });

  it("schema-invalid payload -> DLQ invalid_schema (not a crash)", async () => {
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, buf({
      message_id: "not-a-uuid", ts, metrics: {},
    }));
    const dlq = calls.find((c) => c.op === "deadLetter.create")!;
    expect(dlq.args.data.reason.length).toBeGreaterThan(0);
    expect(calls.find((c) => c.op === "telemetry.create")).toBeUndefined();
  });
});

describe("Handler — status (LWT + envelope)", () => {
  beforeEach(() => {
    delete commandState[UUID];
  });

  it("bare LWT {state:offline} flips the device offline, no DLQ", async () => {
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/status`, buf({ state: "offline" }));
    expect(calls.find((c) => c.op === "deadLetter.create")).toBeUndefined();
    const upd = calls.find((c) => c.op === "device.update")!;
    expect(upd.args.data).toEqual({ status: "offline" });
    expect(gw.emit).toHaveBeenCalledWith(T, "status", expect.objectContaining({
      state: "offline", lwt: true,
    }));
  });

  it("LWT for an unknown device is dropped silently (no DLQ noise)", async () => {
    const { prisma, calls } = makePrisma({ deviceTenant: null });
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/status`, buf({ state: "offline" }));
    expect(calls.find((c) => c.op === "deadLetter.create")).toBeUndefined();
  });

  it("full-envelope online status updates lastSeenAt", async () => {
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/status`, buf({
      message_id: UUID, ts, state: "online",
    }));
    const upd = calls.find((c) => c.op === "device.update")!;
    expect(upd.args.data).toEqual({ status: "online", lastSeenAt: new Date(ts) });
  });

  it("bad state -> DLQ", async () => {
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/status`, buf({
      message_id: UUID, ts, state: "sleeping",
    }));
    expect(calls.find((c) => c.op === "deadLetter.create")).toBeDefined();
  });
});

describe("Handler — ack state machine", () => {
  beforeEach(() => {
    delete commandState[UUID];
  });

  it("ok ack: pending -> acked, gateway emit, ackedAt set", async () => {
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/ack`, buf({
      command_id: UUID, state: "ok", result: { applied: true }, ts,
    }));
    const upd = calls.find((c) => c.op === "command.update")!;
    expect(upd.args.data.state).toBe("acked");
    expect(upd.args.data.ackedAt).toEqual(new Date(ts));
    expect(gw.emit).toHaveBeenCalledWith(T, "ack", expect.objectContaining({
      commandId: UUID, state: "acked",
    }));
  });

  it("failed ack: pending -> failed", async () => {
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/ack`, buf({
      command_id: UUID, state: "failed", ts,
    }));
    expect(calls.find((c) => c.op === "command.update")!.args.data.state).toBe("failed");
  });

  it("terminal state is sticky: a redelivered ack after 'acked' is ignored", async () => {
    commandState[UUID] = { id: UUID, tenantId: T, deviceId: D, state: "acked" };
    const { prisma, calls } = makePrisma();
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/ack`, buf({
      command_id: UUID, state: "failed", ts,
    }));
    expect(calls.find((c) => c.op === "command.update")).toBeUndefined();
    expect(gw.emit).not.toHaveBeenCalled();
  });

  it("ack for unknown command -> DLQ unknown_command", async () => {
    const { prisma, calls } = makePrisma({ commandTenant: null });
    const gw = makeGateway();
    const h = new Handler(prisma, gw);
    await h.onMessage(`tenants/${T}/devices/${D}/ack`, buf({
      command_id: UUID, state: "ok", ts,
    }));
    expect(calls.find((c) => c.op === "deadLetter.create")!.args.data.reason).toBe("unknown_command");
  });
});

describe("Handler — plumbing", () => {
  it("unparseable topic -> DLQ unparseable_topic", async () => {
    const { prisma, calls } = makePrisma();
    const h = new Handler(prisma, makeGateway());
    await h.onMessage("bogus/topic", buf({ a: 1 }));
    expect(calls.find((c) => c.op === "deadLetter.create")!.args.data.reason).toBe("unparseable_topic");
  });

  it("non-JSON payload -> DLQ not_json", async () => {
    const { prisma, calls } = makePrisma();
    const h = new Handler(prisma, makeGateway());
    await h.onMessage(`tenants/${T}/devices/${D}/telemetry`, Buffer.from("not json"));
    expect(calls.find((c) => c.op === "deadLetter.create")!.args.data.reason).toBe("not_json");
  });
});
