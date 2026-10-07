import { Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";

export const CreateTenantDto = z.object({
  name: z.string().min(1),
  plan: z.string().default("free"),
  quota: z.coerce.number().int().min(1).max(100000).default(50),
});
export type CreateTenantDto = z.infer<typeof CreateTenantDto>;

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { devices: true, users: true } } },
    });
  }

  get(id: string) {
    return this.prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { devices: true, users: true } } },
    });
  }

  create(dto: CreateTenantDto) {
    return this.prisma.tenant.create({ data: { ...dto } });
  }

  async updateQuota(id: string, quota: number) {
    await this.assertExists(id);
    return this.prisma.tenant.update({ where: { id }, data: { quota } });
  }

  private async assertExists(id: string) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Tenant not found");
    return t;
  }
}
