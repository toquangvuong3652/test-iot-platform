/**
 * Client-facing base URLs (Spec §6, cross-origin model).
 *
 * NEXT_PUBLIC_* are inlined by Next.js into the client bundle at BUILD time,
 * so they cannot be set at runtime — pass them as build ARGs (see Dockerfile).
 * The api has NO `/api` global prefix (EMQX's authn URL is `/mqtt/auth`), so
 * these base URLs are concatenated straight onto the route path.
 *
 * Falls back to same-origin ("" ) if unset — the dev default when the api /
 * consumer happen to be served from the same origin as the dashboard.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
export const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "";
