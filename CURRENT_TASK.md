# CURRENT_TASK.md — IoT Platform Base v1 (monorepo)

_Last updated: 2026-10-01, **ALL EMQX CONFIG FIXES APPLIED + VERIFIED GREEN (probe11)** — the final `emqx.conf` (flat authn + 4 listener tombstones + body-based comments + `mqtt.max_mqueue_len`) boots with **zero schema warnings** and `emqx ctl status` → `5.8.3 is started`; only our 2 listeners start (`tcp:internal :1883`, `ws.cf :8084`). The Docker daemon (down mid-session) recovered and the final combined re-verify passed. **NEXT: `docker compose up -d emqx` + smoke tests (user go-ahead).**_

## ✅ Checkpoint — authentication.1 fixed (schema errors gone); `tcp:default` root cause pinned (2026-10-01)

### DONE — the authn fix (applied, on disk, verified in `emqx.conf` lines 66–83)
1. **5.8.3 `authn:http_post` schema finding** (authoritative — in-image `emqx_conf_schema` dump, 2026-09-30, `C:\Users\AD\AppData\Local\hermes\cache\scratch\emqx_probe_v5.txt`, `PROBE_OK`, 727KB): the `authentication` array is a union discriminated by the **TOP-LEVEL `method`** field (singleton `post` for `authn:http_post`). All call fields are **top-level**: `method`, **`url`** (there is NO `path` field), `headers` (map), **`body` (a `map()`, not a string)**, `enable`, `connect_timeout`, `request_timeout`, `ssl`, `pool_size`, … `request` is a SEPARATE optional struct (`connector_http:request`) — it is NOT the container for the HTTP call; nesting `method`/`path`/`body` inside `request{}` leaves top-level `method` undefined → the old `unknown_http_method` error.
2. **Exact change to `infra/emqx/emqx.conf`** (ONLY file changed; `authorization` block byte-identical; no api/compose change; no commit/push):
   ```hocon
   authentication = [
     {
       mechanism = password_based
       backend   = http
       method    = post
       enable    = true
       url       = "http://api:3000/mqtt/auth"
       headers {
         x-internal-secret = "${MQTT_AUTH_INTERNAL_SECRET}"
       }
       body {
         clientid = "${clientid}"
         username = "${username}"
         password = "${password}"
       }
       connect_timeout = "30s"
     }
   ]
   ```
   (was: `request { method, path, headers, body = """…string…""" }`). Wire JSON unchanged — same `clientid`/`username`/`password` fields the api's `MqttAuthDto` expects; body-based `{result: allow|deny|ignore}` contract untouched.

### VERIFIED (real log output, throwaway `emqx/emqx:5.8.3` containers `emqx-conf-probe6`/`7` with current conf mounted)
- Command: `docker run -d --name <probe> -e EMQX_NODE_NAME=<probe>@127.0.0.1 -e MQTT_AUTH_INTERNAL_SECRET=*** -v C:/Users/AD/iot-platform/infra/emqx/emqx.conf:/opt/emqx/etc/emqx.conf emqx/emqx:5.8.3`
- ✅ **no `failed_to_check_schema`**
- ✅ **no `unknown_http_method`** (`grep -E "failed_to_check_schema|unknown_http_method|call_hocon_failed|unknown_fields|unmatched"` → no matches)
- ❌ **node did NOT reach `started`** — log: `Listener tcp:default on 0.0.0.0:1883 started.` then `tcp:internal failed to listen on 1883 - eaddrinuse` → exit(1). **Unrelated to authentication.1** (a built-in-listener collision — see below). Not the host-mosquitto issue (probe7 ran on an isolated docker network and hit the same clash).
- `emqx_ctl status` could NOT be captured: the Docker daemon died mid-run.

### INVESTIGATION — `tcp:default`: how it's enabled, how to disable it (COMPLETE)
- **Image = stock EMQX 5.8 tarball.** `emqx/emqx-docker` 5.8 Dockerfile (commit `69e9c22` and `main/5.8`): `curl emqx-5.8.x-debian12-amd64.tar.gz` → `tar -C /opt/emqx`. Entrypoint `docker-entrypoint.sh` only sets node name + `EMQX_RPC__PORT_DISCOVERY=manual` then `exec` — **it never generates or merges config**.
- **Stock `etc/emqx.conf` (1783 B) has NO listeners section** (extracted the real 5.8.3 tarball: `C:\Users\AD\AppData\Local\Temp\emqx583\etc\emqx.conf` — only node/cluster/log/dashboard). ⇒ the 4 default listeners are injected by **EMQX's own schema code**: `apps/emqx/src/emqx_schema.erl` @5.8.3 (saved at `C:\Users\AD\AppData\Local\hermes\cache\scratch\emqx_schema_core.erl`), converter `ensure_default_listener/2` on `listeners.tcp|ssl|ws|wss`:
  - no `listeners.<type>` in conf → injects `<type>:default` (`#{<<"default">> => default_listener(Type)}`);
  - `listeners.<type>` present **without** a `default` key → **still adds** `<type>:default` (this is our case: we define `tcp.internal`/`ws.cf` only);
  - `default` key present in user map → kept as-is, incl. a tombstone (`keep_default_tombstone/2`).
  - Injected binds: `tcp:default` **0.0.0.0:1883**, `ws:default` **8083**, `ssl:default` **8883** (needs certs — tarball ships demo certs), `wss:default` **8084**.
- **Disable mechanism = tombstone (same `emqx_schema.erl`)**: each listeners map value is `hoconsc:union([<listener struct>, marked_for_deletion])` via `tombstone_map/2`; the union matcher routes **map values → struct, non-map (bare) values → tombstone**. Exact HOCON syntax:
  ```hocon
  listeners.tcp.default = marked_for_deletion
  ```
  **bare value — NOT a `{…}` block** (a block would match the listener struct, not the tombstone). The `default` tombstone survives config merge and the listener supervisor simply doesn't start that listener (this is the same mechanism dashboard "delete listener" / `emqx_ctl listener delete` writes).
- **Collision table (our conf vs injected defaults):** `tcp:default` 1883 ↔ `tcp.internal` 1883 → **collides (observed eaddrinuse)**; `wss:default` 8084 ↔ `ws.cf` 8084 → **collides (latent)**; `ws:default` 8083, `ssl:default` 8883 → no collision (tombstone anyway for a clean broker).
- **Prior-probe bug (probe8):** env vars used `EMQX__LISTENERS__…` (TWO underscores after `EMQX`) → silently ignored; correct convention is `EMQX_` + `__`-separated path, e.g. `EMQX_LISTENERS__TCP__DEFAULT__BIND`. With tombstones in the conf, **no env vars are needed at all**.
- Sources on disk: `emqx_schema_core.erl` (5.8.3 `emqx_schema.erl`), `emqx_listeners.erl`, `emqx_probe_v5.txt` (schema dump) in `C:\Users\AD\AppData\Local\hermes\cache\scratch\`; stock tree `C:\Users\AD\AppData\Local\Temp\emqx583\` (+ `emqx-583.tar.gz`).

### ✅ COMPLETED THIS SESSION (2026-10-01) — the NEXT ACTION above was executed
1. **4 listener tombstones** added after `listeners.ws.cf` (bare value, not a block): `listeners.{tcp,ws,ssl,wss}.default = marked_for_deletion` — suppresses the schema-injected `*:default` listeners (kills the `tcp:default`↔`tcp.internal` 1883 and `wss:default`↔`ws.cf` 8084 collisions).
2. **Stale comments fixed** in `emqx.conf`: `request {}` → flat top-level `method`/`url`/`headers`/`body`; status-only contract → **body-based** `{"result":allow|deny|ignore}` on HTTP 200 (204=allow; any other status = ignore this source, not deny).
3. **NEW fix found during verify:** the top-level `session {}` block is **not in the 5.8.3 schema** → logged `config_key_not_recognized, unknown_config_keys: session` and applied NOTHING. Verified each key against the image build's `apps/emqx/src/emqx_schema.erl` @5.8.3 (on disk `scratch/emqx_schema_core.erl`):
   - `max_mqueue_len` → **valid at `mqtt.max_mqueue_len`** (union non_neg_int|infinity, default 1000), `emqx_schema.erl:3821`;
   - `max_mailbox_size` → **NOT a session key** in 5.8.3 (only `force_shutdown.max_mailbox_size`, a different OOM concept), `:433`;
   - `mqueue_low_limit_ratio` / `mqueue_high_limit_ratio` → **NOT in the 5.8.3 schema at all** (0 matches).
   Fix applied: `session { … }` → `mqtt { max_mqueue_len = 1000 }` (kept the 1000 cap; dropped the 3 keys with no 5.8.3 session equivalent; documented in-file). `mqtt` root = `mqtt_general() ++ mqtt_session()` (`:381`).

### VERIFIED GREEN (probe11 — FINAL config, all fixes together, real log)
The Docker daemon recovered mid-session; re-ran the combined verify on the FINAL `emqx.conf`:
```
docker run -d --name emqx-conf-probe11 -e EMQX_NODE_NAME=probe11@127.0.0.1 -e MQTT_AUTH_INTERNAL_SECRET=probe_secret -v C:/Users/AD/iot-platform/infra/emqx/emqx.conf:/opt/emqx/etc/emqx.conf emqx/emqx:5.8.3
```
- ✅ **no** `failed_to_check_schema` / `unknown_http_method` / `call_hocon_failed` / `unknown_fields` / `unmatched` / `eaddrinuse`
- ✅ **no** `config_key_not_recognized` (the `session{}`→`mqtt{}` fix removed the last warning)
- ✅ listeners started = **only** `tcp:internal :1883` + `ws.cf :8084` (the 4 default listeners suppressed → tombstones work)
- ✅ `emqx ctl status` → **`Node 'probe11@127.0.0.1' 5.8.3 is started`**
- `probe11` removed; `docker ps -a` clean (no leftover probe containers).

### CURRENT STATE
- `infra/emqx/emqx.conf` — **complete & schema-clean**: flat authn (verified), authz (verified, byte-identical), 4 tombstones (verified), body-based comments (fixed), `mqtt { max_mqueue_len = 1000 }` (verified). This is the ONLY repo file changed. No api code, no compose change, no commit/push, no `docker compose up`.
- Docker daemon: **up** (recovered; `probe11` ran to completion). If it drops again, restart Docker Desktop.

### NEXT ACTION (ONE)
**`docker compose up -d emqx`** → wait until it's healthy (no restart loop) → `docker compose ps` + `docker compose logs --tail=100 emqx` → confirm the standalone-probe `nxdomain` warnings on `api:3000` are GONE (api is reachable on the compose network) → run the smoke tests (device CONNECT valid/invalid; publish/subscribe tenant pinning via `/mqtt/acl`) → update this file. **Do NOT commit/push** until the user says so. (Compose `EMQX_NODE_NAME=emqx@127.0.0.1` already matches the conf's `node.name`.)

## ✅ Checkpoint — NEXT ACTION #2: authz `body{}` map + test renames; container verify still fails on **authn** `method` (2026-09-29)

### EXACTLY WHAT WAS CHANGED (2 files, nothing else)
1. `infra/emqx/emqx.conf` — **only the EMQX authz `body`** (`authorization.sources[1]`): the JSON string
   `body = """ {"clientid":"${clientid}","username":"${username}","action":"${action}","topic":"${topic}"} """`
   was replaced with the HOCON map
   ```hocon
   body {
     clientid = "${clientid}"
     username = "${username}"
     action   = "${action}"
     topic    = "${topic}"
   }
   ```
   The authn `request.body` string was **NOT** changed (explicitly out of scope for this action).
2. `apps/api/test/auth-mqtt.test.ts` — the **6 residual `access:` keys** → `action:` (lines 176, 188, 201, 212, 232, 233) to match `MqttAclService.decide`'s real input field (`action`). No test logic, expectations, or values changed.

### VERIFIED (real tool output)
- **`npm test -w @iot/api` → 35/35 passed** (3 files: command 4, prisma-scope 13, **auth-mqtt 18**). No new failures.
- **Throwaway `emqx/emqx:5.8.3` container** with the current config mounted
  (`docker run -d --name emqx-conf-probe3 -e EMQX_NODE_NAME=probe3@127.0.0.1 -e MQTT_AUTH_INTERNAL_SECRET=probe_secret -v C:/Users/AD/iot-platform/infra/emqx/emqx.conf:/opt/emqx/etc/emqx.conf emqx/emqx:5.8.3`):
  - ❌ **`failed_to_check_schema` is STILL present** (one error, not zero) and the **EMQX node does NOT start** (`call_hocon_failed`).
  - **`authorization` no longer appears in the error** → the authz `body{}` map (and the surrounding `sources=[{type=http,…}]` rewrite from NEXT ACTION #1) is **schema-valid on 5.8.3**. The only remaining error is in **`authentication.1`**:
    ```
    [error] failed_to_check_schema: emqx_conf_schema
    [error] #{reason => "unknown_http_method", path => "authentication.1", kind => validation_error, got => undefined, expected => "get | post", field_name => method}
    ERROR: call_hocon_failed: … -s emqx_conf_schema …
    ```
  - Both throwaway containers **removed** (`emqx-conf-probe3`, `emqx-probe4` → exit 0).

### CONTRACT — EMQX 5.8.3 is BODY-BASED (corrects the previous status-only assumption)
The previous checkpoint recorded: *"5.8.3 http authz reads only the HTTP status (200=allow, non-2xx=deny); the body is not read."* **That is wrong** for 5.8.3. The authoritative contract (per the 5.8 docs and the api code that already implements it):
- **Result is in the JSON body** — `{"result": "allow" | "deny" | "ignore"}` — returned with **HTTP 200**.
- **Status 204 = allow.** Any other status (4xx/5xx) makes EMQX **IGNORE this source and move to the next** in the chain — it is **NOT "deny"** (that was the 4.x contract).
- The api therefore always answers **200** and decides in the body; `code`/`allow`/`message` are informational only (EMQX never reads them).
- **The api code already does this** (verified on disk, 2026-09-29):
  - `apps/api/src/auth/auth.controller.ts` (`POST /mqtt/auth`, `@HttpCode(200)`) → returns `{result, code, message}`.
  - `apps/api/src/auth/mqtt-acl.controller.ts` (`POST /mqtt/acl`, `@HttpCode(200)`) → returns `{result, code, message, allow}`.
  - `apps/api/src/auth/dto.ts` → `MqttAclDto.action: z.enum(["publish","subscribe","pub","sub"]).optional()` — matches the authz `body{}` map's `action` placeholder and normalizes 5.8 `publish`/`subscribe` ↔ 4.x `pub`/`sub`.
- ⇒ **No api change is needed for the contract.** The 403-on-deny idea from the previous NEXT ACTION #1a is **obsolete and must not be done** (403 = ignore, not deny).
- **Stale comment to fix** (in NEXT ACTION): `emqx.conf` lines ~18-19 still say *"the api answers by HTTP STATUS — 200 = allow, non-2xx (403) = deny. The body is not read."* — correct it to the body-based contract above.

### PREVIOUS STATUS-ONLY ASSUMPTION — CORRECTED (the central error)
- **Wrong (previous checkpoint):** "5.8.3 `authn:http_post` puts the HTTP call under a nested `request{}` (method, path, body, headers); the flat 5.6 `method`/`url`/`body`/`headers` do not map."
- **Evidence it's wrong:** after NEXT ACTION #1 rewrote `authentication.1` to the nested `request{}` shape, the container log's error **changed from** `unknown_fields`/`unmatched` (fields present but not allowed / required but missing) **to** `unknown_http_method … got => undefined, expected => "get | post", field_name => method`. If 5.8.3 wanted the nested `request{}` shape, a correct nested `request{}` would validate — it does not. The 5.8.3 `authn:http_post` schema evidently requires a **top-level `method`** (enum `get | post`); the nested `request{}` alone leaves top-level `method` = `undefined` → `unknown_http_method`.
- **Not yet 100% pinned** (must confirm with an authoritative schema dump, not by guessing): the exact full field list for `authn:http_post` in 5.8.3 — specifically whether it wants **flat** top-level `method`+`url`+`headers`+`body` (5.6-style) or top-level `method` **plus** a nested `request{}`, and whether `connect_timeout`/`enable` stay. The previous checkpoint's extracted field list (`enable, mechanism, backend, method, url, headers, body, request_timeout, connect_timeout, …, request, ssl`) may have conflated the two; the live validator is the authority.

### BLOCKER
- `infra/emqx/emqx.conf` `authentication.1` must be reshaped so its **`method` is where the 5.8.3 `authn:http_post` schema expects it** (almost certainly top-level). The `authorization` block is already correct and must be left alone. The authn `request.body` JSON string is the authn contract (clientid/username/password) and can stay a string; only the authz `body` needed to be a `body{}` map (done).
- Until the authn block is fixed, `docker compose up -d emqx` will loop on `failed_to_check_schema` — **do not run compose up yet** (per rule).

### CHANGED THIS CHECKPOINT
- `infra/emqx/emqx.conf` — authz `body` → HOCON `body{}` map (the ONLY conf change).
- `apps/api/test/auth-mqtt.test.ts` — 6× `access:` → `action:`.
- No api source changed. No compose change. No `docker compose up`. No commit/push.
- Throwaway containers `emqx-conf-probe3` + `emqx-probe4` **removed** (exit 0). (Pre-existing `emqx-schema-probe` from the 2026-09-28 image check remains, unrelated to this action.)

### NEXT ACTION (ONE)
**Pin the 5.8.3 `authn:http_post` shape authoritatively, then fix `authentication.1` and re-verify** — do it in this order, stop after the node starts:
1. **Read-only schema probe** (throwaway container, auto-removed, no repo change):
   `docker run --rm --entrypoint escript -v C:/Users/AD/AppData/Local/hermes/cache/scratch:/scratch emqx/emqx:5.8.3 /scratch/schema_probe2.escript`
   (the script adds `/opt/emqx/lib/*/ebin`, calls `emqx_conf_schema` → `hocon_schema_json:gen/1` → writes `/scratch/schema.json`). Then extract the `authn:http_post` entry: its full field list, whether `method` is **top-level** and whether `request{}` is valid at all, and the exact enum for `method`.
2. **Rewrite `authentication.1` in `infra/emqx/emqx.conf`** to match the dumped schema (expected: top-level `method = post` + `url` + `headers{}` + the existing `request.body` JSON string; keep `mechanism`/`backend`/`enable`/`connect_timeout`). **Do NOT touch the `authorization` block** (already valid) and **do NOT** convert the authn `body` to a map (it's a string there and the api parses JSON). Also **correct the stale status-only comment** (lines ~18-19) to the body-based contract recorded above.
3. **Re-verify** in a fresh throwaway `emqx/emqx:5.8.3` container with the config mounted: confirm **no `failed_to_check_schema`** AND **node started** (`emqx_ctl status` → `5.8.3 is started`) → `docker rm -f` the container.
4. **Then** (only when #3 is green): `docker compose up -d emqx` → `docker compose ps` + `docker compose logs --tail=100 emqx` → smoke tests → update this file. **Do NOT commit/push** until the user says so.

## ✅ Checkpoint — NEXT ACTION #1: exact 5.8.3 schema errors + offending fields (2026-09-29)

### DONE
- Fresh throwaway container of the **verified** image (`emqx/emqx:5.8.3`, image id `2bb94239a381`, byte-identical to the official Docker Hub `5.8.3` manifest — already proven in the 2026-09-28 checkpoint) with the **current, unmodified** `infra/emqx/emqx.conf` mounted over `/opt/emqx/etc/emqx.conf`:
  `docker run -d --name emqx-conf-probe2 -e EMQX_NODE_NAME=probe2@127.0.0.1 -e MQTT_AUTH_INTERNAL_SECRET=probe_secret -v C:/Users/AD/iot-platform/infra/emqx/emqx.conf:/opt/emqx/etc/emqx.conf emqx/emqx:5.8.3`
- Captured the exact boot errors (identical to the compose restart-loop logs). Both throwaway containers **removed** (`docker rm -f emqx-conf-probe2 emqx-conf-probe` → exit 0). Repo **unmodified** (no `emqx.conf`/compose edits, no `compose up`, no commit).
- Extracted the **authoritative 5.8.3 conf schema** directly from the image (in-image `hocon_schema_json:gen(emqx_conf_schema)` probes, read-only `docker run --rm`) and diffed the config keys against it. The `unknown`/`unmatched` field lists in the log are truncated with `...` by the logger *at construction time* (not just display), so the complete lists below were derived by diffing, not read from the log.

### EXACT EMQX 5.8.3 VALIDATION ERRORS (verbatim, from `docker logs emqx-conf-probe2`)
```
2026-09-29T03:07:50.509323+00:00 [error] failed_to_check_schema: emqx_conf_schema
2026-09-29T03:07:50.516410+00:00 [error] #{reason => unknown_fields,path => "authentication.1",unknown => "allow_anonymous,cache,...",kind => validation_error,unmatched => "connect_timeout,enable,...",matched_type => "authn:http_post"}
2026-09-29T03:07:50.516546+00:00 [error] #{reason => unknown_fields,path => "authorization",unknown => "deny_overwrite,rules,...",kind => validation_error,unmatched => "cache,deny_action,..."}
ERROR: call_hocon_failed: -v -t 2026.09.29.03.07.49 -s emqx_conf_schema -c /opt/emqx/data/configs/cluster.hocon -c /opt/emqx/etc/emqx.conf -d /opt/emqx/data/configs generate
```
- `unknown` = fields **in the config but not allowed** by the 5.8.3 schema (the fatal cause). `unmatched` = **required** fields present in the 5.8.3 schema but missing from the config. (Optional absent fields are omitted from the error.)

### OFFENDING CONFIG PATHS / FIELDS (complete, untruncated)
**`authentication.1`** → 5.8.3 matches it to struct **`authn:http_post`** (matched_type).
- ❌ **`allow_anonymous`** (line 69) — NOT a 5.8.3 authn field (does not exist in any 5.8.3 authn struct). 5.8.3 anonymous policy is determined by whether an auth source is configured, not by this key.
- ❌ **`responses`** (lines 70–72) — NOT a 5.8.3 field (does not exist anywhere in the 5.8.3 schema). 5.8.3 http authn decides by HTTP status: **2xx = allow, non-2xx = deny**.
- ❌ **`cache`** (lines 73–78) — NOT a 5.8.3 field at the authn level (the only 5.8.3 struct with a `cache` field is `emqx:authorization`).
- ⚠️ **missing required**: `enable`, `connect_timeout`, and **`request`** (the HTTP call is nested under `request{}` in 5.8.3 — the config's flat `method`/`url`/`body`/`headers` are the 5.6-style shape and do not map).

**`authorization`** → 5.8.3 struct **`emqx:authorization`**.
- ❌ **`deny_overwrite`** (line 85) — NOT a 5.8.3 field (removed in the 5.5.0+ authz redesign).
- ❌ **`source`** (line 86) — the 5.8.3 field is **`sources`** (plural, an **array** of typed objects), not a scalar `source`.
- ❌ **`rules`** (lines 87–112) — NOT an 5.8.3 `authorization` field. (Rules only live inside the `type=built_in_database` source's built-in DB, which the intended HTTP design doesn't use.)
- ⚠️ **missing required**: `deny_action`, `cache` (5.8.3 `emqx:authz_cache`).
- ✅ **`no_match = deny`** (line 84) — VALID; keep.

### EXPECTED 5.8.3 STRUCTURE (from the image's own `emqx_conf_schema`)
**`authentication` entry (http backend, `authn:http_post`) — valid field set:**
`enable, mechanism, backend, method, url, headers, body, request_timeout, connect_timeout, pool_size, max_retries, retry_interval, enable_pipelining, request, ssl`
- `request` is a nested struct **`connector_http:request`**: `method, path, body, headers, max_retries, request_timeout` (this is where the HTTP call lives in 5.8.3).
- Note: in 5.8.3 http authn the **allow/deny decision is the HTTP status** (2xx=allow, else deny) — there is **no `responses`/body-`code` mapping**.
- Minimal valid 5.8.3 entry:
```hocon
authentication = [
  {
    mechanism = password_based
    backend   = http
    enable    = true
    request {
      method  = post
      path    = "http://api:3000/mqtt/auth"
      headers { x-internal-secret = "${MQTT_AUTH_INTERNAL_SECRET}" }
      body    = "{\"clientid\":\"${clientid}\",\"username\":\"${username}\",\"password\":\"${password}\"}"
    }
    connect_timeout = "30s"
  }
]
```

**`authorization` (5.8.3 `emqx:authorization`) — valid field set:**
`no_match, deny_action, cache, sources`
- `no_match` = enum **`allow` | `deny`**
- `deny_action` = enum **`ignore` | `disconnect`**
- `cache` = **`emqx:authz_cache`**: `enable, max_size (1..1048576), ttl, excludes`
- `sources` = array of union, each object carries a **`type`** discriminator:
  `http` (authz:http_get/post), `built_in_database` (authz:builtin_db), `file`, `redis`, `mysql`, `postgresql`, `mongo`, `ldap`.
- **`authz:http_post` fields** (the intended authz→api backend): `type, method, url, headers, body, request, request_timeout, connect_timeout, pool_size, max_retries, retry_interval, enable_pipelining, enable, ssl` (same nested `request` shape as authn).
- **`authz:builtin_db`** fields are only `enable, max_rules, type` — i.e. it references the broker's built-in rules store; it does **not** take inline `rules`.
- Minimal valid 5.8.3 authorization (HTTP backend, per the PROTOCOL.md intent):
```hocon
authorization {
  no_match    = deny
  deny_action = ignore
  sources = [
    {
      type = http
      method = post
      url = "http://api:3000/mqtt/acl"
      headers { x-internal-secret = "${MQTT_AUTH_INTERNAL_SECRET}" }
      body = "{\"clientid\":\"${clientid}\",\"username\":\"${username}\",\"action\":\"${action}\",\"topic\":\"${topic}\"}"
      connect_timeout = "30s"
    }
  ]
}
```

### CURRENT BLOCKER
- The config is written for the **5.6-style** flat authn/authz shape; 5.8.3 requires the nested `request{}` + `sources=[{type=…}]` shape. **The fix is a rewrite of `infra/emqx/emqx.conf` (next action), not an image problem** (image already proven correct).
- **Semantic gotcha the rewrite must resolve:** the api's `/mqtt/auth` & `/mqtt/acl` return **HTTP 200 for both allow and deny**, decision in body `{code:0|1}`. 5.8.3 http authn/authz read only the **status code** (2xx=allow). So the deny decision must be conveyed by a **non-2xx status (e.g. 403)** — either the api endpoints change, or the conf cannot express the intended deny. **This needs a decision (NEXT ACTION #1a).**
- Also (noted, separate): compose `EMQX_NAME` → should be `EMQX_NODE_NAME: emqx@127.0.0.1`.

### CHANGED THIS CHECKPOINT
- Repo: **nothing** (`emqx.conf` unmodified, no compose edit, no `compose up`, no commit).
- Throwaway containers `emqx-conf-probe` (stale) + `emqx-conf-probe2` (this run): **both removed** (`docker rm -f` → exit 0).

### NEXT ACTION
> ⚠️ **SUPERSEDED (2026-09-29, NEXT ACTION #2 checkpoint above).** The plan below was executed at
> #2/#3 and its premise for `authentication.1` was **wrong**: 5.8.3 authn does NOT validate with a
> nested `request{}` (the live validator now rejects it with `unknown_http_method … field_name =>
> method`), and **1a is obsolete/wrong** — 5.8.3 authz is **body-based** (`{"result":"allow"|"deny"|"ignore"}`,
> HTTP 200); 403 means *ignore this source*, NOT deny. The api already implements the body contract.
> The current authoritative NEXT ACTION is in the #2 checkpoint. Kept here for history.

1. **Rewrite `infra/emqx/emqx.conf` to the 5.8.3 schema** (leave every other line untouched):
   (a) `authentication.1` — move the HTTP call into `request { method, path, headers, body }`; add `enable=true` + `connect_timeout`; **delete** `allow_anonymous`, `responses`, `cache` (top-level).
   (b) `authorization` — replace `source=built_in` + `rules=[…]` with `sources=[{ type=http, method=post, url="http://api:3000/mqtt/acl", headers{…}, body{…}, connect_timeout="30s" }]`; **delete** `deny_overwrite`; add `deny_action=ignore` (+ optional `cache{ enable=true, ttl="30s" }`); keep `no_match=deny`.
   (c) Compose: `EMQX_NAME` → `EMQX_NODE_NAME: emqx@127.0.0.1`.
   **Before editing, decide 1a:** to express deny under 5.8.3, change `auth.controller.ts`/`mqtt-acl.controller.ts` to return **403** on deny (instead of 200 + `{code:1}`) — the standard EMQX http-authz contract. (If the user prefers to keep 200+body, say so and we revisit; 5.8.3 cannot read the body `code`.)
   Then validate in a fresh throwaway container (same method as this checkpoint) → confirm **no** `failed_to_check_schema` + node `started` → remove container. **Do NOT commit.**
2. (was #1) ~~diagnose exact config error~~ ✅ DONE 2026-09-29 (this checkpoint).
3. `docker compose up -d emqx` → `docker compose ps` + `docker compose logs --tail=100 emqx` → only then smoke tests → update this file.

## 🚨 Checkpoint — EMQX restart loop (2026-09-28)

### DONE
- Read `infra/emqx/emqx.conf`, `docker-compose.yml`, API authn/acl contract (`/mqtt/auth` in `auth.controller.ts`, `/mqtt/acl` in `mqtt-acl.controller.ts`, `dto.ts`, `PROTOCOL.md` §1/§5), emqx runtime logs, image entrypoint + default conf.
- Reproduced the loop: `docker compose ps` → emqx `Restarting`; logs = repeated `failed_to_check_schema` on `authentication.1` + `authorization`.

### CHANGED
- Repo: **nothing**. `emqx.conf` **unmodified**, no `docker compose up`, no anonymous MQTT. (All work this checkpoint was image inspection only.)
- Scratch container `emqx-schema-test` **removed** (2026-09-28, `docker rm -f` → exit 0).
- Compose `emqx` container `a4d73342eea3` (the one stuck in the restart loop) **force-removed** as a prerequisite for `docker rmi` (rmi failed first: "container a4d73342eea3 is using its referenced image 2bb94239a381"). It will be recreated by `docker compose up -d emqx`.
- Image `emqx/emqx:5.8.3` **removed and re-pulled** (same digest, see below — and the image is correct, see VERIFIED).
- Temporary verification container `emqx-ver-test` (ran the official 5.8.3 image standalone to read the live version) **started, probed, removed** (`docker rm -f` → exit 0). The digest-pulled image was then untagged (`docker rmi emqx/emqx@sha256:2066337393…`) — it is the same bytes as the `5.8.3` tag, so only one image remains: `emqx/emqx:5.8.3` (2bb94239a381…).

### VERIFIED
- **`emqx/emqx:5.8.3` IS genuine EMQX 5.8.3** (decisive, 2026-09-28):
  - **Official Docker Hub manifest** for `emqx/emqx:5.8.3` (via `https://hub.docker.com/v2/repositories/emqx/emqx/tags/5.8.3`) has **top-level digest `sha256:2bb94239a3812cd3443695d29d196cff510660b3fbf1bc56bbd8747fa94c4bd8`** — **IDENTICAL to the local image's RepoDigest**. ⇒ NOT a mirror mislabel; the local image is byte-for-byte the official 5.8.3.
  - Per-arch digests from the same response: **amd64 `sha256:2066337393f31bea6b03fef8b1c31242ca1b6ad23ca6a566c6f509f921301f8c`**, arm64 `sha256:4622533b9544…`. Pulled the **exact amd64 digest** and verified.
  - **Live self-reported version (decisive):** started the official image standalone → `emqx_ctl status` → `Node 'vercheck@127.0.0.1' 5.8.3 is started`. The node reports **5.8.3**.
  - Release metadata all say 5.8.3: `/opt/emqx/releases/5.8.3/` (dir + `BUILD_INFO`), `RELEASES` → `[{release,"emqx","5.8.3","14.2.5.2",...}]`, `emqx.rel` → `{release,{"emqx","5.8.3"},{erts,"14.2.5.2"},...}`.
  - **⚠️ The `lib/emqx-5.4.3` directory is a RED HERRING.** In the 5.8.3 release the *release product* is 5.8.3, but the **`emqx` OTP *application's* internal VSN is `5.4.3`** (RELEASES line `{emqx,"5.4.3","./lib/emqx-5.4.3"}`). EMQX keeps the core OTP app at a lower/lagging version than the release it ships in — the `lib/emqx-<ver>` dir name is NOT the product version. Earlier checkpoints misread `ls -d /opt/emqx/lib/emqx-*` (→ `emqx-5.4.3`) as the product version; that was wrong. (Similarly `emqx_auth-0.4.3`, `emqx_utils-5.4.2`, etc. are per-app versions, not the release version.)
  - ⇒ **The restart loop is NOT caused by a wrong/downgraded image.** The image is correct 5.8.3. The `failed_to_check_schema` errors are a **config problem** (see FAILED/BLOCKED).
- The reported `line 20: illegal characters "("` does not reproduce in current logs (schema errors only); file is clean (no CRLF/hidden bytes; line 20 = `cookie = "..."`).
- API contract: both endpoints exist, `@Public()` + `x-internal-secret`, response is **HTTP 200 for allow AND deny** with the decision in body `{code:0|1}` — the 5.8.3 conf must map the body `code` (exact `authorization.http` fields to be verified against the real image, now that the correct image is confirmed present).
- `MqttAclService` pins per tenant/device (PROTOCOL.md §5); built-in `clientid="+:+"` rules cannot pin tenant → intended mechanism = **HTTP authz to `/mqtt/acl`**, not `source=built_in`.

### FAILED/BLOCKED
- ~~Registry/mirror serving a 5.4.3 image under the `5.8.3` tag.~~ **DISPROVEN 2026-09-28.** Official Hub digest == local digest (`2bb94239a381…`), and the live node self-reports **5.8.3**. No mirror problem, no wrong image, no need to pull by digest.
- **The real blocker is the `failed_to_check_schema` errors at boot — a CONFIG problem in `infra/emqx/emqx.conf`.** The image is correct, so the loop is purely config. The exact offending schema fields are not yet pinned down (see NEXT ACTION #1 — the 5.8.3 conf needs to be diffed against the image's own default/valid schema before editing).
  - Candidate suspects to check against the 5.8.3 schema (do NOT assume; verify each): the top-level `authentication` / `authorization` blocks and their sub-keys (`allow_anonymous`, `cache`, `deny_overwrite`, `rules`, `no_match`, `source`) — the 5.5.0+ authn/authz schema shape, field names, and the http authn/authz sub-fields (`method`, `url`, `body` mapping for `code`).
  - Also compose: `EMQX_NAME` → should be `EMQX_NODE_NAME: emqx@127.0.0.1` (node name currently resolves to `emqx@127.0.0.1@172.18.0.3`).

### CURRENT STATE
- compose: `db` healthy; `emqx` container **removed** (force-removed to free the image) — stack down; `api`/`consumer`/`web` not started (blocked on emqx healthy).
- Local image `emqx/emqx:5.8.3` = **correct, genuine 5.8.3** (digest `2bb94239a381…`, confirmed byte-identical to official Hub + live self-report). **No re-pull needed.**
- `emqx.conf` unmodified; still causes `failed_to_check_schema` → must be fixed (config, not image) before `compose up`.

### NEXT ACTION
1. **Diagnose the real config error before editing anything.** In a throwaway container of the CORRECT image (already present, `emqx/emqx:5.8.3`), start EMQX with the current `infra/emqx/emqx.conf` mounted and capture the EXACT `failed_to_check_schema` message + line/field names from the log: `docker run -d --name emqx-conf-probe -e EMQX_NODE_NAME=probe@127.0.0.1 -v C:/Users/AD/iot-platform/infra/emqx/emqx.conf:/opt/emqx/etc/emqx.conf emqx/emqx:5.8.3` then `docker logs --tail=200 emqx-conf-probe` (expect the schema errors) → `docker rm -f emqx-conf-probe`. Read the current `infra/emqx/emqx.conf` and the image's default conf (`docker run --rm emqx/emqx:5.8.3 cat /opt/emqx/etc/emqx.conf`) to diff the offending keys. Do NOT edit `emqx.conf` yet; record the exact offending fields + the correct 5.8.3 syntax here first.
2. ~~`docker rm -f emqx-schema-test`.~~ ✅ DONE 2026-09-28 (exit 0).
3. ~~`docker rmi emqx/emqx:5.8.3 && docker pull emqx/emqx:5.8.3`; verify lib dir.~~ ✅ DONE 2026-09-28 → **result: image is correct 5.8.3** (official digest `2bb94239a381…` == local; live node self-reports 5.8.3). The `lib/emqx-5.4.3` dir is a red herring (OTP app VSN, not release version).
4. ~~Get the real 5.8.3 digest and pull by digest.~~ ✅ RESOLVED — not needed: official `5.8.3` digest `2bb94239a381…` == local image; amd64 image digest `2066337393f3…` pulled & verified live = 5.8.3.
5. **Then** (after #1 pinpoints the fields): finalize `emqx.conf` for 5.8.3 — `authentication` = http → `api:3000/mqtt/auth` (allow_anonymous=false, cache on); `authorization { no_match=deny, deny_overwrite=true, source=http }` → `api:3000/mqtt/acl` with body `code:1`=deny mapping. Compose: `EMQX_NAME` → `EMQX_NODE_NAME: emqx@127.0.0.1`.
6. `docker compose up -d emqx` → verify `docker compose ps` + `docker compose logs --tail=100 emqx` → only then smoke tests → update this file.

## ⏳ IN PROGRESS — runtime verification (per user: no commit until smoke tests pass)
Docker IS installed now (Docker Desktop 4.92, compose v5.5.1). Fixes applied so far:
1. **api + consumer Dockerfiles: Prisma client was missing at runtime (FATAL).**
   The runtime stage ran a fresh `npm ci --omit=dev` (no generated client) and the
   schema was copied AFTER install. Fixed: copy `apps/api/prisma` before, then
   `RUN npx prisma generate --schema apps/api/prisma/schema.prisma` as root before
   the non-root switch (both Dockerfiles); consumer also copies the api prisma dir
   into its build stage. Verified: "✔ Generated Prisma Client (v5.22.0)" in build log.
2. **All 3 Dockerfiles: `useradd: not found` on node:22-alpine (FATAL).**
   `useradd` is in Alpine's `shadow` package. Fixed: `RUN apk add --no-cache shadow
   && useradd -u 10001 -r iot && chown -R iot:iot /repo` (api, consumer, web).
3. **emqx.conf: `listeners.wss.cf` → `listeners.ws.cf` (would crash broker/node).**
   CF terminates outer TLS and forwards plain WS to 8084; a wss listener demands TLS
   certs EMQX doesn't have.
4. **docker-compose: EMQX host ports 1883/8084 → 11883/18084.** Host-local
   `mosquitto.exe` (PID 7236, "Services" session) already occupies 127.0.0.1:1883.
   Intra-network `emqx:1883` unaffected. (Revert to 1883/8084 on hosts w/o a local broker.)
5. `.env` created from `.env.example` with generated local secrets (gitignored).

Next: `docker compose build` (3rd attempt, all fixes in) → `up` → seed → smoke tests
(login, device MQTT authn valid+invalid, telemetry→DB+realtime, overheat alarm,
command→ack, LWT). Then update this file; commit only after all green.

## What we are building
IoT platform "Base v1" per `C:\Users\AD\iot-platform-architecture.html` (Phase 1):
NestJS API + MQTT consumer (socket.io realtime gateway) + Next.js dashboard + shared zod
contract, EMQX 5 broker, PostgreSQL (Prisma, partitioned telemetry), Cloudflare Tunnel for devices.
Device MQTT contract: `PROTOCOL.md` (root).
Repo: `C:\Users\AD\iot-platform` — npm workspaces: `packages/shared`, `apps/api`, `apps/consumer`, `apps/web`.

## Git state (verified 2026-09-26)
- Git repo, branch `main`, in sync with `origin/main` (`github.com/toquangvuong3652/Backend-YEE`).
- `eaa4265` "first commit" — all source + shared dist + emqx.conf + lock.
- `ba0d6ef` "chore: ignore generated files" — new `.gitignore` + `git rm -r --cached node_modules`
  (local `node_modules/` kept; ~1,600 tracked files removed from index only).
- Working tree (NOT yet committed): 17 modified + 9 untracked paths — see "Ready to commit" below.

## Completed (verified on disk 2026-09-26)
- All app code: shared contract, api modules, consumer, web, `infra/emqx/emqx.conf`.
- EMQX-5 authn/acl `{code:0}`/`{code:1}` body fix (in `eaa4265`).
- Stray web files GONE (deleted before `eaa4265`): only `apps/web/next.config.mjs` remains.
- `npm install` (root, all workspaces) — completed exit 0.
- **Infra (all written, verified on disk):**
  - `apps/api/Dockerfile`, `apps/consumer/Dockerfile`, `apps/web/Dockerfile` (monorepo root context;
    shared built first; non-root user; api/consumer `node dist/main.js`; web `next build` + `next start -p 3002`).
  - `docker-compose.yml` — db (postgres:16, volume, healthcheck), emqx (emqx/emqx:5, `infra/emqx/emqx.conf`
    mount, `MQTT_AUTH_INTERNAL_SECRET` env for `${...}` substitution, 1883+8084), api (depends_on db
    healthy + emqx; `prisma migrate deploy` then start), consumer (same deps), web (3002).
  - `.env.example` — all vars (secrets, POSTGRES_*, DATABASE_URL, PORT, MQTT_BROKER, `CORS_ORIGIN`,
    `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL`).
  - `infra/cloudflare/config.yml` — 3 ingress routes (api :3000, iot-mqtt WSS :8084, realtime :3001) + 404.
  - `.github/workflows/ci.yml` — npm ci → build:shared → prisma:generate → typecheck → build → test.
  - `.dockerignore` — node_modules/dist/.next/.vite/.env (keeps `.env.example`).
- **Cross-origin web changes (5 code changes, all applied):**
  1. `apps/web/src/lib/api.ts` — `fetch(\`${NEXT_PUBLIC_API_URL}${path}\`)`.
  2. `apps/web/src/lib/auth.ts` — refresh fetch → `NEXT_PUBLIC_API_URL`.
  3. `apps/web/src/lib/realtime.ts` — `io(process.env.NEXT_PUBLIC_WS_URL, ...)`; new
     `apps/web/src/lib/env.ts` (typed NEXT_PUBLIC_ env access, client-safe).
  4. `apps/api/src/config/env.ts` — added `CORS_ORIGIN` (zod).
  5. `apps/api/src/main.ts` — `app.enableCors({ origin: CORS_ORIGIN.split(',') })` (api had NO CORS).
  - Consumer gateway already had `cors: { origin: true }` — no change.
- **First-ever full build + test (2026-09-26, ALL GREEN):**
  - `npm run build`: shared → api (nest build) → consumer (tsc) → web (next build, 4 routes, compiled) ✓
  - `npm test`: shared 14 ✓, api 35 ✓ (command 4, prisma-scope 13, auth-mqtt 18), consumer 18 ✓ — **67 total, 0 failures**.
  - Type fixes applied to make the build pass (none change runtime semantics):
    - `app.module.ts` — `APP_GUARD`/`APP_FILTER` import from `@nestjs/core` (NestJS 10.4.22 moved them out of common).
    - `auth.service.ts` — `jwt.verify` narrows to `string | JwtPayload` (explicit `JwtPayload` branch);
      `expiresIn` dynamic env string cast to `jwt.SignOptions["expiresIn"]` (jsonwebtoken types v9 branded `StringValue`).
    - `mqtt-acl.controller.ts` — constructor prop renamed `acl` → `aclService` (collided with `acl()` method).
    - `command.service.ts` / `machine-type.service.ts` — zod `Record<string, unknown>` cast to `Prisma.InputJsonValue`.
    - `consumer/handler.ts` — `fired[].rule` kept concrete shape (bare `InputJsonValue` erased `.id`);
      LWT discrimination switched from `isLwt(msg)` (over-narrowed to `never` — Status is a structural superset of
      StatusLwt) to `"message_id" in msg`; `ackPayload` cast to `Prisma.InputJsonValue`.
    - `consumer/mqtt.ts` — `client.subscribe(string[], { qos: 1 }, cb)` (mqtt.js v5 signature; was array of `{topic,qos}`).
    - `web/AlarmList.tsx` — `AlarmRow.rule` now optional (live realtime alarm emits carry no rule; DB rows do; UI unused).
    - `web/realtime.ts` — socket payload cast to `RealtimeEvent` (untyped socket payload → typed union).
  - Test fix (pre-existing, surfaced by first test run — NOT a regression): `apps/api/test/prisma-scope.test.ts`
    fake-model harness recorded the rest-args ARRAY instead of `args[0]`, and `findFirstOrThrow` never rejected;
    9/13 tests failed before the fix. Fixed: record `args[0]`; `findFirstOrThrow` rejects with real
    `Prisma.PrismaClientKnownRequestError` (code P2025) when row is null. 13/13 pass.

## Ready to commit (one commit, with user)
- New: `.env.example`, `.dockerignore`, `.github/workflows/ci.yml`, `apps/*/Dockerfile` (x3),
  `docker-compose.yml`, `infra/cloudflare/config.yml`, `apps/web/src/lib/env.ts`.
- Modified (this task): the 5 cross-origin files above + all type-fix files listed in Completed +
  `package-lock.json` (npm install).
- Modified (pre-existing, earlier in the same working session — verified consistent with build/tests):
  - `apps/api/prisma/schema.prisma` + `migrations/0001_init/migration.sql` — `DeviceCredential.deviceId`
    is now `@unique` with a 1:1 `device` relation (onDelete Cascade; no orphaned tokens).
  - `packages/shared/src/schemas/status.ts` (+ committed `dist/` rebuild) — new `StatusLwt` schema +
    `StatusOrLwt` union: LWT is a static broker payload (`{"state":"offline"}`, no envelope/message_id);
    consumer validates the status topic through `StatusOrLwt`.
- Suggested message: `feat: docker/compose infra, cross-origin web, first full build (all tests green)`
  — or split into 2 commits if preferred: (a) schema+contract (StatusLwt, 1:1 credential), (b) infra+type fixes.

## Remaining (in order)
1. **Commit** with the user (see "Ready to commit"). Optional split into 2 commits.
2. **Docker not installed on this host** — compose/Dockerfiles are authored but cannot be
   run/verified here. When Docker is available: `docker compose up --build`, then seed + smoke test.
3. Phase 1 runtime validation (needs the stack up): device connect via EMQX authn, telemetry → consumer →
   socket.io → dashboard, overheat alarm, command ack cycle, LWT offline.
4. Push to `origin/main` after the user confirms the commit.

## Exact next step to continue
Ask the user to confirm the commit (one commit vs. the 2-commit split above), then run `git add -A && git commit`.

## Decisions already made (do not relitigate)
- Phase 1 tenant isolation = **authentication** (EMQX HTTP-authn every CONNECT; token sha256 vs
  `device_credentials`), NOT per-device ACL pinning (Phase 2 extension point).
- **No message bus in Phase 1**: EMQX → consumer direct; regime = bounded broker queue +
  idempotent consumer (`message_id` dedupe) + DLQ.
- Telemetry `PARTITION BY RANGE (reported_at)` from day 1 → later mechanical TimescaleDB conversion.
- Consumer persists uplink + emits realtime **only**; business reads/writes stay in api;
  the two apps never import each other.
- **Cross-origin web**: browser talks to web for pages; api/consumer reached via `NEXT_PUBLIC_API_URL` /
  `NEXT_PUBLIC_WS_URL`; CORS on api (new) + consumer (already open); explicit socket URL (WS upgrades
  not proxied by Next).
- **DeviceCredential is 1:1 with Device** (deviceId unique, cascade delete) — decided in the working
  session alongside the StatusLwt contract change.
- **LWT = bare `{"state":"offline"}`** (broker-published static string, no envelope); consumer accepts
  both shapes via `StatusOrLwt`; LWT handling is idempotent (no message_id to dedupe).
- Prisma tenant filter is MANDATORY (Postgres RLS = Phase 2). `machineType` is global catalog.
- CF WebSocket idle ≈100 s → device MQTT keepalive 30 s (PROTOCOL.md §1).

## Seed / run facts (unchanged)
- Seed: tenant Acme + admin/member/viewer `@acme.test` (`password123`), machine type "Hearth Furnace",
  2 devices (tokens printed once), overheat rule `temperature > 40 critical`.
- Migrations: `0001_init` (partitioned telemetry, 2026-09 partition; now also the 1:1 device_credentials
  FK + unique index) + `0002_partitions_2026_q4` (2026-10..12; no DEFAULT partition).
  `prisma migrate deploy` runs at api boot in compose.
- Ports: api 3000, consumer 3001, web 3002, emqx 1883 (tcp) + 8084 (WSS), db 5432.
