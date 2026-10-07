import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator";
import { Roles } from "../common/roles.decorator";
import { ok } from "../common/envelope";
import type { JwtClaims } from "@iot/shared";
import { AlarmService, CreateRuleDto, UpdateRuleDto } from "./alarm.service";
import { z } from "zod";

const ListQuery = z.object({
  state: z.enum(["active", "acknowledged", "resolved"]).optional(),
});

@Controller("alarms")
export class AlarmController {
  constructor(private readonly alarms: AlarmService) {}

  /** member+viewer: read. */
  @Get()
  async list(@CurrentUser() user: JwtClaims, @Query() raw: unknown) {
    const q = ListQuery.parse(raw);
    return ok(await this.alarms.list(user.tenant_id, q.state));
  }

  /** member: acknowledge. */
  @Post(":id/ack")
  async ack(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.alarms.acknowledge(user.tenant_id, id));
  }

  /** admin: resolve. */
  @Roles("admin")
  @Post(":id/resolve")
  async resolve(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.alarms.resolve(user.tenant_id, id));
  }

  // ---- Rules (threshold config) ----

  @Get("rules")
  async rules(@CurrentUser() user: JwtClaims, @Query() raw: unknown) {
    const q = z.object({ deviceId: z.string().uuid().optional() }).parse(raw);
    return ok(await this.alarms.rules(user.tenant_id, q.deviceId));
  }

  @Roles("member", "admin")
  @Post("rules")
  async createRule(@CurrentUser() user: JwtClaims, @Body() raw: unknown) {
    const dto = CreateRuleDto.parse(raw);
    return ok(await this.alarms.createRule(user.tenant_id, dto));
  }

  @Roles("member", "admin")
  @Post("rules/:id")
  async updateRule(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const dto = UpdateRuleDto.parse(raw);
    return ok(await this.alarms.updateRule(user.tenant_id, id, dto));
  }

  @Roles("member", "admin")
  @Delete("rules/:id")
  async deleteRule(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.alarms.deleteRule(user.tenant_id, id));
  }
}
