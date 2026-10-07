import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { randomToken, sha256hex } from "../common/hash";

export const CreateDeviceDto = z.object({
  name: z.string().min(1),
  machineTypeId: z.string().uuid().optional(),
});
export type CreateDeviceDto = z.infer<typeof CreateDeviceDto>;

/** Returned once at registration; only the hash is stored. */
export interface DeviceCredentialResult {
  deviceId: string;
  /** EMQX clientid/username = `${tenantId}:${deviceId}`. */
  username: string;
  /** The raw token — shown exactly once, never stored in plaintext. */
  token: string;
}

@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, status?: string) {
    const where = status ? { status } : {};
    return this.prisma.scoped(tenantId).device.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        machineType: { select: { id: true, name: true } },
        _count: { select: { alarms: true, commands: true } },
      },
    });
  }

  async get(tenantId: string, id: string) {
    const dev = await this.prisma.scoped(tenantId).device.findUnique({
      where: { id },
      include: {
        machineType: { select: { id: true, name: true, spec: true } },
        credential: {
          select: { username: true, rotatedAt: true },
        },
      },
    });
    if (!dev) throw new NotFoundException("Device not found");
    return dev;
  }

  /**
   * Register a device: enforces the tenant quota, creates the device row and
   * its credential, and returns the raw token ONCE. The token is verified by
   * EMQX via /mqtt/auth (sha256 compare against the stored hash).
   */
  async register(tenantId: string, dto: CreateDeviceDto): Promise<DeviceCredentialResult> {
    const scoped = this.prisma.scoped(tenantId);

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException("Tenant not found");

    const count = await scoped.device.count();
    if (count >= tenant.quota) {
      throw new BadRequestException(`Device quota reached (${tenant.quota})`);
    }

    const token = randomToken();
    const device = await scoped.device.create({
      data: { tenantId, name: dto.name, machineTypeId: dto.machineTypeId ?? null },
    });
    const finalUsername = `${tenantId}:${device.id}`;
    await this.prisma.deviceCredential.create({
      data: {
        tenantId,
        deviceId: device.id,
        username: finalUsername,
        tokenHash: sha256hex(token),
      },
    });

    return { deviceId: device.id, username: finalUsername, token };
  }

  /** Rotate the device token. Old token stops working on next CONNECT. */
  async rotateCredential(tenantId: string, deviceId: string): Promise<DeviceCredentialResult> {
    const scoped = this.prisma.scoped(tenantId);
    const dev = await scoped.device.findUnique({ where: { id: deviceId } });
    if (!dev) throw new NotFoundException("Device not found");

    const token = randomToken();
    const username = `${tenantId}:${deviceId}`;
    const existing = await this.prisma.deviceCredential.findUnique({ where: { username } });
    if (existing) {
      await this.prisma.deviceCredential.update({
        where: { username },
        data: { tokenHash: sha256hex(token), rotatedAt: new Date() },
      });
    } else {
      await this.prisma.deviceCredential.create({
        data: { tenantId, deviceId, username, tokenHash: sha256hex(token) },
      });
    }
    return { deviceId, username, token };
  }

  /** Admin-only: delete a device (cascades credential/alarms/commands). */
  async remove(tenantId: string, id: string) {
    const scoped = this.prisma.scoped(tenantId);
    const dev = await scoped.device.findUnique({ where: { id } });
    if (!dev) throw new NotFoundException("Device not found");
    await scoped.device.delete({ where: { id } });
    return { deleted: true };
  }
}
