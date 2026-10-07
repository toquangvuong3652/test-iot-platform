# PROTOCOL.md — MQTT contract (Base v1)

> **Viết TRƯỚC khi code firmware/backend.** Firmware và backend cùng pin vào
> file này. Mọi payload up/down phải pass JSON Schema / zod ở `packages/shared/src/schemas/`.
> Nguồn thật: `packages/shared` (topics + zod). File này là bản người-đọc.

## 1. Kết nối

| Thuộc tính | Giá trị | Ghi chú |
|---|---|---|
| Transport | MQTT/WSS (WebSocket over TLS) | qua Cloudflare Tunnel, host `iot-mqtt.example.com:443` |
| keepalive | **30s** | phải < ~100s CF WebSocket idle timeout (`MQTT_KEEPALIVE_S`) |
| QoS | telemetry/status: 0 · cmd/ack: **1** | QoS1 có thể redelivery → idempotency bắt buộc |
| ClientId | `{tenant_id}:{device_id}` | EMQX extract tenant/device từ đây để auth + ACL |
| Auth | **token** (không mTLS — CF terminate TLS) | username=`{tenant_id}:{device_id}`, password=token; EMQX gọi `POST /mqtt/auth` (HTTP authn) → api so khớp `DeviceCredential` trong PostgreSQL. **Contract (EMQX 5.8.3): HTTP status = quyết định** — `200` = allow, non-2xx (`403`) = deny (body không được đọc) |
| LWT | topic `.../status`, payload `{"state":"offline"}` | EMQX publish khi device disconnect |

## 2. Topic

```
tenants/{tenant_id}/devices/{device_id}/telemetry      # up    device→cloud   QoS0
tenants/{tenant_id}/devices/{device_id}/status         # up    device→cloud   QoS0  (+ LWT)
tenants/{tenant_id}/devices/{device_id}/cmd            # down  cloud→device   QoS1
tenants/{tenant_id}/devices/{device_id}/ack            # up    device→cloud   QoS1
tenants/{tenant_id}/devices/{device_id}/rpc/request    # down  cloud→device
tenants/{tenant_id}/devices/{device_id}/rpc/response   # up    device→cloud
```

Helper chuẩn: `topic(tenantId, deviceId, kind)` trong `packages/shared`.

## 3. Envelope chung (mọi payload)

```json
{ "message_id": "uuid", "ts": "2026-09-23T10:00:00.000Z" }
```
- `message_id` = uuid, **idempotency key** (consumer dedupe; QoS1 redelivery).
- `ts` = ISO-8601.

## 4. Payload theo topic

### `telemetry` (up)
```json
{
  "message_id": "uuid",
  "ts": "2026-09-23T10:00:00.000Z",
  "metrics": { "temperature": 41.5, "pressure": 1.2, "current": 3.1 }
}
```
`metrics`: map `string -> number` (mở, để thêm loại máy mới không phá contract).

### `status` (up, gồm LWT)
```json
{ "message_id": "uuid", "ts": "...", "state": "online" }
```
`state`: `online | offline | error`. `reason` (optional) khi `error`.
LWT: EMQX publish `{"state":"offline"}` khi connection drop.

### `cmd` (down, QoS1) — do api publish
```json
{
  "command_id": "uuid",
  "type": "setpoint",
  "payload": { "target": 25 },
  "ts": "..."
}
```
`command_id` = id hàng `Command` trong PG (cũng là key tương quan ack).

### `ack` (up, QoS1)
```json
{ "command_id": "uuid", "state": "ok", "result": { "applied": true }, "ts": "..." }
```
`state`: `ok | failed`. Không ack trong `COMMAND_ACK_TIMEOUT_S` (15s) → api đánh dấu `expired`.

## 5. ACL (EMQX, per tenant/device)

Device chỉ được:
- **publish**: `tenants/{t}/devices/{d}/telemetry|status|ack|rpc/response` (chính device mình)
- **subscribe**: `tenants/{t}/devices/{d}/cmd|rpc/request` (chính device mình)

Không device nào thấy topic của tenant/device khác.

Thực thi: EMQX `authorization.sources = [http]` → api `POST /mqtt/acl`
(mỗi pub/sub), cùng contract status: **`200` = allow, `403` = deny**;
`no_match = deny` là fail-closed khi api không cho phép.

## 6. Downlink flow

```
Dashboard → POST /commands → api (RBAC) → INSERT Command(pending)
  → api publish .../cmd QoS1 → EMQX → Device
Device → publish .../ack {"command_id","state":"ok"}
  → consumer → UPDATE Command.state='acked' → socket.io emit command:state
  → Dashboard thấy 'acked'
(15s không ack → 'expired')
```

## 7. Contract test

`packages/shared/test/contract.test.ts` (Vitest) — chạy trong CI:
- topic build/parse đúng cho mọi kind,
- payload validate bằng zod,
- LWT payload đúng,
- keepalive = 30,
- JWT claims boundary `sub·tenant_id·roles`.

Firmware **cũng** phải chạy cùng bộ test này (port sang ngôn ngữ firmware).
