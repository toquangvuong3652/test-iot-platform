import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser } from "../common/current-user.decorator";
import { ok } from "../common/envelope";
import type { JwtClaims } from "@iot/shared";
import { TelemetryService } from "./telemetry.service";
import { z } from "zod";

const SeriesQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(10000).optional(),
});

@Controller("telemetry")
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  /**
   * Series for ECharts.
   * GET /telemetry?from&to&take            -> latest value per device (dashboard)
   * GET /telemetry/devices/:id?from&to&take -> one device's series
   */
  @Get()
  latest(@CurrentUser() user: JwtClaims) {
    return ok(this.telemetry.latestByDevice(user.tenant_id));
  }

  @Get("devices/:id")
  async series(
    @CurrentUser() user: JwtClaims,
    @Param("id") deviceId: string,
    @Query() raw: unknown,
  ) {
    const q = SeriesQuery.parse(raw);
    return ok(await this.telemetry.list(user.tenant_id, deviceId, q));
  }
}
