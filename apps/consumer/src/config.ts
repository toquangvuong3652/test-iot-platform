import { z } from "zod";

/**
 * Consumer env. Fail fast at boot. (Spec §14: secrets via env, never hardcoded.)
 */
export const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MQTT_BROKER: z.string().default("emqx:1883"),
  // socket.io port (dashboard realtime).
  PORT: z.coerce.number().default(3001),
  // Verifies the dashboard's JWT on socket connect (same secret as the api).
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be >= 16 chars"),
  // MQTT CONNECT password for the "platform:consumer" principal.
  PLATFORM_MQTT_TOKEN: z.string().min(16, "PLATFORM_MQTT_TOKEN must be >= 16 chars"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  return EnvSchema.parse(process.env);
}
