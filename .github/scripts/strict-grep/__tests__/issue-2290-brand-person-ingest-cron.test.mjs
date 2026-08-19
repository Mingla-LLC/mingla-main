// #2290 [ticket buyers never reach a brand's contact book] — happy-path regression suite.
//
// Two halves, both of which must fail if the fix is reverted:
//
//   INSTANCE  — migration 20270423002290 registers a cron job that posts to
//               /functions/v1/brand-person-ingest-worker, with the vault
//               service-role bearer the worker's own auth check requires.
//   CLASS     — the guard in issue-2290-queue-worker-has-cron-caller.mjs reports
//               brand-person-ingest-worker as cron-scheduled when run against
//               the real repo, and reports it as a VIOLATION the moment the
//               cron.schedule call is removed.
//
// The class half is the one that matters long-term: deleting the schedule from
// the migration must turn CI red, not merely fail an assertion about a string.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyze,
  cronReachability,
  claimRpcs,
  hasMachineOnlyDoor,
  edgeInvocations,
  stripSqlComments,
  HAND_KICKED,
  loadFunctions,
  loadMigrations,
} from "../issue-2290-queue-worker-has-cron-caller.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const MIGRATION = path.join(
  REPO_ROOT,
  "supabase/migrations/20270423002290_issue_2290_brand_person_ingest_cron.sql",
);
const WORKER = path.join(
  REPO_ROOT,
  "supabase/functions/brand-person-ingest-worker/index.ts",
);

const JOB = "issue_2290_brand_person_ingest_worker";
const FN = "brand-person-ingest-worker";

// Read the 223-function tree and the 498-migration directory ONCE. Re-reading
// per test pushed this suite to ~38s inside strict-grep batch A.
const FUNCTIONS = loadFunctions();
const MIGRATIONS = loadMigrations();

// ── INSTANCE ────────────────────────────────────────────────────────────────

test("T-1 the #2290 migration exists and schedules the ingest worker", () => {
  assert.ok(fs.existsSync(MIGRATION), `${MIGRATION} must exist`);
  const { jobs } = cronReachability([
    { file: path.basename(MIGRATION), sql: fs.readFileSync(MIGRATION, "utf8") },
  ]);
  assert.ok(jobs.has(JOB), `migration must cron.schedule a job named ${JOB}`);
  assert.deepEqual(
    jobs.get(JOB),
    [FN],
    `job ${JOB} must post to /functions/v1/${FN} and nothing else`,
  );
});

test("T-2 the interval is */5 — deliberate, not inherited from the export worker", () => {
  const sql = stripSqlComments(fs.readFileSync(MIGRATION, "utf8"));
  assert.match(
    sql.replace(/\s+/g, " "),
    new RegExp(`cron\\.schedule\\(\\s*'${JOB}',\\s*'\\*/5 \\* \\* \\* \\*'`),
    "job name and the */5 literal must be the same cron.schedule call. The sibling " +
      "export worker runs * * * * * because a human waits on a download; ingest has " +
      "no such reader, and */5 is the repo's existing reliable-drain tier.",
  );
});

test("T-3 the invocation carries the vault service-role bearer the worker requires", () => {
  const sql = stripSqlComments(fs.readFileSync(MIGRATION, "utf8"));
  const flat = sql.replace(/\s+/g, " ");
  assert.match(flat, /vault\.decrypted_secrets WHERE name='supabase_url'/);
  assert.match(flat, /'authorization','Bearer '\|\|\(SELECT decrypted_secret FROM vault\.decrypted_secrets WHERE name='service_role_key'/);
  assert.match(flat, /body := '\{\}'::jsonb/);
  // A literal JWT in a migration would be a committed credential.
  assert.doesNotMatch(sql, /eyJ[A-Za-z0-9_-]{10,}/, "must never embed a literal service-role JWT");
});

test("T-4 the migration is idempotent — unschedule-if-exists before schedule", () => {
  const sql = stripSqlComments(fs.readFileSync(MIGRATION, "utf8"));
  const unschedule = sql.indexOf(`cron.unschedule('${JOB}')`);
  const schedule = sql.indexOf(`cron.schedule(\n  '${JOB}'`);
  assert.ok(unschedule !== -1, "must unschedule-if-exists so a re-apply cannot duplicate the job");
  assert.ok(schedule > unschedule, "the unschedule must come BEFORE the schedule");
});

test("T-5 the migration is additive — no DROP/TRUNCATE/DELETE on the outbox", () => {
  const sql = stripSqlComments(fs.readFileSync(MIGRATION, "utf8"));
  for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bALTER\s+TABLE\b/i]) {
    assert.doesNotMatch(sql, forbidden, `scheduler migration must not contain ${forbidden}`);
  }
  // #2290 deliberately ships NO backfill: 0 paid orders lack an outbox row and
  // all 33 pending rows are already due, so the backlog drains itself.
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.brand_person_ingest_outbox/i);
});

test("T-6 the worker itself is untouched and still opens only on a machine bearer", () => {
  const source = fs.readFileSync(WORKER, "utf8");
  assert.ok(hasMachineOnlyDoor(source), "the worker must still gate on the service-role/cron bearer");
  assert.deepEqual(claimRpcs(source), ["biz_claim_brand_person_ingest"]);
});

// ── CLASS ───────────────────────────────────────────────────────────────────

test("T-7 against the real repo, the ingest worker is cron-scheduled and the gate is green", () => {
  const { workers, violations } = analyze(FUNCTIONS, MIGRATIONS, "");

  const worker = workers.find((w) => w.name === FN);
  assert.ok(worker, `${FN} must be recognised as a machine-only claim worker`);
  assert.equal(worker.scheduled, true, `${FN} must be reachable from a live cron job`);
  assert.deepEqual(
    violations.map((v) => v.name),
    [],
    "no machine-only claim worker may be left without a caller",
  );
});

test("T-8 FAILS-ON-REVERT: deleting the cron.schedule makes the gate report the worker dark", () => {
  const migrations = MIGRATIONS.filter((m) => m.file !== path.basename(MIGRATION));
  assert.equal(
    migrations.length,
    MIGRATIONS.length - 1,
    "the #2290 migration must actually have been removed from the fixture set",
  );

  const { violations } = analyze(FUNCTIONS, migrations, "");
  assert.deepEqual(
    violations.map((v) => v.name),
    [FN],
    "with #2290's scheduler removed, the guard MUST name brand-person-ingest-worker. " +
      "If this passes, the guard does not exercise the bug it exists to prevent.",
  );
});

test("T-9 the hand-kicked allowlist stays at exactly one entry", () => {
  assert.deepEqual(
    [...HAND_KICKED.keys()],
    ["attendance-claim-backfill"],
    "the allowlist may only SHRINK. backfill-place-photos and " +
      "backfill-place-photo-thumbs need no entry — neither leases through a claim RPC.",
  );
});

test("T-10 a prose mention of a function name is never counted as a caller", () => {
  assert.deepEqual([...edgeInvocations('// calls functions/v1/ghost-worker somewhere')], []);
  assert.deepEqual([...edgeInvocations('await x.functions.invoke("real-worker", {})')], ["real-worker"]);
});
