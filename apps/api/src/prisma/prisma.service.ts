import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Models that MUST be tenant-scoped. Queries to these go through
 * `PrismaService.scoped(tenantId)`, which injects `tenantId` into every
 * read/write — you cannot accidentally read another tenant's rows.
 * (Spec §5: Prisma tenant filter is MANDATORY; PostgreSQL RLS is Phase 2.)
 */
const TENANT_MODELS = new Set([
  "user",
  "device",
  "telemetry",
  "alarm",
  "command",
  "deviceRule",
]);
// NOTE: `machineType` is a GLOBAL catalog (no tenant_id column) — it must
// stay out of this set. `tenant`, `deviceCredential`, `deadLetter` are
// intentionally direct-access too.

type AnyDelegate = { [op: string]: any };

/**
 * Ops whose `where` is a FULL filter (any field combination) — tenantId can
 * be merged in directly. `create`/`createMany` are deliberately excluded:
 * tenantId goes in `data`, not `where`, and Prisma rejects a `where` there.
 */
const FILTER_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
  "findRaw",
]);

/**
 * Ops whose `where` must be a UNIQUE input. `tenantId` is NOT a unique field
 * on most models (users.id, alarms.id, commands.id, device_rules.id), so
 * naively injecting it into `where` makes Prisma throw
 * "Unknown arg tenantId" at runtime. Handled specially below:
 *
 *  - findUnique(OrThrow) -> run as findFirst(OrThrow) with tenantId in the
 *    where (identical result for a unique key, but full-filter input).
 *  - update / delete     -> tenant check via findFirst first; if the row is
 *    not in this tenant, throw P2025 (Prisma's own "record not found"),
 *    otherwise run the real op with the ORIGINAL args.
 *  - upsert              -> tenant check via findFirst, then the real
 *    update (row exists) or create (it doesn't).
 *
 * tenantId is immutable on these models (no endpoint reassigns it), so the
 * check-then-write sequence has no TOCTOU hazard.
 */
const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);

const PRISMA_CLIENT_VERSION = "5.22.0";

function notFound(op: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `No record found for tenant-scoped ${op}`,
    { code: "P2025", clientVersion: PRISMA_CLIENT_VERSION, meta: {} },
  );
}

/**
 * A Proxy over the PrismaClient. For tenant models, every delegate method is
 * wrapped so `tenantId` is enforced before the query hits PostgreSQL.
 * Non-tenant models (tenant, deviceCredential, deadLetter, $transaction,
 * $queryRaw, ...) pass straight through to the real client.
 */
export function scopedClient(client: PrismaClient, tenantId: string): PrismaClient {
  return new Proxy(client, {
    get(target, prop) {
      if (typeof prop !== "string" || !TENANT_MODELS.has(prop)) {
        return Reflect.get(target, prop);
      }
      const delegate = Reflect.get(target, prop) as AnyDelegate;
      if (typeof delegate !== "object" || delegate === null) return delegate;
      return new Proxy(delegate, {
        get(d, opName) {
          const op = String(opName);
          const fn = Reflect.get(d, opName);
          if (typeof fn !== "function") return fn;

          if (FILTER_OPS.has(op)) {
            return (args?: any) => {
              const a = args ?? {};
              return fn.call(delegate, { ...a, where: { tenantId, ...(a.where ?? {}) } });
            };
          }

          if (op === "findUnique" || op === "findUniqueOrThrow") {
            const firstFn = delegate[op === "findUnique" ? "findFirst" : "findFirstOrThrow"];
            return (args?: any) => {
              const a = args ?? {};
              return firstFn.call(delegate, {
                ...a,
                where: { tenantId, ...(a.where ?? {}) },
              });
            };
          }

          if (UNIQUE_WHERE_OPS.has(op)) {
            return async (args?: any) => {
              const a = args ?? {};
              const row = await delegate.findFirst({
                where: { tenantId, ...(a.where ?? {}) },
              });
              if (!row) {
                if (op === "upsert") return delegate.create({ data: a.create });
                throw notFound(op);
              }
              if (op === "upsert") {
                return delegate.update({ where: a.where, data: a.update });
              }
              return fn.call(delegate, a);
            };
          }

          // create / createMany / executeRaw / ... — pass through untouched
          // (tenantId must be present in `data`, which services always set).
          return (...args: any[]) => fn.call(delegate, ...args);
        },
      });
    },
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    this.logger.log("Prisma connected");
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Tenant-bound client. ALWAYS use this for tenant models (user, device,
   * telemetry, alarm, command, deviceRule, machineType). It enforces
   * `tenantId` on every query. For `tenant`, `deviceCredential` and
   * `deadLetter` (no tenant scoping needed / different identity) use `this`.
   */
  scoped(tenantId: string): PrismaClient {
    return scopedClient(this, tenantId);
  }
}
