import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";

export const CreateRuleDto = z.object({
  deviceId: z.string().uuid(),
  name: z.string().min(1),
  metric: z.string().min(1),
  op: z.enum(["gt", "gte", "lt", "lte"]).default("gt"),
  threshold: z.coerce.number(),
  severity: z.enum(["info", "warn", "critical"]).default("warn"),
  enabled: z.boolean().default(true),
});
export type CreateRuleDto = z.infer<typeof CreateRuleDto>;

export const UpdateRuleDto = CreateRuleDto.omit({ deviceId: true }).partial();
export type UpdateRuleDto = z.infer<typeof UpdateRuleDto>;

@Injectable()
export class AlarmService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, state?: string) {
    const where = state ? { state } : {};
    return this.prisma.scoped(tenantId).alarm.findMany({
      where,
      orderBy: { triggeredAt: "desc" },
      take: 500,
    });
  }

  /** member: acknowledge an active alarm. */
  async acknowledge(tenantId: string, id: string) {
    const scoped = this.prisma.scoped(tenantId);
    const alarm = await scoped.alarm.findUnique({ where: { id } });
    if (!alarm) throw new NotFoundException("Alarm not found");
    if (alarm.state !== "active") {
      return { already: alarm.state };
    }
    return scoped.alarm.update({ where: { id }, data: { state: "acknowledged" } });
  }

  async resolve(tenantId: string, id: string) {
    const scoped = this.prisma.scoped(tenantId);
    const alarm = await scoped.alarm.findUnique({ where: { id } });
    if (!alarm) throw new NotFoundException("Alarm not found");
    return scoped.alarm.update({
      where: { id },
      data: { state: "resolved", resolvedAt: new Date() },
    });
  }

  // ---- Rules (threshold config the consumer reads) ----

  rules(tenantId: string, deviceId?: string) {
    const where = deviceId ? { deviceId } : {};
    return this.prisma.scoped(tenantId).deviceRule.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
  }

  async createRule(tenantId: string, dto: CreateRuleDto) {
    const scoped = this.prisma.scoped(tenantId);
    const dev = await scoped.device.findUnique({
      where: { id: dto.deviceId },
      select: { id: true },
    });
    if (!dev) throw new NotFoundException("Device not found");
    return scoped.deviceRule.create({ data: { ...dto, tenantId } });
  }

  async updateRule(tenantId: string, id: string, dto: UpdateRuleDto) {
    const scoped = this.prisma.scoped(tenantId);
    const rule = await scoped.deviceRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("Rule not found");
    return scoped.deviceRule.update({ where: { id }, data: { ...dto } });
  }

  async deleteRule(tenantId: string, id: string) {
    const scoped = this.prisma.scoped(tenantId);
    const rule = await scoped.deviceRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException("Rule not found");
    await scoped.deviceRule.delete({ where: { id } });
    return { deleted: true };
  }
}
