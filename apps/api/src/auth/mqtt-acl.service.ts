import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parseTopic, type TopicKind } from "@iot/shared";
import { PrismaService } from "../prisma/prisma.service";

const DEVICE_PUB: TopicKind[] = ["telemetry", "status", "ack", "rpc/response"];
const DEVICE_SUB: TopicKind[] = ["cmd", "rpc/request"];
const CONSUMER_SUB: TopicKind[] = ["telemetry", "status", "ack", "rpc/response"];
const API_PUB: TopicKind[] = ["cmd", "rpc/request"];

/**
 * EMQX HTTP-ACL handler (PROTOCOL.md §5). EMQX asks, per (principal, topic,
 * access): allow or deny. Default-deny is enforced by EMQX itself
 * (`no_match = deny`); we must answer every request.
 *
 * Rules:
 *  - `platform:api`       -> pub on cmd / rpc/request only
 *  - `platform:consumer`  -> sub on all uplink topics only
 *  - `{tenant}:{device}`  -> pub uplink / sub downlink on ITS OWN topics only,
 *                            and only if the credential exists in PostgreSQL
 *
 * Credential existence is cached (TTL 30s) — EMQX calls this on every
 * pub/sub, so we cannot hit PostgreSQL per message.
 */
@Injectable()
export class MqttAclService {
  private static TTL_MS = 30_000;

  private readonly credCache = new Map<string, { at: number; ok: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async decide(input: {
    clientid?: string;
    username?: string;
    topic?: string;
    action?: string;
    internalSecret?: string;
  }): Promise<{ allow: boolean; reason?: string }> {
    console.log("[MQTT ACL DECIDE]", JSON.stringify(input));
    const expected = this.config.getOrThrow<string>("MQTT_AUTH_INTERNAL_SECRET");
    if (input.internalSecret !== expected) {
      return { allow: false, reason: "bad_internal_secret" };
    }
    // EMQX 5.8 sends action = "publish" | "subscribe"; normalize to pub/sub.
    const access =
      input.action === "subscribe" || input.action === "sub"
        ? "sub"
        : input.action === "publish" || input.action === "pub"
          ? "pub"
          : null;
    const username = input.username ?? input.clientid ?? "";
    const parsed = input.topic ? parseTopic(input.topic) : null;

    // --- platform principals ---
    if (username === "platform:api") {
      const ok = parsed !== null && access === "pub" && API_PUB.includes(parsed.kind);
      return ok ? { allow: true } : { allow: false, reason: "platform_scope" };
    }
    if (username === "platform:consumer") {
      const ok = parsed !== null && access === "sub" && CONSUMER_SUB.includes(parsed.kind);
      return ok ? { allow: true } : { allow: false, reason: "platform_scope" };
    }

    // --- device principals: username = clientid = `{tenantId}:{deviceId}` ---
    const sep = username.indexOf(":");
    if (sep <= 0) return { allow: false, reason: "bad_username" };
    const tenantId = username.slice(0, sep);
    const deviceId = username.slice(sep + 1);
    if (!tenantId || !deviceId) return { allow: false, reason: "bad_username" };

    if (!parsed || parsed.tenantId !== tenantId || parsed.deviceId !== deviceId) {
      return { allow: false, reason: "topic_mismatch" };
    }
    if (access === null) return { allow: false, reason: "bad_action" };

    if (!(await this.credExists(username))) {
      return { allow: false, reason: "unknown_device" };
    }

    if (access === "pub") {
      return DEVICE_PUB.includes(parsed.kind)
        ? { allow: true }
        : { allow: false, reason: "acl" };
    }
    return DEVICE_SUB.includes(parsed.kind)
      ? { allow: true }
      : { allow: false, reason: "acl" };
  }

  private async credExists(username: string): Promise<boolean> {
    const hit = this.credCache.get(username);
    if (hit && Date.now() - hit.at < MqttAclService.TTL_MS) return hit.ok;
    let ok = false;
    try {
      const cred = await this.prisma.deviceCredential.findUnique({
        where: { username },
        select: { id: true },
      });
      ok = cred !== null;
    } catch {
      ok = false; // fail closed
    }
    this.credCache.set(username, { at: Date.now(), ok });
    return ok;
  }
}
