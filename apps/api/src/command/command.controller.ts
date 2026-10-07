import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator";
import { Roles } from "../common/roles.decorator";
import { ok } from "../common/envelope";
import type { JwtClaims } from "@iot/shared";
import { CommandService, CreateCommandDto } from "./command.service";
import { z } from "zod";

const ListQuery = z.object({
  state: z.enum(["pending", "acked", "failed", "expired"]).optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
});

@Controller("commands")
export class CommandController {
  constructor(private readonly commands: CommandService) {}

  /** member+admin: fire a downlink command (publishes `cmd` QoS1). */
  @Roles("member", "admin")
  @Post()
  async create(@CurrentUser() user: JwtClaims, @Body() raw: unknown) {
    const dto = CreateCommandDto.parse(raw);
    return ok(await this.commands.create(user.tenant_id, dto));
  }

  @Get()
  async list(@CurrentUser() user: JwtClaims, @Query() raw: unknown) {
    const q = ListQuery.parse(raw);
    return ok(await this.commands.list(user.tenant_id, q.state, q.take));
  }

  @Get(":id")
  async get(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.commands.get(user.tenant_id, id));
  }
}
