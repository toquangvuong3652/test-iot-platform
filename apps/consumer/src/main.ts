import { PrismaClient } from "@prisma/client";
import { loadEnv } from "./config";
import { Gateway } from "./gateway";
import { Handler } from "./handler";
import { MqttUplink } from "./mqtt";

/**
 * Consumer entrypoint (Spec §3).
 * Owns: the socket.io gateway (realtime dashboard feed) and the MQTT uplink
 * subscriber. Business reads/writes stay in the api; the consumer only
 * persists uplink + emits realtime. The two never import each other.
 */
async function main() {
  const env = loadEnv();
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("[consumer] prisma connected");

  const gateway = new Gateway(env.JWT_SECRET);
  await gateway.listen(env.PORT);
  console.log(`[consumer] socket.io gateway on :${env.PORT}`);

  const handler = new Handler(prisma, gateway);
  const uplink = new MqttUplink(env.MQTT_BROKER, env.PLATFORM_MQTT_TOKEN, handler);
  await uplink.connect();

  const shutdown = async (signal: string) => {
    console.log(`[consumer] ${signal} received; shutting down`);
    try {
      uplink.end();
      gateway.io.close();
      await gateway.server.close();
      await prisma.$disconnect();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[consumer] fatal:", e);
  process.exit(1);
});
