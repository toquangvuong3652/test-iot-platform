import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Online/offline/error counts + active alarms for the header strip. */
  async summary(tenantId: string) {
    const [devices, activeAlarms] = await Promise.all([
      this.prisma.scoped(tenantId).device.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      this.prisma
        .scoped(tenantId)
        .alarm.count({ where: { state: "active" } }),
    ]);
    const byStatus: Record<string, number> = {};
    for (const row of devices) byStatus[row.status] = row._count._all;
    return {
      online: byStatus["online"] ?? 0,
      offline: byStatus["offline"] ?? 0,
      error: byStatus["error"] ?? 0,
      total: devices.reduce((s, r) => s + r._count._all, 0),
      activeAlarms,
    };
  }

  /** Latest value per device (reused from telemetry, but co-located here). */
  latest(tenantId: string) {
    return this.prisma.$queryRaw<
      { device_id: string; data: Prisma.JsonValue; reported_at: Date }[]
    >(Prisma.sql`
      SELECT DISTINCT ON (device_id) device_id, data, reported_at
      FROM telemetry
      WHERE tenant_id = ${tenantId}
      ORDER BY device_id, reported_at DESC
    `).then((rows) =>
      rows.map((r) => ({
        deviceId: r.device_id,
        metrics: (r.data ?? {}) as Record<string, number>,
        reportedAt: r.reported_at,
      })),
    );
  }
}
