import { z } from "zod";

/** Common envelope present on every MQTT payload (up + down). */
export const Envelope = z.object({
  /** Idempotency key (uuid). QoS1 may redeliver -> consumer dedupes on this. */
  message_id: z.string().uuid(),
  /** ISO-8601 timestamp, coerced to Date. */
  ts: z.coerce.date(),
});

export type Envelope = z.infer<typeof Envelope>;
