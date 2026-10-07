import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

import { AppModule } from "./app.module";
import { CommandService } from "./command/command.service";
import { MqttPublisherService } from "./mqtt/mqtt-publisher.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Command expiry sweeper — pending commands past ACK timeout → expired.
  const commands = app.get(CommandService);
  const sweeper = setInterval(() => {
    commands.expireStaleAll().catch(() => {});
  }, 30_000);
  sweeper.unref();

  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>("PORT");

  // Cross-origin: the web dashboard (NEXT_PUBLIC_API_URL) calls this api
  // directly from the browser. CORS_ORIGIN holds the comma-separated public
  // origins to allow; empty => no cross-origin requests allowed (safe default).
  const corsOrigin = config.get<string>("CORS_ORIGIN", "");
  app.enableCors({ origin: corsOrigin.split(",").map((s) => s.trim()).filter(Boolean) });

  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on :${port}`);

  const mqttPublisher = app.get(MqttPublisherService);
  await mqttPublisher.start();
}

void bootstrap();
