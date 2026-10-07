import { SetMetadata } from "@nestjs/common";
import type { Role } from "@iot/shared";

/** Declare required roles for a route: @Roles("admin", "member"). */
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);
