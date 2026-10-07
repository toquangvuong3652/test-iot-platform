import * as mqtt from "mqtt";
import type { MqttClient } from "mqtt";
import {
  MQTT_KEEPALIVE_S,
  SUB_ALL_TELEMETRY,
  SUB_ALL_STATUS,
  SUB_ALL_ACK,
  SUB_ALL_RPC_RESPONSE,
} from "@iot/shared";
import type { Handler } from "./handler";

/**
 * Uplink subscriber (Spec §3). The consumer is a platform principal
 * (`platform:consumer`) — it subscribes to the wildcard uplink topics and
 * hands each message to the Handler. cmd is downlink (the api publishes it);
 * the consumer never subscribes to cmd.
 */
export class MqttUplink {
  private client: MqttClient | null = null;

  constructor(
    private readonly broker: string,
    private readonly token: string,
    private readonly handler: Handler,
  ) {}

  async connect(): Promise<void> {
    const client = mqtt.connect(this.broker, {
      clientId: "platform:consumer",
      username: "platform:consumer",
      password: this.token,
      keepalive: MQTT_KEEPALIVE_S,
      reconnectPeriod: 5000,
      connectTimeout: 5000,
      // QoS1 for cmd/ack redelivery guarantees; telemetry/status can be QoS0.
      clean: true,
    });
    this.client = client;

    client.on("error", (e) => console.error(`[mqtt] error: ${e.message}`));
    client.on("close", () => console.warn("[mqtt] closed; will reconnect"));

    client.on("connect", () => {
      console.log(`[mqtt] connected to ${this.broker}; subscribing to uplink topics`);
      const subs = [
        SUB_ALL_TELEMETRY,
        SUB_ALL_STATUS,
        SUB_ALL_ACK,
        SUB_ALL_RPC_RESPONSE,
      ];
      // mqtt.js subscribe takes a string[] (all same QoS) + an opts object.
      client.subscribe(
        subs,
        { qos: 1 },
        (err, granted) => {
          console.log("[mqtt] subscribe callback:", {
            err: err ? err.message : null,
            granted,
          });
        },
      );
    });

    client.on("message", (topic: string, payload: Buffer) => {
      // Fire-and-forget: the handler never throws and never blocks the loop.
      void this.handler.onMessage(topic, payload);
    });

    // Resolve once connected (or after a grace window) so main() can proceed.
    await new Promise<void>((resolve) => {
      client.once("connect", () => resolve());
      setTimeout(() => resolve(), 5000);
    });
  }

  end(): void {
    this.client?.end(true);
  }
}
