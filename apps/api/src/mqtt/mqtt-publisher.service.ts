import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import { MQTT_KEEPALIVE_S, topic, type TopicKind } from "@iot/shared";

/**
 * The api's ONLY MQTT role: PUBLISH downlink `cmd` (and `rpc/request`) as the
 * "platform" principal. It does NOT subscribe — uplink lives in the consumer
 * process. The two talk to each other only via PostgreSQL (spec §3).
 *
 * EMQX authenticates us by calling POST /mqtt/auth with username=platform:api
 * and the PLATFORM_MQTT_TOKEN; see AuthService.mqttAuth.
 */
@Injectable()
export class MqttPublisherService implements OnModuleInit, OnModuleDestroy {
  private client: MqttClient | null = null;
  private readonly logger = new Logger(MqttPublisherService.name);
  private readonly broker: string;
  private readonly token: string;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    this.broker = this.config.getOrThrow<string>("MQTT_BROKER");
    this.token = this.config.getOrThrow<string>("PLATFORM_MQTT_TOKEN");
  }

  async onModuleInit() {}

  async start() {
  await this.ensureConnected();
  }

  async onModuleDestroy() {
    this.client?.end(true);
  }

  private ensureConnected(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise((resolve) => {
      const client = mqtt.connect(this.broker, {
        clientId: "platform:api",
        username: "platform:api",
        password: this.token,
        keepalive: MQTT_KEEPALIVE_S,
        reconnectPeriod: 5000,
        connectTimeout: 5000,
      });
      this.client = client;
      client.on("connect", () => this.logger.log(`MQTT publisher connected to ${this.broker}`));
      client.on("error", (e) => this.logger.error(`MQTT error: ${e.message}`));
      client.on("close", () => this.logger.warn("MQTT publisher closed; will reconnect"));
      // Resolve once connected OR after a timeout so startup isn't blocked forever.
      client.once("connect", () => resolve());
      setTimeout(() => {
        if (client.connected) resolve();
        else this.logger.warn("MQTT publisher not yet connected after 5s (will keep retrying)");
        resolve();
      }, 5000);
    });
    return this.connectPromise;
  }

  /** Publish a QoS1 downlink message. Returns true on broker ack. */
  async publish(
    tenantId: string,
    deviceId: string,
    kind: TopicKind,
    payload: unknown,
    qos: 0 | 1 = 1,
  ): Promise<boolean> {
    await this.ensureConnected();
    const client = this.client;
    if (!client || !client.connected) {
      this.logger.error(`MQTT not connected; dropping ${kind} for ${tenantId}/${deviceId}`);
      return false;
    }
    const t = topic(tenantId, deviceId, kind);
    return new Promise<boolean>((resolve) => {
      client.publish(
        t,
        JSON.stringify(payload),
        { qos, retain: false },
        (err) => {
          if (err) {
            this.logger.error(`publish ${t} failed: ${err.message}`);
            resolve(false);
          } else resolve(true);
        },
      );
    });
  }
}
