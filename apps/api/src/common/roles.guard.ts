import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { JwtClaims, Role } from "@iot/shared";
import type { Request } from "express";

/**
 * RBAC (Spec §6): admin (all + tenant/user), member (device/command/telemetry),
 * viewer (read-only). Reads required roles from @Roles metadata.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>("roles", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = ctx
      .switchToHttp()
      .getRequest<Request & { user: JwtClaims }>().user;
    if (!user || !required.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException("Insufficient role");
    }
    return true;
  }
}
