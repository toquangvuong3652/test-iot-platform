import { z } from "zod";

/**
 * Down: cloud -> device  (topic: .../cmd, QoS1).
 * Published by the api Command module; the device executes and replies on .../ack.
 */
export const Cmd = z.object({
  /** Correlates with the Command row + the device's ack. */
  command_id: z.string().uuid(),
  /** e.g. "setpoint" | "restart" | "calibrate". */
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  ts: z.coerce.date(),
});

export type Cmd = z.infer<typeof Cmd>;
