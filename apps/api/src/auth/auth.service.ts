import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcryptjs";
import { ConfigService } from "@nestjs/config";
import type { JwtClaims, Role } from "@iot/shared";
import { PrismaService } from "../prisma/prisma.service";
import { sha256hex, sha256hexEqual } from "../common/hash";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get secret() {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }

  /** Verify login and mint an access token (short) — spec §6. */
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException("Invalid credentials");
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Invalid credentials");
    return this.tokensFor(user.id, user.tenantId, user.role as Role);
  }

  async me(sub: string, tenantId: string) {
    const user = await this.prisma.scoped(tenantId).user.findUnique({
      where: { id: sub },
      select: { id: true, email: true, role: true, tenantId: true },
    });
    if (!user) throw new UnauthorizedException("User not found");
    return user;
  }

  /** Stateless refresh: verify a refresh token, re-issue a token pair. */
  async refresh(token: string) {
    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, this.secret);
      if (typeof verified === "string") throw new UnauthorizedException("Invalid refresh token");
      payload = verified;
    } catch (e) {
      throw e instanceof UnauthorizedException
        ? e
        : new UnauthorizedException("Invalid refresh token");
    }
    if (payload.type !== "refresh") throw new UnauthorizedException("Not a refresh token");
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException("User not found");
    return this.tokensFor(user.id, user.tenantId, user.role as Role);
  }

  private tokensFor(sub: string, tenantId: string, role: Role) {
    const claims: JwtClaims = { sub, tenant_id: tenantId, roles: [role] };
    // @types/jsonwebtoken@9 types expiresIn as ms's branded StringValue, so
    // a dynamic env string needs an explicit (runtime-identical) cast.
    const accessExpiry = (this.config.get<string>("JWT_EXPIRES_IN") ?? "15m") as jwt.SignOptions["expiresIn"];
    const access = jwt.sign({ ...claims, type: "access" }, this.secret, {
      expiresIn: accessExpiry,
    });
    const refresh = jwt.sign({ ...claims, type: "refresh" }, this.secret, {
      expiresIn: "7d",
    });
    return { access_token: access, refresh_token: refresh, token_type: "Bearer" };
  }

  /**
   * EMQX HTTP-authn handler (PROTOCOL.md §1). EMQX POSTs the CONNECT details;
   * we look up DeviceCredential by username (== clientid == `tenantId:deviceId`)
   * and verify the token hash. 200 = allow, 401 = deny.
   *
   * Protected by X-Internal-Secret (shared with EMQX), not a user JWT.
   */
  async mqttAuth(input: {
    clientid?: string;
    username?: string;
    password?: string;
    internalSecret?: string;
  }): Promise<{ allowed: boolean; reason?: string }> {
    const expected = this.config.getOrThrow<string>("MQTT_AUTH_INTERNAL_SECRET");
    if (input.internalSecret !== expected) {
      return { allowed: false, reason: "bad_internal_secret" };
    }
    const username = input.username ?? input.clientid ?? "";
    const password = input.password ?? "";

    // Platform principal (api downlink / consumer). Shared secret in env.
    if (username.startsWith("platform:")) {
      const platformToken = this.config.getOrThrow<string>("PLATFORM_MQTT_TOKEN");
      if (password === platformToken) return { allowed: true };
      return { allowed: false, reason: "bad_platform_token" };
    }
    const sep = username.indexOf(":");
    if (sep <= 0) return { allowed: false, reason: "bad_username" };
    const tenantId = username.slice(0, sep);
    const deviceId = username.slice(sep + 1);
    if (!tenantId || !deviceId) return { allowed: false, reason: "bad_username" };

    const cred = await this.prisma.deviceCredential.findUnique({ where: { username } });
    if (!cred) return { allowed: false, reason: "unknown_device" };
    if (cred.tenantId !== tenantId) return { allowed: false, reason: "tenant_mismatch" };
    if (!sha256hexEqual(cred.tokenHash, sha256hex(password))) {
      return { allowed: false, reason: "bad_token" };
    }
    return { allowed: true };
  }
}
