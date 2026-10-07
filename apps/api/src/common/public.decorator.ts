import { SetMetadata } from "@nestjs/common";

/** Mark a route/controller public (skips JwtAuthGuard). Use sparingly: /auth/*, /mqtt/auth, /health. */
export const Public = () => SetMetadata("isPublic", true);
