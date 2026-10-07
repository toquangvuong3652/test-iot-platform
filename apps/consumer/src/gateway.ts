import * as http from "node:http";
import { Server, Socket } from "socket.io";
import * as jwt from "jsonwebtoken";
import { JwtClaimsSchema, type JwtClaims } from "@iot/shared";

/**
 * Realtime feed (Spec §3): socket.io, one room per tenant (`tenant:{id}`).
 * The dashboard joins its room after JWT auth; the consumer emits
 * `telemetry` / `status` / `alarm` / `ack` events into the tenant's room.
 * No polling in the UI.
 */
export class Gateway {
  readonly server: http.Server;
  readonly io: Server;
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
    this.server = http.createServer();
    this.io = new Server(this.server, {
      // The web app (Next.js) proxies /socket.io in Phase 1, so allow cross-origin
      // only from the same host via the tunnel.
      cors: { origin: true, credentials: true },
    });

    // JWT handshake: client passes { token } in the auth payload.
    this.io.use((socket, next) => {
      try {
        const token = (socket.handshake.auth?.token ?? "") as string;
        const payload = jwt.verify(token, this.secret);
        if (!JwtClaimsSchema.hasTenant(payload as Partial<JwtClaims>)) {
          return next(new Error("bad_claims"));
        }
        (socket.data as { user: JwtClaims }).user = payload as JwtClaims;
        next();
      } catch {
        next(new Error("unauthorized"));
      }
    });

    this.io.on("connection", (socket: Socket) => {
      const user = (socket.data as { user: JwtClaims }).user;
      socket.join(`tenant:${user.tenant_id}`);
    });
  }

  /** Emit to every dashboard connected for this tenant. */
  emit(tenantId: string, event: "telemetry" | "status" | "alarm" | "ack", payload: unknown) {
    this.io.to(`tenant:${tenantId}`).emit(event, payload);
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => this.server.listen(port, () => resolve()));
  }
}
