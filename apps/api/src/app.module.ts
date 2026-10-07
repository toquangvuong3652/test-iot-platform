import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import * as path from "node:path";
import { validateEnv } from "./config/env";

import { PrismaModule } from "./prisma/prisma.module";
import { MqttModule } from "./mqtt/mqtt.module";
import { HealthController } from "./health/health.controller";
import { JwtAuthGuard } from "./common/jwt-auth.guard";
import { RolesGuard } from "./common/roles.guard";
import { AllExceptionsFilter } from "./common/app-exception.filter";

import { AuthModule } from "./auth/auth.module";
import { CustomerModule } from "./customer/customer.module";
import { UserModule } from "./user/user.module";
import { MachineTypeModule } from "./machine-type/machine-type.module";
import { DeviceModule } from "./device/device.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { AlarmModule } from "./alarm/alarm.module";
import { CommandModule } from "./command/command.module";
import { DashboardModule } from "./dashboard/dashboard.module";

@Module({
  imports: [
    // Validate .env once at boot; throw on missing/invalid config.
    // .env next to the app first, repo-root .env as fallback (works from
    // both `npm run dev:api` (cwd=apps/api) and running from the root).
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [".env", path.resolve(__dirname, "../../../.env")],
    }),
    PrismaModule,
    MqttModule,
    AuthModule,
    CustomerModule,
    UserModule,
    MachineTypeModule,
    DeviceModule,
    TelemetryModule,
    AlarmModule,
    CommandModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global, in this order: JWT first (sets req.user), then RBAC.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
