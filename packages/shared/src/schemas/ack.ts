import { z } from "zod";

/**
 * Up: device -> cloud  (topic: .../ack, QoS1).
 * `command_id` matches the cmd that triggered it.
 */
export const Ack = z.object({
  command_id: z.string().uuid(),
  state: z.enum(["ok", "failed"]),
  result: z.record(z.string(), z.unknown()).optional(),
  ts: z.coerce.date(),
});

export type Ack = z.infer<typeof Ack>;
