import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import * as bcrypt from "bcryptjs";
import type { Role } from "@iot/shared";
import { PrismaService } from "../prisma/prisma.service";

export const CreateUserDto = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});
export type CreateUserDto = z.infer<typeof CreateUserDto>;

export const UpdateUserDto = z.object({
  role: z.enum(["admin", "member", "viewer"]).optional(),
  password: z.string().min(8).optional(),
});
export type UpdateUserDto = z.infer<typeof UpdateUserDto>;

const BCRYPT_ROUNDS = 10;

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tenant-scoped: `scoped(tenantId)` injects tenantId into every query. */
  list(tenantId: string) {
    return this.prisma.scoped(tenantId).user.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, role: true, createdAt: true },
    });
  }

  async create(tenantId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException("Email already in use");
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    return this.prisma.user.create({
      data: { tenantId, email: dto.email, passwordHash, role: dto.role },
      select: { id: true, email: true, role: true, tenantId: true, createdAt: true },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    const scoped = this.prisma.scoped(tenantId);
    const existing = await scoped.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("User not found");
    const data: { role?: Role; passwordHash?: string } = {};
    if (dto.role) data.role = dto.role;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    return scoped.user.update({
      where: { id },
      data,
      select: { id: true, email: true, role: true, tenantId: true },
    });
  }

  async remove(tenantId: string, id: string) {
    const scoped = this.prisma.scoped(tenantId);
    const existing = await scoped.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("User not found");
    await scoped.user.delete({ where: { id } });
    return { deleted: true };
  }
}
