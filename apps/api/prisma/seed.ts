/**
 * Dev seed — idempotent (upserts on natural keys).
 * Creates: demo tenant + admin/member/viewer users, a machine type,
 * two devices with credentials (tokens printed ONCE to stdout).
 *
 *   npm run seed -w @iot/api
 */
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import * as crypto from "node:crypto";

const prisma = new PrismaClient();

const TENANT = { id: "00000000-0000-4000-8000-000000000001", name: "Acme Manufacturing", plan: "free", quota: 50 };
const MT = { id: "00000000-0000-4000-8000-000000000010", name: "Hearth Furnace", spec: { metrics: ["temperature", "pressure", "current"], setpoint: "temperature" } };
const U_ADMIN = { id: "00000000-0000-4000-8000-000000000021", email: "admin@acme.test", role: "admin" };
const U_MEMBER = { id: "00000000-0000-4000-8000-000000000022", email: "member@acme.test", role: "member" };
const U_VIEWER = { id: "00000000-0000-4000-8000-000000000023", email: "viewer@acme.test", role: "viewer" };
const DEV1 = { id: "00000000-0000-4000-8000-000000000031", name: "furnace-01" };
const DEV2 = { id: "00000000-0000-4000-8000-000000000032", name: "furnace-02" };
const RULE1 = { id: "00000000-0000-4000-8000-000000000041" };

async function main() {
  await prisma.tenant.upsert({
    where: { id: TENANT.id },
    update: {},
    create: TENANT,
  });

  const hash = await bcrypt.hash("password123", 10);
  for (const u of [U_ADMIN, U_MEMBER, U_VIEWER]) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, tenantId: TENANT.id, passwordHash: hash },
    });
  }

  await prisma.machineType.upsert({
    where: { id: MT.id },
    update: {},
    create: MT,
  });

  for (const d of [DEV1, DEV2]) {
    await prisma.device.upsert({
      where: { id: d.id },
      update: {},
      create: { ...d, tenantId: TENANT.id, machineTypeId: MT.id },
    });
    const token = crypto.randomBytes(32).toString("hex");
    const username = `${TENANT.id}:${d.id}`;
    await prisma.deviceCredential.upsert({
      where: { username },
      update: {},
      create: {
        tenantId: TENANT.id,
        deviceId: d.id,
        username,
        tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
      },
    });
    console.log(`  ${d.name}: username=${username}\n            token=${token}  (shown once)`);
  }

  await prisma.deviceRule.upsert({
    where: { id: RULE1.id },
    update: {},
    create: {
      ...RULE1,
      tenantId: TENANT.id,
      deviceId: DEV1.id,
      name: "overheat",
      metric: "temperature",
      op: "gt",
      threshold: 40,
      severity: "critical",
      enabled: true,
    },
  });

  console.log(`Seeded tenant ${TENANT.name} with users admin@acme.test / member@acme.test / viewer@acme.test (password123)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
