import type { PrismaClient } from "@prisma/client";

interface Rule {
  id: string;
  metric: string;
  op: string;
  threshold: number;
  severity: string;
  name: string;
}

const OPS: Record<string, (v: number, t: number) => boolean> = {
  gt: (v, t) => v > t,
  gte: (v, t) => v >= t,
  lt: (v, t) => v < t,
  lte: (v, t) => v <= t,
};

/**
 * Threshold alarm engine (Phase 1): stateless per message.
 * Each telemetry is checked against the device's ENABLED rules; a breach
 * creates an `active` Alarm row.
 *
 * Cooldown: in-memory, per (device, rule) — an identical breach re-fires at
 * most once every COOLDOWN_MS, so a device stuck over the threshold at 10s
 * telemetry does not spam the alarms table. (Durable "active until
 * acknowledged" semantics + auto-resolve are a Phase 2 extension point.)
 */
const COOLDOWN_MS = 5 * 60_000;

export class AlarmEngine {
  private lastFired = new Map<string, number>();

  constructor(private readonly prisma: PrismaClient) {}

  /** Evaluate metrics against the device's rules. Returns newly created alarms. */
  async evaluate(
    tenantId: string,
    deviceId: string,
    metrics: Record<string, number>,
    reportedAt: Date,
  ): Promise<unknown[]> {
    let rules: Rule[];
    try {
      rules = await this.prisma.deviceRule.findMany({
        where: { tenantId, deviceId, enabled: true },
      });
    } catch {
      return []; // fail soft: alarms must never break the uplink path
    }
    if (rules.length === 0) return [];

    const created: unknown[] = [];
    for (const rule of rules) {
      const value = metrics[rule.metric];
      if (typeof value !== "number") continue;
      const breach = OPS[rule.op]?.(value, rule.threshold);
      if (!breach) continue;

      const key = `${tenantId}:${deviceId}:${rule.id}`;
      const last = this.lastFired.get(key) ?? 0;
      if (Date.now() - last < COOLDOWN_MS) continue;
      this.lastFired.set(key, Date.now());

      const message = `${rule.name}: ${rule.metric}=${value} ${rule.op} ${rule.threshold}`;
      try {
        const alarm = await this.prisma.alarm.create({
          data: {
            tenantId,
            deviceId,
            rule: {
              id: rule.id,
              metric: rule.metric,
              op: rule.op,
              threshold: rule.threshold,
              severity: rule.severity,
            },
            message,
            severity: rule.severity,
            state: "active",
            triggeredAt: reportedAt,
          },
        });
        created.push(alarm);
      } catch {
        // e.g. device row gone mid-flight — skip, do not break the batch
      }
    }
    return created;
  }
}
