import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface TelemetryQuery {
  from?: Date;
  to?: Date;
  take?: number;
}

@Injectable()
export class TelemetryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Series query for ECharts (tenant-scoped, per device, time-bounded). */
  async list(tenantId: string, deviceId: string, q: TelemetryQuery = {}) {
    await this.assertDevice(tenantId, deviceId);
    const rows = await this.prisma.scoped(tenantId).telemetry.findMany({
      where: {
        deviceId,
        reportedAt: {
          ...(q.from ? { gte: q.from } : {}),
          ...(q.to ? { lte: q.to } : {}),
        },
      },
      orderBy: { reportedAt: "asc" },
      take: Math.min(q.take ?? 5000, 10000),
    });
    return rows.map((r) => ({
      reportedAt: r.reportedAt,
      metrics: r.data as Record<string, number>,
    }));
  }

  /** Latest telemetry per device (dashboard "current value" view). */
  async latestByDevice(tenantId: string) {
    const rows = await this.prisma.$queryRaw<
      { device_id: string; data: Prisma.JsonValue; reported_at: Date }[]
    >(Prisma.sql`
      SELECT DISTINCT ON (device_id) device_id, data, reported_at
      FROM telemetry
      WHERE tenant_id = ${tenantId}
      ORDER BY device_id, reported_at DESC
    `);
    return rows.map((r) => ({
      deviceId: r.device_id,
      metrics: (r.data ?? {}) as Record<string, number>,
      reportedAt: r.reported_at,
    }));
  }

  private async assertDevice(tenantId: string, deviceId: string) {
    const dev = await this.prisma
      .scoped(tenantId)
      .device.findUnique({ where: { id: deviceId }, select: { id: true } });
    if (!dev) throw new NotFoundException("Device not found");
  }
}
