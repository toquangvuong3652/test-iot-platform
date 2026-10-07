import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator";
import { ok } from "../common/envelope";
import type { JwtClaims } from "@iot/shared";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  /** Header strip: device status counts + active alarms. */
  @Get("summary")
  async summary(@CurrentUser() user: JwtClaims) {
    return ok(await this.dash.summary(user.tenant_id));
  }

  /** Latest value per device (one row per device, newest report). */
  @Get("latest")
  async latest(@CurrentUser() user: JwtClaims) {
    return ok(await this.dash.latest(user.tenant_id));
  }
}
