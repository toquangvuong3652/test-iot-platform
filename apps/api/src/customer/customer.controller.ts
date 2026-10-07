import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CustomerService, CreateTenantDto } from "./customer.service";
import { Roles } from "../common/roles.decorator";
import { ok } from "../common/envelope";
import { z } from "zod";

@Roles("admin")
@Controller("tenants")
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  async list() {
    return ok(await this.customers.list());
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    return ok(await this.customers.get(id));
  }

  @Post()
  async create(@Body() raw: unknown) {
    const dto = CreateTenantDto.parse(raw);
    return ok(await this.customers.create(dto));
  }

  @Patch(":id/quota")
  async updateQuota(@Param("id") id: string, @Body() raw: unknown) {
    const dto = z.object({ quota: z.coerce.number().int().min(1).max(100000) }).parse(raw);
    return ok(await this.customers.updateQuota(id, dto.quota));
  }
}
