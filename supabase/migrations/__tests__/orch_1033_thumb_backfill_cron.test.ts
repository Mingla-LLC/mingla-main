// ORCH-1033 migration regression test (TESTER adversarial — SQL shape).
//
// Read-only assertions against the parsed migration SQL. The tester does NOT
// apply migrations (Discipline Rule 13). This locks the auto-drain contract so a
// future "tidy-up" cannot silently drop the cron, weaken the SECURITY DEFINER
// boundary, turn the silent vault-skip into a hard failure, or sneak a
// destructive statement into what must stay additive-only.
//
// Adversarial angle vs the implementor's happy-path: this attacks the FAILURE
// and SAFETY edges of the migration — (a) the missing-vault path must NOTICE +
// RETURN (skip the tick), NEVER RAISE EXCEPTION; (b) the migration must be
// additive (no DROP TABLE / no column TYPE change / no SET NOT NULL on existing
// data); (c) the kicker must never embed a literal service-role JWT.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationRaw = await Deno.readTextFile(
  new URL(
    "../20260815000000_orch_1033_thumb_backfill_cron.sql",
    import.meta.url,
  ),
);

// Strip SQL line comments (-- …) so prose in the docs/rollback reference blocks
// (which legitimately MENTION "DROP FUNCTION", "*/10", etc. to explain or roll
// back) never trips an executable-statement scan. Structural assertions run
// against executable SQL only; schedule-literal/comment assertions use the raw.
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}
const migration = stripSqlComments(migrationRaw);

// ── T-MIG-1: cron registration at exactly */10 * * * * ──────────────────────
Deno.test("T-MIG-1 schedules kick_pending_thumb_backfill every 10 minutes", () => {
  // cron.schedule('kick_pending_thumb_backfill', '*/10 * * * *', ...)
  assert(
    /cron\.schedule\(\s*'kick_pending_thumb_backfill'/i.test(migration),
    "must cron.schedule a job named kick_pending_thumb_backfill",
  );
  assert(
    /'\*\/10 \* \* \* \*'/.test(migration),
    "schedule literal must be exactly '*/10 * * * *' (every 10 minutes)",
  );
  // Belt + suspenders: the job name and the */10 literal appear in the same
  // executable schedule call, not split across unrelated statements.
  assert(
    /cron\.schedule\(\s*'kick_pending_thumb_backfill',\s*'\*\/10 \* \* \* \*'/i
      .test(migration.replace(/\s+/g, " ")),
    "job name and */10 schedule must be the same cron.schedule call",
  );
  // Unschedule-if-exists guard (idempotent re-apply).
  assert(
    /cron\.unschedule\(/i.test(migration),
    "must guard with cron.unschedule(...) before re-scheduling (idempotent re-apply)",
  );
});

// ── T-MIG-2: kicker is SECURITY DEFINER over vault, no literal JWT ──────────
Deno.test("T-MIG-2 kicker fn is SECURITY DEFINER reading the vault service_role_key", () => {
  assert(
    /CREATE OR REPLACE FUNCTION public\.tg_kick_pending_thumb_backfill\(\)/i
      .test(migration),
    "must define public.tg_kick_pending_thumb_backfill()",
  );
  assert(
    /tg_kick_pending_thumb_backfill[\s\S]*SECURITY DEFINER/i.test(migration),
    "kicker function must be SECURITY DEFINER",
  );
  assert(
    /vault\.decrypted_secrets/i.test(migration),
    "kicker must read service_role_key from vault.decrypted_secrets",
  );
  assert(
    /WHERE\s+name\s*=\s*'service_role_key'/i.test(migration),
    "kicker must select the 'service_role_key' vault secret by name",
  );
  // HARD: never embed a literal service-role JWT in the migration.
  assert(
    !/Bearer\s+eyJ/.test(migrationRaw),
    "must NOT embed a literal service-role JWT (use the vault secret)",
  );
});

// ── T-MIG-3 (adversarial): missing vault secret → silent skip, NOT exception ─
Deno.test("T-MIG-3 missing service_role_key skips the tick silently (NOTICE + RETURN, no EXCEPTION)", () => {
  // The skip branch must check the fetched key for NULL, RAISE NOTICE, and RETURN.
  assert(
    /IF\s+service_key\s+IS\s+NULL\s+THEN/i.test(migration),
    "must branch on service_key IS NULL",
  );
  // Within the kicker, the missing-secret handling is a NOTICE, not an EXCEPTION.
  const kickerBody = migration.slice(
    migration.search(/CREATE OR REPLACE FUNCTION public\.tg_kick_pending_thumb_backfill/i),
  );
  assert(
    /service_key\s+IS\s+NULL\s+THEN[\s\S]*?RAISE NOTICE[\s\S]*?RETURN;/i.test(kickerBody),
    "the IS NULL branch must RAISE NOTICE then RETURN (skip the tick)",
  );
  // The kicker function body must NOT raise an exception on the missing-secret path.
  // (A pre-flight DO block may RAISE EXCEPTION only for the hard pg_cron dependency.)
  const kickerOnly = kickerBody.slice(0, kickerBody.search(/\$\$;/));
  assert(
    !/RAISE EXCEPTION/i.test(kickerOnly),
    "the kicker function must NOT RAISE EXCEPTION (missing vault/pg_net is a silent skip)",
  );
  // pg_net missing is a NOTICE in the pre-flight, not a hard failure.
  assert(
    /pg_net[\s\S]*RAISE NOTICE/i.test(migrationRaw) ||
      /RAISE NOTICE[\s\S]*pg_net/i.test(migrationRaw),
    "missing pg_net must be a NOTICE (kicker degrades gracefully), not a hard EXCEPTION",
  );
});

// ── T-MIG-4 (adversarial): additive-only — safe to apply with data present ───
Deno.test("T-MIG-4 migration is additive-only (no destructive ops on existing data)", () => {
  // The new heartbeat column is added IF NOT EXISTS (re-appliable).
  assert(
    /ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz/i.test(migration),
    "must add last_heartbeat_at via ADD COLUMN IF NOT EXISTS",
  );
  // NOT destructive against existing tables/columns.
  assert(!/DROP TABLE/i.test(migration), "must NOT DROP TABLE");
  assert(
    !/ALTER COLUMN[\s\S]*?TYPE/i.test(migration),
    "must NOT change an existing column TYPE",
  );
  assert(
    !/SET NOT NULL/i.test(migration),
    "must NOT add SET NOT NULL to an existing column (would fail on legacy rows)",
  );
  assert(
    !/TRUNCATE/i.test(migration),
    "must NOT TRUNCATE",
  );
  // The only data UPDATE is the scoped one-time cleanup of stale browser-era
  // thumbs runs — it must be confined to the synthetic discriminator + the
  // non-terminal paused/ready states (never touches real Photos runs).
  assert(
    /UPDATE public\.photo_backfill_runs[\s\S]*?city\s*=\s*'ORCH-0957 place-photo thumbs'[\s\S]*?status IN \('paused', 'ready'\)/i
      .test(migration),
    "the one-time cleanup UPDATE must be scoped to the thumbs discriminator + paused/ready only",
  );
});

// ── T-MIG-5: kicker drives the server engine via the two service-role actions ─
Deno.test("T-MIG-5 kicker POSTs ensure_auto_run and process_chunk to the edge fn", () => {
  assert(
    /net\.http_post\(/i.test(migration),
    "kicker must use net.http_post to reach the edge function",
  );
  assert(
    /backfill-place-photo-thumbs/.test(migration),
    "kicker must target the backfill-place-photo-thumbs edge function",
  );
  assert(
    /'action',\s*'ensure_auto_run'/i.test(migration),
    "kicker must POST the ensure_auto_run action (create+drive a run on backlog)",
  );
  assert(
    /'action',\s*'process_chunk'/i.test(migration),
    "kicker must POST process_chunk for stale-heartbeat recovery",
  );
  // Stale-heartbeat recovery keys off status='running' + a heartbeat cutoff.
  assert(
    /status\s*=\s*'running'[\s\S]*?last_heartbeat_at\s+IS\s+NULL\s+OR\s+last_heartbeat_at\s*<\s*now\(\)\s*-\s*interval '5 minutes'/i
      .test(migration),
    "stale-heartbeat re-kick must select running runs with NULL or >5min heartbeat",
  );
});
