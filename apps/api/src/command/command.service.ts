import {
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { MqttPublisherService } from "../mqtt/mqtt-publisher.service";

export const CreateCommandDto = z.object({
  deviceId: z.string().uuid(),
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type CreateCommandDto = z.infer<typeof CreateCommandDto>;

/**
 * Command downlink + state machine (PROTOCOL.md §6).
 *   pending -> acked   (consumer writes the ack row)
 *   pending -> expired (this service's sweeper, after COMMAND_ACK_TIMEOUT_MS)
 *   (device reports failure) -> failed
 *
 * The api publishes `cmd` QoS1 and records `pending`. The CONSUMER process
 * receives `ack` and updates the row — api and consumer never call each
 * other directly; they share PostgreSQL (spec §3).
 */
@Injectable()
export class CommandService {
  private readonly logger = new Logger(CommandService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttPublisherService,
    config: ConfigService,
  ) {
    this.timeoutMs = config.get<number>("COMMAND_ACK_TIMEOUT_MS") ?? 15000;
  }

  async create(tenantId: string, dto: CreateCommandDto) {
    const scoped = this.prisma.scoped(tenantId);
    const dev = await scoped.device.findUnique({
      where: { id: dto.deviceId },
      select: { id: true },
    });
    if (!dev) throw new NotFoundException("Device not found");

    const cmd = await scoped.command.create({
      data: {
        tenantId,
        deviceId: dto.deviceId,
        type: dto.type,
        // zod's Record<string, unknown> isn't directly InputJsonValue.
        payload: dto.payload as Prisma.InputJsonValue,
        state: "pending",
      },
    });

    // Publish downlink AFTER the row exists, so an ack can never race ahead
    // of the command it confirms.
    const published = await this.mqtt.publish(
      tenantId,
      dto.deviceId,
      "cmd",
      {
        command_id: cmd.id,
        type: cmd.type,
        payload: cmd.payload,
        ts: new Date().toISOString(),
      },
      1,
    );
    if (!published) {
      this.logger.error(
        `cmd ${cmd.id} for ${dto.deviceId}: broker not connected — left 'pending', sweeper will expire it`,
      );
    }
    return cmd;
  }

  get(tenantId: string, id: string) {
    return this.prisma.scoped(tenantId).command.findUnique({
      where: { id },
      include: { device: { select: { id: true, name: true } } },
    });
  }

  list(tenantId: string, state?: string, take = 100) {
    const where = state ? { state } : {};
    return this.prisma.scoped(tenantId).command.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take,
      include: { device: { select: { id: true, name: true } } },
    });
  }

  /**
   * Sweeper (called by an interval in main.ts): mark stale pending commands
   * expired so the dashboard never shows "pending" forever. Runs system-wide
   * (command rows already carry tenantId; the update touches no tenant data
   * the caller doesn't own).
   */
  async expireStaleAll() {
    const cutoff = new Date(Date.now() - this.timeoutMs);
    const res = await this.prisma.command.updateMany({
      where: { state: "pending", publishedAt: { lt: cutoff } },
      data: { state: "expired" },
    });
    if (res.count > 0) {
      this.logger.log(`Expired ${res.count} stale pending command(s)`);
    }
    return res;
  }
}
