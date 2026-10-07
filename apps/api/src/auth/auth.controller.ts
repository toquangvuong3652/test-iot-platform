import { Body, Controller, Get, Headers, HttpCode, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { Public } from "../common/public.decorator";
import { CurrentUser } from "../common/current-user.decorator";
import { ok } from "../common/envelope";
import type { JwtClaims } from "@iot/shared";
import { LoginDto, RefreshDto, MqttAuthDto } from "./dto";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("auth/login")
  async login(@Body() raw: unknown) {
    const dto = LoginDto.parse(raw);
    return ok(await this.auth.login(dto.email, dto.password));
  }

  @Public()
  @Post("auth/refresh")
  async refresh(@Body() raw: unknown) {
    const dto = RefreshDto.parse(raw);
    return ok(await this.auth.refresh(dto.refresh_token));
  }

  /** Requires JWT (global guard). Returns the authenticated user. */
  @Get("auth/me")
  async me(@CurrentUser() user: JwtClaims) {
    return ok(await this.auth.me(user.sub, user.tenant_id));
  }

  /**
   * EMQX 5.8.3 HTTP-authn callback (PROTOCOL.md §1). Not JWT-authenticated —
   * EMQX presents the shared X-Internal-Secret instead.
   *
   * EMQX 5.8.3 http-authn contract (v5.8 docs, access-control/authn/http):
   * the RESULT is in the JSON body — `{"result": "allow" | "deny" | "ignore"}`
   * — returned with HTTP 200. Status 204 = allow; any other status (4xx/5xx)
   * makes EMQX IGNORE this source and continue the authn chain (it does NOT
   * mean "deny" — that was the 4.x contract). So the api always answers 200
   * (or 204) and never relies on the status code. `code`/`message` below are
   * informational only (EMQX never reads them).
   */
  @Public()
  @HttpCode(200)
  @Post("mqtt/auth")
  async mqttAuth(
    @Body() raw: unknown,
    @Headers("x-internal-secret") secret: string | undefined,
  ) {
    const dto = MqttAuthDto.parse(raw);
    const result = await this.auth.mqttAuth({ ...dto, internalSecret: secret });
    return {
      result: result.allowed ? "allow" : "deny",
      code: result.allowed ? 0 : 1,
      message: result.reason ?? "ok",
    };
  }
}
