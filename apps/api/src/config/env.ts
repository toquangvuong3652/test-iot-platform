import { z } from "zod";

/**
 * Validated environment. Fail fast at bootstrap if a required var is missing.
 * (Spec §14: secrets via env / Docker secret, never hardcoded.)
 */
export const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MQTT_BROKER: z.string().default("emqx:1883"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be >= 16 chars"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  // Shared with EMQX's HTTP-authn call so a forged /mqtt/auth can't get in.
  MQTT_AUTH_INTERNAL_SECRET: z.string().min(16, "MQTT_AUTH_INTERNAL_SECRET must be >= 16 chars"),
  // Token the api/consumer use to authenticate to EMQX as the "platform" principal
  // (so they can publish downlink cmd). Verified by /mqtt/auth against sha256().
  PLATFORM_MQTT_TOKEN: z.string().min(16, "PLATFORM_MQTT_TOKEN must be >= 16 chars"),
  COMMAND_ACK_TIMEOUT_MS: z.coerce.number().default(15000),
  // Public origin(s) the web dashboard is allowed to call this api from
  // (cross-origin model). Comma-separated; must be the web's PUBLIC origin.
  CORS_ORIGIN: z.string().default("http://localhost:3002"),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  return EnvSchema.parse(raw);
}
