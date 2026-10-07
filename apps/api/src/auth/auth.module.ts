import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { MqttAclController } from "./mqtt-acl.controller";
import { AuthService } from "./auth.service";
import { MqttAclService } from "./mqtt-acl.service";

@Module({
  controllers: [AuthController, MqttAclController],
  providers: [AuthService, MqttAclService],
  exports: [AuthService],
})
export class AuthModule {}
