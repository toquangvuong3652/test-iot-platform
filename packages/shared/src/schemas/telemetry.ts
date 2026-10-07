import { z } from "zod";
import { Envelope } from "./envelope";

/**
 * Up: device -> cloud  (topic: .../telemetry, QoS0 is fine).
 * `metrics` is an open map so new machine types don't break the contract.
 */
export const Telemetry = Envelope.extend({
  metrics: z.record(z.string(), z.number()),
});

export type Telemetry = z.infer<typeof Telemetry>;
