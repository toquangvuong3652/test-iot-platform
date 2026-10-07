// Smoke 1 — api auth + health + basic reads.
// Usage: node smoke/01_api.mjs   (stack must be up + seeded)
const API = "http://localhost:3000";

const out = {};
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

// health
let r = await fetch(`${API}/health`);
out.health = await j(r);

// login admin
r = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@acme.test", password: "***" }),
});
const login = await j(r);
out.login = login;
const token = login.body?.data?.access_token;
if (!token) { console.log(JSON.stringify(out, null, 2)); process.exit(1); }
const H = { authorization: `Bearer ${token}`, "content-type": "application/json" };

// auth/me
out.me = await j(await fetch(`${API}/auth/me`, { headers: H }));

// devices list (expect 2 seeded)
out.devices = await j(await fetch(`${API}/devices`, { headers: H }));

// machine types
out.machineTypes = await j(await fetch(`${API}/machine-types`, { headers: H }));

// rules list (expect the overheat rule)
out.rules = await j(await fetch(`${API}/alarms/rules`, { headers: H }));

// refresh
r = await fetch(`${API}/auth/refresh`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ refresh_token: login.body.data.refresh_token }),
});
out.refresh = { status: r.status, ok: (await r.json()).data?.access_token != null };

// negative: viewer cannot create rule (role gate) — login viewer first
r = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "viewer@acme.test", password: "***" }),
});
const vt = (await j(r)).body.data.access_token;
r = await fetch(`${API}/alarms/rules`, {
  method: "POST",
  headers: { authorization: `Bearer ${vt}`, "content-type": "application/json" },
  body: JSON.stringify({ deviceId: "00000000-0000-4000-8000-000000000031", name: "x", metric: "temperature", op: "gt", threshold: 1, severity: "critical" }),
});
out.viewerCreateRule = { status: r.status, expect: 403 };

// negative: bad login
r = await fetch(`${API}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@acme.test", password: "***" }),
});
out.badLogin = { status: r.status, expect: 401 };

console.log(JSON.stringify(out, null, 2));
// save the token for later steps
import("node:fs").then((fs) => fs.writeFileSync(new URL("./token.txt", import.meta.url), token));
