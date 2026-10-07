import { z } from "zod";
import { Envelope } from "./envelope";

/**
 * Up: device -> cloud  (topic: .../status, QoS0).
 * Real device messages carry the full envelope (message_id + ts).
 */
export const Status = Envelope.extend({
  state: z.enum(["online", "offline", "error"]),
  reason: z.string().optional(),
});

export type Status = z.infer<typeof Status>;

/**
 * EMQX Last-Will payload (PROTOCOL.md §1): a STATIC string the broker
 * publishes when the device's connection drops — it CANNOT contain a
 * per-message uuid, so it is a bare `{ "state": "offline" }` with no
 * envelope. The consumer must accept both shapes:
 * `StatusOrLwt` is the validation entry point for the .../status topic.
 * LWT handling is idempotent by nature (no message_id to dedupe on).
 */
export const StatusLwt = z.object({
  state: z.enum(["online", "offline", "error"]),
  reason: z.string().optional(),
});

export type StatusLwt = z.infer<typeof StatusLwt>;

export const StatusOrLwt = z.union([Status, StatusLwt]);

export type StatusOrLwt = z.infer<typeof StatusOrLwt>;

/** True when the parsed payload is a bare LWT (no envelope). */
export const isLwt = (p: StatusOrLwt): p is StatusLwt => !("message_id" in p);
