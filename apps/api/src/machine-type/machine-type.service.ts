import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";

export const CreateMachineTypeDto = z.object({
  name: z.string().min(1),
  spec: z.record(z.string(), z.unknown()).default({}),
});
export type CreateMachineTypeDto = z.infer<typeof CreateMachineTypeDto>;

/**
 * MachineType is a catalog of machine models (no tenantId column). Devices
 * reference it; tenant isolation happens at the Device level.
 */
@Injectable()
export class MachineTypeService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.machineType.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { devices: true } } },
    });
  }

  create(dto: CreateMachineTypeDto) {
    return this.prisma.machineType.create({
      data: { name: dto.name, spec: dto.spec as Prisma.InputJsonValue },
    });
  }

  async get(id: string) {
    const mt = await this.prisma.machineType.findUnique({ where: { id } });
    if (!mt) throw new NotFoundException("Machine type not found");
    return mt;
  }
}
