import type { PrismaClient } from "@prisma/client";
// The generated client's `Prisma` namespace does NOT re-export these (Prisma 5.22):
// `InputJsonValue`/`JsonNull`/`PrismaClientKnownRequestError` live in the runtime
// library module. `InputJsonObject` (the runtime's JSON object input type) is what
// fits Prisma `Json` fields here — a plain `Record<string, unknown>` is not
// assignable to it, so these casts are type-only (runtime-identical).
import {
  InputJsonObject,
  objectEnumValues,
  PrismaClientKnownRequestError,
} from "@prisma/client/runtime/library";
import {
  Ack,
  StatusOrLwt,
  Telemetry,
  isLwt,
  parseTopic,
  type ParsedTopic,
} from "@iot/shared";
import type { Gateway } from "./gateway";

/**
 * Uplink processor (Spec §3). The consumer is the platform's backend principal:
 * it derives the tenant from the topic and writes on that tenant's behalf, so it
 * uses the RAW client (not the api's tenant-scoped proxy). Every uplink message
 * is validated by the shared zod schema, written idempotently, and fanned out to
 * the tenant's dashboard room. Failures go to the dead-letter table, never lost.
 */
export class Handler {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly gateway: Gateway,
  ) {}

  /** Entry point from the MQTT message callback. Never throws. */
  async onMessage(topic: string, raw: Buffer): Promise<void> {
    const parsed = parseTopic(topic);
    if (!parsed) {
      await this.deadLetter(topic, raw.toString(), "unparseable_topic");
      return;
    }
    const body = this.tryJson(raw);
    if (body === null) {
      await this.deadLetter(topic, raw.toString(), "not_json");
      return;
    }

    try {
      switch (parsed.kind) {
        case "telemetry":
          await this.telemetry(parsed, body);
          break;
        case "status":
          await this.status(parsed, body);
          break;
        case "ack":
          await this.ack(parsed, body);
          break;
        case "rpc/response":
          // Phase 1: log + fan out; RPC business logic is an extension point.
          this.gateway.emit(parsed.tenantId, "ack", {
            deviceId: parsed.deviceId,
            kind: "rpc/response",
            ...body,
          });
          break;
        default:
          // cmd is downlink — the consumer never receives it.
          break;
      }
    } catch (e) {
      // A message that fails AFTER a valid topic is a business/DB error -> DLQ.
      await this.deadLetter(
        topic,
        raw.toString(),
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  /**
   * Idempotent telemetry write. The unique (message_id, reported_at) constraint
   * makes QoS1 redelivery a no-op: a duplicate hits P2002 and is swallowed.
   */
  private async telemetry(parsed: ParsedTopic, body: unknown): Promise<void> {
    const msg = Telemetry.parse(body);
    const { tenantId, deviceId } = parsed;

    // Device must exist (registered via api). Unknown device -> DLQ, not insert.
    const dev = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, tenantId: true },
    });
    if (!dev || dev.tenantId !== tenantId) {
      await this.deadLetter(
        `tenants/${tenantId}/devices/${deviceId}/telemetry`,
        JSON.stringify(body),
        "unknown_device",
      );
      return;
    }

    // Heartbeat: any telemetry implies the device is up.
    await this.prisma.device.update({
      where: { id: deviceId },
      data: { status: "online", lastSeenAt: msg.ts },
    });

    // Idempotent insert; duplicate (redelivery) is a no-op.
    try {
      await this.prisma.telemetry.create({
        data: {
          messageId: msg.message_id,
          tenantId,
          deviceId,
          data: msg.metrics,
          reportedAt: msg.ts,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return; // redelivery — already stored
      throw e;
    }

    // Alarm rules evaluated on every telemetry (Spec: consumer owns rules).
    // Dedup: one ACTIVE alarm per (device, rule) — a device stuck over the
    // threshold does not create a row per telemetry. It re-arms only after
    // the alarm is acknowledged/resolved via the api.
   const alarms = await this.evaluateRules(tenantId, deviceId, msg.metrics);
    for (const alarm of alarms) {
      const active = await this.prisma.alarm.findFirst({
        where: {
          tenantId,
          deviceId,
          state: "active",
          // JSONB: match rule.id inside the stored rule object.
          rule: { path: ["id"], equals: String(alarm.rule.id) },
        },
        select: { id: true },
      });
      if (active) continue; // still active — no new row
      const row = await this.prisma.alarm.create({
        data: {
          tenantId,
          deviceId,
          rule: alarm.rule as unknown as InputJsonObject,
          message: alarm.message,
          severity: alarm.severity,
        },
      });
      this.gateway.emit(tenantId, "alarm", {
        id: row.id,
        deviceId,
        severity: alarm.severity,
        message: alarm.message,
        triggeredAt: row.triggeredAt,
      });
    }

    console.log("[telemetry] emitting realtime", {
      tenantId,
      deviceId,
      metrics: msg.metrics,
      ts: msg.ts.toISOString(),
    });

    this.gateway.emit(tenantId, "telemetry", {
      deviceId,
      metrics: msg.metrics,
      ts: msg.ts.toISOString(),
    });
  }

  private async status(parsed: ParsedTopic, body: unknown): Promise<void> {
    // Accepts both a full envelope message AND a bare EMQX Last-Will
    // (`{"state":"offline"}` — the LWT string is static, no message_id).
    const msg = StatusOrLwt.parse(body);
    const { tenantId, deviceId } = parsed;

    const dev = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, tenantId: true },
    });
    if (!dev || dev.tenantId !== tenantId) {
      // An LWT for an unknown device is a device that was never registered
      // (or already deleted) — dropping it is correct, not a fault.
      if (isLwt(msg)) return;
      await this.deadLetter(
        `tenants/${tenantId}/devices/${deviceId}/status`,
        JSON.stringify(body),
        "unknown_device",
      );
      return;
    }

    // Use `in` to discriminate: `isLwt`'s `p is StatusLwt` guard over-narrows
    // to `never` because the full Status envelope is a structural superset of
    // StatusLwt. `message_id` is present only on the enveloped form.
    const ts = "message_id" in msg ? msg.ts : new Date();
    await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        status: msg.state,
        ...(msg.state === "online" ? { lastSeenAt: ts } : {}),
      },
    });

    this.gateway.emit(tenantId, "status", {
      deviceId,
      state: msg.state,
      reason: msg.reason,
      ts: ts.toISOString(),
      lwt: isLwt(msg),
    });
  }

  /**
   * Command ack (device -> cloud). Maps the cmd state machine:
   * ok -> acked, failed -> failed. (pending -> expired is swept by the api.)
   */
  private async ack(parsed: ParsedTopic, body: unknown): Promise<void> {
    const msg = Ack.parse(body);
    const { tenantId } = parsed;

    const cmd = await this.prisma.command.findUnique({
      where: { id: msg.command_id },
      select: { id: true, tenantId: true, deviceId: true, state: true },
    });
    if (!cmd || cmd.tenantId !== tenantId) {
      await this.deadLetter(
        `tenants/${tenantId}/devices/${parsed.deviceId}/ack`,
        JSON.stringify(body),
        "unknown_command",
      );
      return;
    }
    // Terminal states are sticky — a late redelivered ack can't resurrect it.
    if (cmd.state === "acked" || cmd.state === "failed") return;

    const next = msg.state === "ok" ? "acked" : "failed";
    await this.prisma.command.update({
      where: { id: cmd.id },
      data: {
        state: next,
        // JSON `null` (not SQL NULL) — the canonical sentinel is the shared
       // JsonNull instance from the runtime library's objectEnumValues.
       ackPayload:
         (msg.result as unknown as InputJsonObject) ??
         objectEnumValues.instances.JsonNull,
        ackedAt: msg.ts,
      },
    });

    this.gateway.emit(tenantId, "ack", {
      commandId: cmd.id,
      deviceId: cmd.deviceId,
      state: next,
      result: msg.result,
      ts: msg.ts.toISOString(),
    });
  }

  /** Evaluate enabled device rules; return any newly-triggered alarms. */
  private async evaluateRules(
    tenantId: string,
    deviceId: string,
    metrics: Record<string, number>,
  ) {
    const rules = await this.prisma.deviceRule.findMany({
      where: { tenantId, deviceId, enabled: true },
    });
    // Keep the concrete rule shape so the active-alarm dedup can read `rule.id`
    // (a bare InputJsonValue would erase the property).
    type FiringRule = { id: string; metric: string; op: string; threshold: number };
    const fired: { rule: FiringRule; message: string; severity: string }[] = [];
    for (const rule of rules) {
      const v = metrics[rule.metric];
      if (v === undefined) continue;
      if (this.compare(v, rule.op, rule.threshold)) {
        fired.push({
          // rule.id is stored so the active-alarm dedup can match it (JSONB path).
          rule: {
            id: rule.id,
            metric: rule.metric,
            op: rule.op,
            threshold: rule.threshold,
          },
          message: `${rule.name}: ${rule.metric} ${rule.op} ${rule.threshold} (value ${v})`,
          severity: rule.severity,
        });
      }
    }
    return fired;
  }

  private compare(v: number, op: string, t: number): boolean {
    switch (op) {
      case "gt": return v > t;
      case "lt": return v < t;
      case "gte": return v >= t;
      case "lte": return v <= t;
      default: return false;
    }
  }

  /** Last-resort sink. A DLQ write failure is logged, not swallowed. */
  private async deadLetter(topic: string, payload: string, reason: string) {
    try {
      // The payload column is Json; a plain string is a valid JSON value, so
      // the raw text is stored as-is (no parse — payloads may not be JSON).
      await this.prisma.deadLetter.create({
        data: { topic, payload, reason },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[DLQ] failed to record: ${topic} :: ${e}`);
    }
  }

  private tryJson(raw: Buffer): unknown | null {
    try {
      return JSON.parse(raw.toString());
    } catch {
      return null;
    }
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof PrismaClientKnownRequestError && e.code === "P2002";
}
