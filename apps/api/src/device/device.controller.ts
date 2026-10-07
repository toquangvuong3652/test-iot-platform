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
import { DeviceService, CreateDeviceDto } from "./device.service";
import { z } from "zod";

const ListQuery = z.object({
  status: z.enum(["online", "offline", "error"]).optional(),
});

@Controller("devices")
export class DeviceController {
  constructor(private readonly devices: DeviceService) {}

  /** member+viewer: read. */
  @Get()
  async list(@CurrentUser() user: JwtClaims, @Query() raw: unknown) {
    const q = ListQuery.parse(raw);
    return ok(await this.devices.list(user.tenant_id, q.status));
  }

  /** admin: register (mints a credential, token shown once). */
  @Roles("admin")
  @Post()
  async create(@CurrentUser() user: JwtClaims, @Body() raw: unknown) {
    const dto = CreateDeviceDto.parse(raw);
    return ok(await this.devices.register(user.tenant_id, dto));
  }

  @Get(":id")
  async get(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.devices.get(user.tenant_id, id));
  }

  /** admin: rotate the device token (old one dies at next CONNECT). */
  @Roles("admin")
  @Post(":id/credentials/rotate")
  async rotate(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.devices.rotateCredential(user.tenant_id, id));
  }

  @Roles("admin")
  @Delete(":id")
  async remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.devices.remove(user.tenant_id, id));
  }
}
