import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Roles } from "../common/roles.decorator";
import { ok } from "../common/envelope";
import { MachineTypeService, CreateMachineTypeDto } from "./machine-type.service";

@Controller("machine-types")
export class MachineTypeController {
  constructor(private readonly machineTypes: MachineTypeService) {}

  @Get()
  async list() {
    return ok(await this.machineTypes.list());
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    return ok(await this.machineTypes.get(id));
  }

  @Roles("admin")
  @Post()
  async create(@Body() raw: unknown) {
    const dto = CreateMachineTypeDto.parse(raw);
    return ok(await this.machineTypes.create(dto));
  }
}
