import { Global, Module } from "@nestjs/common";
import { MqttPublisherService } from "./mqtt-publisher.service";

@Global()
@Module({
  providers: [MqttPublisherService],
  exports: [MqttPublisherService],
})
export class MqttModule {}
