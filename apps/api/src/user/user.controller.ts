import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator";
import { Roles } from "../common/roles.decorator";
import { ok } from "../common/envelope";
import type { JwtClaims } from "@iot/shared";
import { UserService, CreateUserDto, UpdateUserDto } from "./user.service";

@Roles("admin")
@Controller("users")
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  async list(@CurrentUser() user: JwtClaims) {
    return ok(await this.users.list(user.tenant_id));
  }

  @Post()
  async create(@CurrentUser() user: JwtClaims, @Body() raw: unknown) {
    const dto = CreateUserDto.parse(raw);
    return ok(await this.users.create(user.tenant_id, dto));
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: JwtClaims,
    @Param("id") id: string,
    @Body() raw: unknown,
  ) {
    const dto = UpdateUserDto.parse(raw);
    return ok(await this.users.update(user.tenant_id, id, dto));
  }

  @Delete(":id")
  async remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return ok(await this.users.remove(user.tenant_id, id));
  }
}
