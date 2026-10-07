/**
 * JWT boundary — locked from day 1 (PROTOCOL.md / spec §0).
 * Claims are FIXED: `sub · tenant_id · roles`. An IdP (Keycloak) retrofit
 * is cheap only because both api and consumer verify against this exact shape.
 *
 * Keep this dependency-free: it only declares the contract. Signing/verifying
 * happens in api (jsonwebtoken). The consumer verifies with the same secret.
 */

export type Role = "admin" | "member" | "viewer";

export const ROLES: Role[] = ["admin", "member", "viewer"];

export interface JwtClaims {
  /** User id. */
  sub: string;
  /** Tenant scope — every DB query + socket room is keyed on this. */
  tenant_id: string;
  roles: Role[];
}

export const JwtClaimsSchema = {
  hasTenant(claims: Partial<JwtClaims>): claims is JwtClaims {
    return (
      typeof claims.sub === "string" &&
      claims.sub.length > 0 &&
      typeof claims.tenant_id === "string" &&
      claims.tenant_id.length > 0 &&
      Array.isArray(claims.roles)
    );
  },
};

export const hasRole = (claims: JwtClaims, role: Role): boolean =>
  claims.roles.includes(role);
