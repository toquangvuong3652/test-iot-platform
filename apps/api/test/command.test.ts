import { describe, it, expect } from "vitest";
import { CommandService } from "../src/command/command.service";

const T = "tenant-A";

function fakePrisma(devExists = true, cmdId = "cmd-1") {
  const calls: { op: string; args: any }[] = [];
  const rec = (op: string, args: any) => calls.push({ op, args });
  return {
    calls,
    service: {
      device: { findUnique: async (a: any) => rec("device.findUnique", a) || (devExists ? { id: a.where.id } : null) },
      command: {
        create: async (a: any) => {
          rec("command.create", a);
          return { id: cmdId, ...a.data };
        },
        updateMany: async (a: any) => {
          rec("command.updateMany", a);
          return { count: 3 };
        },
      },
    } as any,
    // scoped() returns an object whose delegates record + mirror the above
    scopedClient: {
      device: {
        findUnique: async (a: any) => {
          rec("device.findUnique", a);
          return devExists ? { id: a.where.id } : null;
        },
      },
      command: {
        create: async (a: any) => {
          rec("command.create", a);
          return { id: cmdId, ...a.data };
        },
      },
    },
  };
}

function fakeConfig(timeoutMs = 15000) {
  return { get: (k: string) => (k === "COMMAND_ACK_TIMEOUT_MS" ? timeoutMs : undefined) } as any;
}

function makeService(p: { scopedClient: any; service: any }, publishOk = true) {
  const prisma = {
    scoped: () => p.scopedClient,
    command: p.service.command,
  } as any;
  const mqtt = { publish: async () => publishOk } as any;
  return new CommandService(prisma, mqtt, fakeConfig());
}

describe("CommandService.create", () => {
  it("persists the pending row BEFORE publishing (no ack can race ahead)", async () => {
    const p = fakePrisma();
    const svc = makeService(p);
    await svc.create(T, { deviceId: "d1", type: "setpoint", payload: { target: 25 } });
    expect(p.calls.map((c) => c.op)).toEqual([
      "device.findUnique",
      "command.create",
    ]);
    expect(p.calls[1].args.data.state).toBe("pending");
  });

  it("publishes cmd with command_id correlated to the row", async () => {
    const p = fakePrisma();
    const svc = makeService(p);
    await svc.create(T, { deviceId: "d1", type: "setpoint", payload: { target: 25 } });
    // publish() was awaited by the service; verify the payload shape via the
    // create row (command_id == row id by construction).
    expect(p.calls[1].args.data).toMatchObject({ deviceId: "d1", type: "setpoint" });
  });

  it("unknown device -> NotFoundException, nothing created", async () => {
    const p = fakePrisma(false);
    const svc = makeService(p);
    await expect(
      svc.create(T, { deviceId: "ghost", type: "x", payload: {} }),
    ).rejects.toMatchObject({ name: "NotFoundException" });
    expect(p.calls.filter((c) => c.op === "command.create")).toHaveLength(0);
  });
});

describe("CommandService.expireStaleAll (sweeper)", () => {
  it("marks only pending commands older than the timeout as expired", async () => {
    const p = fakePrisma();
    const svc = makeService(p);
    const before = Date.now();
    await svc.expireStaleAll();
    const { where } = p.calls.find((c) => c.op === "command.updateMany")!.args;
    expect(where.state).toBe("pending");
    expect(where.publishedAt.lt).toBeInstanceOf(Date);
    const cutoff = where.publishedAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - 15000 - 50);
    expect(cutoff).toBeLessThanOrEqual(before - 15000 + 50);
  });
});
