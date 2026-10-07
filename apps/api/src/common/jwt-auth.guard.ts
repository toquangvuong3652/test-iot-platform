import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import * as jwt from "jsonwebtoken";
import { JwtClaimsSchema, type JwtClaims } from "@iot/shared";
import type { Request } from "express";

/**
 * Global guard (default-secure). Verifies the Bearer JWT, validates the locked
 * claim shape (sub · tenant_id · roles) and attaches claims to the request.
 * Routes marked @Public() skip it. (Spec §0: JWT boundary from day 1.)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>("isPublic", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtClaims }>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException("Missing bearer token");

    let payload: unknown;
    try {
      payload = jwt.verify(token, this.config.getOrThrow<string>("JWT_SECRET"));
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    if (!JwtClaimsSchema.hasTenant(payload as Partial<JwtClaims>)) {
      throw new UnauthorizedException("Token missing required claims");
    }
    req.user = payload as JwtClaims;
    return true;
  }
}
