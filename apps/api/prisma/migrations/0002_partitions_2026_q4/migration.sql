-- Telemetry partitions for the next 3 months (0001_init only covered 2026-09).
-- A recurring job (pg_cron in prod, or a monthly ops step in Phase 1) keeps
-- adding these — see README "Telemetry partitions". A DEFAULT partition is
-- intentionally NOT used: it would silently defeat partition pruning.
CREATE TABLE "telemetry_2026_10" PARTITION OF "telemetry"
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "telemetry_2026_11" PARTITION OF "telemetry"
    FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "telemetry_2026_12" PARTITION OF "telemetry"
    FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
