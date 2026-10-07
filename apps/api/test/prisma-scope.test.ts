import { describe, it, expect } from "vitest";
import { scopedClient } from "../src/prisma/prisma.service";
import { Prisma } from "@prisma/client";

/**
 * Unit tests for the tenant-scoping proxy — NO database needed.
 * The fake client records every delegate call so we can assert exactly
 * which Prisma op runs and with which args.
 */

interface Call {
  model: string;
  op: string;
  args: any;
}

function fakeModel(model: string, store: Call[], row: any = { id: "row1" }) {
  return new Proxy(
    {},
    {
      get: (_t, opSym) => {
        const op = String(opSym);
        if (op === "then" || op.startsWith("Symbol.")) return undefined;
        return (...args: any[]) => {
          // Prisma ops take a single options object — record THAT (args[0]),
          // not the rest-args array, so callers can read `args.where` directly.
          store.push({ model, op, args: args[0] });
          if (op === "findFirst") return Promise.resolve(row);
          if (op === "findFirstOrThrow") {
            // Real Prisma rejects with P2025 when the row is missing.
            return row
              ? Promise.resolve(row)
              : Promise.reject(
                  new Prisma.PrismaClientKnownRequestError("Record to find not found.", {
                    code: "P2025",
                    clientVersion: "5.22.0",
                    meta: {},
                  }),
                );
          }
          if (op === "count") return Promise.resolve(1);
          if (op === "updateMany" || op === "deleteMany") return Promise.resolve({ count: 1 });
          if (op === "create" || op === "createMany")
            return Promise.resolve({ data: args[0]?.data ?? null });
          return Promise.resolve({ ok: true, model, op });
        };
      },
    },
  );
}

function fakeClient(row: any = { id: "row1" }) {
  const store: Call[] = [];
  const models = [
    "user",
    "device",
    "telemetry",
    "alarm",
    "command",
    "deviceRule",
    // non-tenant models (must pass through untouched):
    "machineType",
    "tenant",
    "deviceCredential",
    "deadLetter",
  ];
  const client: any = {};
  for (const m of models) client[m] = fakeModel(m, store, row);
  return { client, store };
}

const T = "tenant-A";

describe("scoped() — tenant model delegates", () => {
  it("findUnique runs as findFirst with tenantId merged into where (no P2025 crash)", async () => {
    const { client, store } = fakeClient();
    const scoped = scopedClient(client as any, T);
    await (scoped.device as any).findUnique({ where: { id: "d1" } });
    expect(store).toHaveLength(1);
    expect(store[0].op).toBe("findFirst");
    expect(store[0].args.where).toEqual({ tenantId: T, id: "d1" });
  });

  it("findUniqueOrThrow keeps throw semantics but gains tenant scope", async () => {
    const { client, store } = fakeClient(null);
    const scoped = scopedClient(client as any, T);
    await expect(
      (scoped.alarm as any).findUniqueOrThrow({ where: { id: "a1" } }),
    ).rejects.toBeDefined();
    expect(store[0].op).toBe("findFirstOrThrow");
    expect(store[0].args.where).toEqual({ tenantId: T, id: "a1" });
  });

  it("update: tenant check first, then runs with ORIGINAL args (where stays unique)", async () => {
    const { client, store } = fakeClient();
    const scoped = scopedClient(client as any, T);
    await (scoped.user as any).update({ where: { id: "u1" }, data: { role: "admin" } });
    expect(store.map((c) => c.op)).toEqual(["findFirst", "update"]);
    expect(store[0].args.where).toEqual({ tenantId: T, id: "u1" });
    // The real update must NOT have tenantId injected into a unique where:
    expect(store[1].args.where).toEqual({ id: "u1" });
    expect(store[1].args.data).toEqual({ role: "admin" });
  });

  it("update: row outside the tenant -> P2025, update never runs", async () => {
    const { client, store } = fakeClient(null);
    const scoped = scopedClient(client as any, T);
    await expect(
      (scoped.user as any).update({ where: { id: "u1" }, data: {} }),
    ).rejects.toMatchObject({ code: "P2025" });
    expect(store.map((c) => c.op)).toEqual(["findFirst"]);
  });

  it("delete: same tenant-check-then-delete pattern", async () => {
    const { client, store } = fakeClient();
    const scoped = scopedClient(client as any, T);
    await (scoped.device as any).delete({ where: { id: "d1" } });
    expect(store.map((c) => c.op)).toEqual(["findFirst", "delete"]);
    expect(store[0].args.where).toEqual({ tenantId: T, id: "d1" });
  });

  it("delete: not in tenant -> P2025, nothing deleted", async () => {
    const { client, store } = fakeClient(null);
    const scoped = scopedClient(client as any, T);
    await expect((scoped.device as any).delete({ where: { id: "d1" } })).rejects.toMatchObject({
      code: "P2025",
    });
    expect(store).toHaveLength(1);
    expect(store[0].op).toBe("findFirst");
  });

  it("upsert: row exists -> real update; row missing -> real create", async () => {
    const { client: c1, store: s1 } = fakeClient();
    const { client: c2, store: s2 } = fakeClient(null);
    const up = { where: { id: "x" }, create: { tenantId: T, id: "x" }, update: { n: 1 } };
    await (scopedClient(c1 as any, T).device as any).upsert(up);
    await (scopedClient(c2 as any, T).device as any).upsert(up);
    expect(s1.map((c) => c.op)).toEqual(["findFirst", "update"]);
    expect(s1[1].args.data).toEqual({ n: 1 });
    expect(s2.map((c) => c.op)).toEqual(["findFirst", "create"]);
    expect(s2[1].args.data).toEqual({ tenantId: T, id: "x" });
  });

  it("filter ops (findMany/count/updateMany) merge tenantId into where", async () => {
    const { client, store } = fakeClient();
    const scoped = scopedClient(client as any, T);
    await (scoped.telemetry as any).findMany({ where: { deviceId: "d1" }, take: 5 });
    await (scoped.device as any).count({ where: { status: "online" } });
    await (scoped.command as any).updateMany({ where: { state: "pending" }, data: { state: "expired" } });
    expect(store[0].args.where).toEqual({ tenantId: T, deviceId: "d1" });
    expect(store[0].args.take).toBe(5);
    expect(store[1].args.where).toEqual({ tenantId: T, status: "online" });
    expect(store[2].args.where).toEqual({ tenantId: T, state: "pending" });
  });

  it("create/createMany are untouched (tenantId must come from data)", async () => {
    const { client, store } = fakeClient();
    const scoped = scopedClient(client as any, T);
    const data = { tenantId: T, name: "dev" };
    await (scoped.device as any).create({ data });
    await (scoped.device as any).createMany({ data: [data] });
    expect(store[0].args).toEqual({ data });
    expect(store[1].args).toEqual({ data: [data] });
  });
});

describe("scoped() — non-tenant model delegates pass through", () => {
  it("tenant / deviceCredential / deadLetter keep their original op", async () => {
    const { client, store } = fakeClient();
    const scoped = scopedClient(client as any, T);
    await (scoped.tenant as any).findUnique({ where: { id: "t1" } });
    await (scoped.deviceCredential as any).findUnique({ where: { username: "t1:d1" } });
    await (scoped.deadLetter as any).create({ data: { topic: "x", payload: {}, reason: "r" } });
    expect(store.map((c) => c.op)).toEqual(["findUnique", "findUnique", "create"]);
    // No tenant injection on non-tenant models:
    expect(store[0].args.where).toEqual({ id: "t1" });
  });

  it("machineType is a GLOBAL catalog (no tenant_id) — must pass through", async () => {
    const { client, store } = fakeClient();
    const scoped = scopedClient(client as any, T);
    await (scoped.machineType as any).findUnique({ where: { id: "mt1" } });
    expect(store[0].op).toBe("findUnique");
    expect(store[0].args.where).toEqual({ id: "mt1" });
  });

  it("$queryRaw / $transaction pass through untouched", async () => {
    const calls: any[] = [];
    const client: any = {
      user: fakeModel("user", calls),
      $queryRaw: (...a: any[]) => {
        calls.push({ model: "$", op: "$queryRaw", args: a });
        return Promise.resolve([]);
      },
    };
    const scoped = scopedClient(client, T);
    await (scoped as any).$queryRaw`select 1`;
    expect(calls[calls.length - 1].op).toBe("$queryRaw");
  });
});

describe("scoped() — error shape", () => {
  it("throws a real PrismaClientKnownRequestError (code P2025) so services can catch it", async () => {
    const { client } = fakeClient(null);
    const scoped = scopedClient(client as any, T);
    try {
      await (scoped.device as any).delete({ where: { id: "d1" } });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(e.code).toBe("P2025");
    }
  });
});
