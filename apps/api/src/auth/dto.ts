import { z } from "zod";

export const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginDto>;

export const RefreshDto = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshDto = z.infer<typeof RefreshDto>;

export const MqttAuthDto = z.object({
  clientid: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
});
export type MqttAuthDto = z.infer<typeof MqttAuthDto>;

/**
 * EMQX HTTP-ACL request (PROTOCOL.md §5). EMQX 5.8 sends `action` as
 * "publish" | "subscribe" (the 4.x "pub"/"sub" values are NOT sent by 5.8),
 * so we accept all four to stay forward/backward compatible.
 */
export const MqttAclDto = z.object({
  clientid: z.string().optional(),
  username: z.string().min(1),
  topic: z.string().min(1),
  action: z.enum(["publish", "subscribe", "pub", "sub"]).optional(),
});
export type MqttAclDto = z.infer<typeof MqttAclDto>;
