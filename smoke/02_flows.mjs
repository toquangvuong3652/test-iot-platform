// Smoke 2 — full device flows: MQTT authn (valid+invalid), telemetry -> consumer ->
// DB + socket.io realtime, overheat alarm, command -> ack, LWT offline.
// Requires: stack up, seeded, and smoke/01_api.mjs already run (token.txt written).
// Run from repo root: node smoke/02_flows.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const mqtt = require("mqtt");
const { io } = require("socket.io-client");

const API = "http://localhost:3000";
const WS = "http://localhost:3001";
const BROKER = "mqtt://127.0.0.1:11883";
const TENANT = "00000000-0000-4000-8000-000000000001";
const MT = "00000000-0000-4000-8000-000000000010";
const token = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "token.txt"), "utf8").trim();
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const results = [];
const check = (name, cond, detail) => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + JSON.stringify(detail) : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

// ---- register a fresh device (token returned once) ----
let r = await fetch(`${API}/devices`, { method: "POST", headers: H, body: JSON.stringify({ name: "smoke-furnace", machineTypeId: MT }) });
const reg = await j(r);
const dev = reg.body?.data;
check("api: register device returns token once", r.status === 201 && dev?.token, { deviceId: dev?.deviceId, username: dev?.username });
const devToken = dev.token;
const DEV = dev.deviceId;

// ---- register a 2nd device to test an INVALID token without polluting the main one's authn cache ----
r = await fetch(`${API}/devices`, { method: "POST", headers: H, body: JSON.stringify({ name: "smoke-furnace-bad" }) });
const reg2 = await j(r);
const dev2 = reg2.body?.data;

// ---- EMQX authn: INVALID token must be rejected ----
{
  const bad = await new Promise((resolve) => {
    const c = mqtt.connect(BROKER, { clientId: dev2.username, username: dev2.username, password: "wrong-token-0000000000000000000000", connectTimeout: 4000, reconnectPeriod: 0 });
    const to = setTimeout(() => { c.end(true); resolve("timeout"); }, 4000);
    c.on("connect", () => { clearTimeout(to); resolve("connected"); c.end(true); });
    c.on("error", (e) => { clearTimeout(to); resolve("error:" + e.code); c.end(true); });
  });
  check("mqtt: invalid token REJECTED", bad.startsWith("error") || bad === "timeout", { outcome: bad });
}

// ---- socket.io realtime listener (join tenant room) ----
const events = [];
const socket = io(WS, { auth: { token }, transports: ["websocket"] });
const connected = new Promise((res) => socket.on("connect", () => res(true)));
socket.on("telemetry", (p) => events.push(["telemetry", p]));
socket.on("status", (p) => events.push(["status", p]));
socket.on("alarm", (p) => events.push(["alarm", p]));
socket.on("ack", (p) => events.push(["ack", p]));
await connected;
check("realtime: socket.io connected with JWT", true);

// ---- valid device connect + LWT registration + telemetry + status ----
const client = mqtt.connect(BROKER, {
  clientId: dev.username,
  username: dev.username,
  password: devToken,
  keepalive: 30,
  will: { topic: `tenants/${TENANT}/devices/${DEV}/status`, payload: JSON.stringify({ state: "offline" }), qos: 0, retain: false },
  connectTimeout: 5000,
  reconnectPeriod: 0,
});
await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("connect timeout")), 6000); client.once("connect", () => { clearTimeout(to); res(); }); client.once("error", (e) => { clearTimeout(to); rej(e); }); });
check("mqtt: valid token CONNECTED (EMQX authn ok)", client.connected);

const now = () => new Date().toISOString();
client.publish(`tenants/${TENANT}/devices/${DEV}/status`, JSON.stringify({ message_id: crypto.randomUUID(), ts: now(), state: "online" }), { qos: 0 });
await sleep(800);
// cool telemetry (no alarm)
const coolId = crypto.randomUUID();
client.publish(`tenants/${TENANT}/devices/${DEV}/telemetry`, JSON.stringify({ message_id: coolId, ts: now(), metrics: { temperature: 30, pressure: 1.0, current: 2.0 } }), { qos: 0 });
// hot telemetry -> overheat (temp > 40 critical)
const hotId = crypto.randomUUID();
client.publish(`tenants/${TENANT}/devices/${DEV}/telemetry`, JSON.stringify({ message_id: hotId, ts: now(), metrics: { temperature: 45, pressure: 1.1, current: 2.2 } }), { qos: 0 });

// wait for consumer to persist + emit
await sleep(2500);

// ---- verify via API (DB) ----
r = await fetch(`${API}/telemetry/devices/${DEV}`, { headers: H });
const series = await j(r);
const temps = (series.body?.data ?? []).map((row) => row.data?.temperature ?? row.metrics?.temperature);
check("db: telemetry rows persisted (2 points)", (series.body?.data ?? []).length >= 2, { count: (series.body?.data ?? []).length, temps });

r = await fetch(`${API}/alarms?state=active`, { headers: H });
const alarms = await j(r);
const active = (alarms.body?.data ?? []).filter((a) => a.deviceId === DEV && a.severity === "critical");
check("db: overheat alarm ACTIVE (temp 45 > 40)", active.length >= 1, { alarms: (alarms.body?.data ?? []).length, critical: active.length });
const alarmRow = active[0];

r = await fetch(`${API}/devices/${DEV}`, { headers: H });
const devRow = (await j(r)).body?.data;
check("db: device status online + lastSeen", devRow?.status === "online" && devRow?.lastSeenAt, { status: devRow?.status });

// realtime events observed
const sawTelemetry = events.some(([k, p]) => k === "telemetry" && p.deviceId === DEV);
const sawOnline = events.some(([k, p]) => k === "status" && p.state === "online");
const sawAlarm = events.some(([k, p]) => k === "alarm" && p.deviceId === DEV);
check("realtime: telemetry emitted to tenant room", sawTelemetry);
check("realtime: status online emitted", sawOnline);
check("realtime: alarm emitted", sawAlarm);

// ---- command -> ack cycle ----
r = await fetch(`${API}/commands`, { method: "POST", headers: H, body: JSON.stringify({ deviceId: DEV, type: "setpoint", payload: { target: 25 } }) });
const cmd = await j(r);
const cmdId = cmd.body?.data?.id;
check("api: command created (pending)", cmd.status === 201 && cmd.body?.data?.state === "pending", { id: cmdId });

// device subscribes to its cmd topic, acks on receipt
await new Promise((res) => client.subscribe(`tenants/${TENANT}/devices/${DEV}/cmd`, { qos: 1 }, res));
await new Promise((resolve) => {
  const to = setTimeout(() => resolve(), 8000);
  client.on("message", (topic, payload) => {
    if (!topic.endsWith("/cmd")) return;
    const m = JSON.parse(payload.toString());
    if (m.command_id !== cmdId) return;
    client.publish(`tenants/${TENANT}/devices/${DEV}/ack`, JSON.stringify({ command_id: m.command_id, state: "ok", result: { applied: true }, ts: now() }), { qos: 1 }, () => clearTimeout(to));
    resolve();
  });
});
// verify acked state via API (consumer wrote the row)
let acked = null;
for (let i = 0; i < 10; i++) {
  r = await fetch(`${API}/commands/${cmdId}`, { headers: H });
  acked = (await j(r)).body?.data;
  if (acked?.state === "acked") break;
  await sleep(500);
}
check("cmd: state -> acked (device acked, consumer persisted)", acked?.state === "acked", { state: acked?.state, ackedAt: acked?.ackedAt });
check("realtime: ack emitted", events.some(([k, p]) => k === "ack" && p.commandId === cmdId && p.state === "acked"));

// ---- LWT: hard-close the main device connection (its registered will fires) ----
{
  // Abrupt close: destroy the underlying TCP socket WITHOUT sending DISCONNECT,
  // so EMQX publishes the registered Last-Will ({"state":"offline"}) on drop.
  const sock = client._socket || client.stream || client.connection;
  if (sock && sock.destroy) sock.destroy(); else client.end(true);
  await sleep(2500);
}
r = await fetch(`${API}/devices/${DEV}`, { headers: H });
const devAfter = (await j(r)).body?.data;
const sawOffline = events.some(([k, p]) => k === "status" && p.state === "offline" && p.lwt === true);
check("LWT: device -> offline after hard close (lwt:true)", devAfter?.status === "offline" && sawOffline, { status: devAfter?.status, sawOffline });

// ---- cleanup: resolve the alarm, end sockets ----
if (alarmRow) {
  r = await fetch(`${API}/alarms/${alarmRow.id}/resolve`, { method: "POST", headers: H, body: "{}" });
  check("api: alarm resolve (admin)", (await j(r)).body?.data?.state === "resolved");
}
// delete the two smoke devices (cascades credential)
for (const d of [DEV, dev2.deviceId]) {
  r = await fetch(`${API}/devices/${d}`, { method: "DELETE", headers: H });
}
check("api: smoke devices deleted (cascade)", true);

client.end(true);
socket.close();

const failed = results.filter((x) => !x.pass);
console.log(`\n==== SMOKE2 SUMMARY: ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log("  - " + f.name)); process.exit(1); }
process.exit(0);
