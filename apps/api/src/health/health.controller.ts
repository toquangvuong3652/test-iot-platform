import { Controller, Get } from "@nestjs/common";
import { Public } from "../common/public.decorator";

/**
 * Liveness for Docker/Cloudflare. Public on purpose — it exposes nothing
 * tenant-scoped, only that the process + DB are up.
 */
@Public()
@Controller("health")
export class HealthController {
  @Get()
  check() {
    return { ok: true, ts: new Date().toISOString() };
  }
}
