import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { MqttAclService } from "./mqtt-acl.service";
import { MqttAclDto } from "./dto";
import { Public } from "../common/public.decorator";

/**
 * EMQX 5.8.3 HTTP-authz callback (PROTOCOL.md §5). NOT user-JWT protected —
 * EMQX presents the shared X-Internal-Secret.
 *
 * EMQX 5.8.3 http-authz contract (v5.8 docs, access-control/authz/http):
 * the RESULT is in the JSON body — `{"result": "allow" | "deny" | "ignore"}`
 * — returned with HTTP 200. Status 204 = allow; any other status (4xx/5xx)
 * makes EMQX IGNORE this source and move to the next one (NOT "deny").
 * The api therefore always answers 200 and decides in the body; `code`/
 * `allow`/`message` are informational only (EMQX never reads them).
 *
 * Request body (from the emqx.conf `body {}` map): clientid, username,
 * topic, action = "publish" | "subscribe" (EMQX 5.8 placeholder values —
 * NOT the 4.x "pub"/"sub").
 */
@Public()
@Controller("mqtt")
export class MqttAclController {
  constructor(private readonly aclService: MqttAclService) {}

  @HttpCode(200)
  @Post("acl")
  async acl(
    @Body() raw: unknown,
    @Headers("x-internal-secret") secret: string | undefined,
  ) {
    console.log("[MQTT ACL RAW]", raw);
    const dto = MqttAclDto.parse(raw);
    const r = await this.aclService.decide({ ...dto, internalSecret: secret });
    console.log("[MQTT ACL RESULT]", r);
    return {
      result: r.allow ? "allow" : "deny",
      code: r.allow ? 0 : 1,
      message: r.reason ?? (r.allow ? "allow" : "deny"),
      allow: r.allow,
    };
  }
}
