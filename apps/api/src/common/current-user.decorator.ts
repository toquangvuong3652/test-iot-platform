import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { JwtClaims } from "@iot/shared";
import type { Request } from "express";

/** Inject the verified JWT claims (set by JwtAuthGuard) into a handler arg. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtClaims => {
    const req = ctx.switchToHttp().getRequest<Request & { user: JwtClaims }>();
    return req.user;
  },
);
