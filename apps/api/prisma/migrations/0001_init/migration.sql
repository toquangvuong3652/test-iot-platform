-- CreateTable (business models — Prisma-managed)
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "quota" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "machine_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "machine_type_id" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "last_seen_at" TIMESTAMP(3),
    "shadow" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "device_credentials" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "rotated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id")
);

-- Telemetry: PARTITIONED BY RANGE (reported_at) FROM DAY 1.
-- Prisma does not emit partition DDL, so this table is created here.
-- Unique on (message_id, reported_at) = idempotency key (QoS1 redelivery).
CREATE TABLE "telemetry" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_pkey" PRIMARY KEY ("id", "reported_at")
) PARTITION BY RANGE ("reported_at");

-- First partition: current month. A pg_cron / monthly job adds the next one.
CREATE TABLE "telemetry_2026_09" PARTITION OF "telemetry"
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

-- CreateTable
CREATE TABLE "alarms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "state" TEXT NOT NULL DEFAULT 'active',
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "alarms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commands" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "ack_payload" JSONB,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acked_at" TIMESTAMP(3),

    CONSTRAINT "commands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "device_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "op" TEXT NOT NULL DEFAULT 'gt',
    "threshold" DOUBLE PRECISION NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warn',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dead_letter" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");
CREATE INDEX "devices_tenant_id_status_idx" ON "devices"("tenant_id", "status");
CREATE INDEX "alarms_tenant_id_state_idx" ON "alarms"("tenant_id", "state");
CREATE INDEX "commands_tenant_id_state_idx" ON "commands"("tenant_id", "state");
CREATE INDEX "device_rules_tenant_id_device_id_idx" ON "device_rules"("tenant_id", "device_id");

-- Idempotency: dedupe on (message_id, reported_at).
CREATE UNIQUE INDEX "telemetry_message_id_reported_at_key"
    ON "telemetry"("message_id", "reported_at");
-- Series query: per device, newest first.
CREATE INDEX "telemetry_tenant_device_reported_idx"
    ON "telemetry"("tenant_id", "device_id", "reported_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_machine_type_id_fkey"
    FOREIGN KEY ("machine_type_id") REFERENCES "machine_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commands" ADD CONSTRAINT "commands_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_rules" ADD CONSTRAINT "device_rules_device_id_fkey"
    FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "devices_tenant_id_id_key" ON "devices"("tenant_id", "id");
CREATE UNIQUE INDEX "device_credentials_username_key" ON "device_credentials"("username");
CREATE UNIQUE INDEX "device_credentials_device_id_key" ON "device_credentials"("device_id");
CREATE UNIQUE INDEX "device_credentials_tenant_id_device_id_key" ON "device_credentials"("tenant_id", "device_id");
