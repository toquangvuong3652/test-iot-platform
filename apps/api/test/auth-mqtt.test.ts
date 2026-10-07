import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import { AuthService } from "../src/auth/auth.service";
import { MqttAclService } from "../src/auth/mqtt-acl.service";

const SECRET = "unit-test-internal-secret-123";
const PLATFORM_TOKEN = "unit-test-platform-token-123";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function fakeConfig() {
  const map: Record<string, string> = {
    JWT_SECRET: "unit-test-jwt-secret-12345",
    MQTT_AUTH_INTERNAL_SECRET: SECRET,
    PLATFORM_MQTT_TOKEN: PLATFORM_TOKEN,
    JWT_EXPIRES_IN: "15m",
  };
  return {
    get: (k: string) => map[k],
    getOrThrow: (k: string) => {
      if (!(k in map)) throw new Error(`missing ${k}`);
      return map[k];
    },
  } as any;
}

const T = "tenant-A";
const DEV = "device-1";
const USERNAME = `${T}:${DEV}`;

function fakePrisma(cred: any = {
  id: "c1",
  username: USERNAME,
  tenantId: T,
  tokenHash: sha("dev-secret-token"),
}) {
  return {
    deviceCredential: {
      findUnique: async (args: any) =>
        args.where.username === USERNAME ? cred : null,
    },
  } as any;
}

describe("AuthService.mqttAuth (EMQX HTTP-authn)", () => {
  const svc = () => new AuthService(fakePrisma() as any, fakeConfig());

  it("allows a device with a valid token", async () => {
    const r = await svc().mqttAuth({
      username: USERNAME,
      password: "dev-secret-token",
      internalSecret: SECRET,
    });
    expect(r).toEqual({ allowed: true });
  });

  it("denies a device with a wrong token", async () => {
    const r = await svc().mqttAuth({
      username: USERNAME,
      password: "nope",
      internalSecret: SECRET,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("bad_token");
  });

  it("denies an unknown username", async () => {
    const r = await svc().mqttAuth({
      username: "tenant-A:ghost",
      password: "x",
      internalSecret: SECRET,
    });
    expect(r.reason).toBe("unknown_device");
  });

  it("denies a username that claims the wrong tenant", async () => {
    const r = await svc().mqttAuth({
      // username says tenant-B but the credential row belongs to tenant-A
      username: "tenant-B:device-1".replace("tenant-B", "tenant-B"),
      password: "dev-secret-token",
      internalSecret: SECRET,
    });
    // The lookup is by username, so tenant-B:device-1 has no credential row.
    expect(r.allowed).toBe(false);
  });

  it("allows the platform principal with the shared token", async () => {
    const r = await svc().mqttAuth({
      username: "platform:api",
      password: PLATFORM_TOKEN,
      internalSecret: SECRET,
    });
    expect(r).toEqual({ allowed: true });
    const r2 = await svc().mqttAuth({
      username: "platform:consumer",
      password: PLATFORM_TOKEN,
      internalSecret: SECRET,
    });
    expect(r2).toEqual({ allowed: true });
  });

  it("denies the platform principal with a wrong token", async () => {
    const r = await svc().mqttAuth({
      username: "platform:api",
      password: "wrong",
      internalSecret: SECRET,
    });
    expect(r.reason).toBe("bad_platform_token");
  });

  it("denies everything with a bad internal secret (forged EMQX call)", async () => {
    const r = await svc().mqttAuth({
      username: USERNAME,
      password: "dev-secret-token",
      internalSecret: "attacker",
    });
    expect(r).toEqual({ allowed: false, reason: "bad_internal_secret" });
  });

  it("denies a username without a tenant separator", async () => {
    const r = await svc().mqttAuth({
      username: "nocolon",
      password: "x",
      internalSecret: SECRET,
    });
    expect(r.reason).toBe("bad_username");
  });
});

describe("MqttAclService.decide (EMQX HTTP-ACL)", () => {
  const svc = () => new MqttAclService(fakePrisma() as any, fakeConfig());
  const ok = (t: string, a: string) =>
    svc().decide({ username: USERNAME, topic: t, action: a, internalSecret: SECRET });

  const base = `tenants/${T}/devices/${DEV}`;

  it("device can publish telemetry/status/ack/rpc/response on its OWN topic", async () => {
    for (const k of ["telemetry", "status", "ack", "rpc/response"]) {
      const r = await ok(`${base}/${k}`, "publish");
      expect(r.allow, k).toBe(true);
    }
  });

  it("device can subscribe cmd/rpc/request on its OWN topic", async () => {
    for (const k of ["cmd", "rpc/request"]) {
      const r = await ok(`${base}/${k}`, "subscribe");
      expect(r.allow, k).toBe(true);
    }
  });

  it("device CANNOT publish on a downlink topic", async () => {
    const r = await ok(`${base}/cmd`, "publish");
    expect(r.allow).toBe(false);
  });

  it("device CANNOT publish on ANOTHER device's topic (same tenant)", async () => {
    const r = await ok(`tenants/${T}/devices/device-2/telemetry`, "publish");
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("topic_mismatch");
  });

  it("device CANNOT subscribe ANOTHER tenant's downlink topic", async () => {
    const r = await ok(`tenants/tenant-B/devices/${DEV}/cmd`, "subscribe");
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("topic_mismatch");
  });

  it("unknown device is denied even on its own topic shape", async () => {
    const svc2 = () =>
      new MqttAclService(
        { deviceCredential: { findUnique: async () => null } } as any,
        fakeConfig(),
      );
    const r = await svc2().decide({
      username: `${T}:ghost`,
      topic: `tenants/${T}/devices/ghost/telemetry`,
      action: "pub",
      internalSecret: SECRET,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("unknown_device");
  });

  it("platform:api can only pub downlink topics", async () => {
    const api = (t: string, a: string) =>
      new MqttAclService(fakePrisma() as any, fakeConfig()).decide({
        username: "platform:api",
        topic: t,
        action: a,
        internalSecret: SECRET,
      });
    expect((await api(`${base}/cmd`, "pub")).allow).toBe(true);
    expect((await api(`${base}/telemetry`, "pub")).allow).toBe(false);
    expect((await api(`${base}/cmd`, "sub")).allow).toBe(false);
  });

  it("platform:consumer can only sub uplink topics", async () => {
    const cs = (t: string, a: string) =>
      new MqttAclService(fakePrisma() as any, fakeConfig()).decide({
        username: "platform:consumer",
        topic: t,
        action: a,
        internalSecret: SECRET,
      });
    expect((await cs(`tenants/+/devices/${DEV}/telemetry`, "sub")).allow).toBe(true);
    expect((await cs(`${base}/cmd`, "pub")).allow).toBe(false);
  });

  it("bad internal secret -> deny everything (fail closed)", async () => {
    const r = await svc().decide({
      username: USERNAME,
      topic: `${base}/telemetry`,
      action: "pub",
      internalSecret: "attacker",
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toBe("bad_internal_secret");
  });

  it("credential cache: second decision does not re-query", async () => {
    let queries = 0;
    const svc3 = new MqttAclService(
      {
        deviceCredential: {
          findUnique: async () => {
            queries++;
            return { id: "c1" };
          },
        },
      } as any,
      fakeConfig(),
    );
    await svc3.decide({ username: USERNAME, topic: `${base}/telemetry`, action: "pub", internalSecret: SECRET });
    await svc3.decide({ username: USERNAME, topic: `${base}/status`, action: "pub", internalSecret: SECRET });
    expect(queries).toBe(1);
  });
});
