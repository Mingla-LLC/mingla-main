// #2290 [ticket buyers never reach a brand's contact book] — TESTER ADVERSARIAL suite.
//
// Independent of the implementor's happy-path suite
// (`issue-2290-brand-person-ingest-cron.test.mjs`, T-1…T-10), which pins the
// INSTANCE by string shape (job name, the `*/5` literal, the vault bearer, no
// literal JWT, unschedule-appears-before-schedule, additive-only) and the CLASS
// by two states of the real repo (green with the migration, red without it).
//
// This suite attacks angles that suite cannot see:
//
//   A-1  ATOMICITY.   T-4 proves only that the unschedule TEXT precedes the
//                     schedule TEXT. It never proves they COMMIT together. The
//                     unschedule-then-schedule idiom is not atomic in the
//                     general case: interpose a COMMIT and a failure of the
//                     schedule half leaves production with NO ingest worker at
//                     all — strictly worse than the bug #2290 fixed, and
//                     invisible to every string assertion in T-1…T-10.
//   A-2  IDEMPOTENCY BY PARSE. T-4's `indexOf("cron.schedule(\n  '<JOB>'")` is
//                     whitespace-exact. This re-derives the same guarantee by
//                     parsing NAMES out of the statement stream, so the
//                     invariant survives reformatting, and asserts it for EVERY
//                     scheduled name rather than one hardcoded one.
//   A-3  REPLAY.      The migration is *claimed* idempotent. Prove it by
//                     replaying the real file twice through the guard's own
//                     schedule/unschedule model: two parsed schedule calls must
//                     collapse to exactly ONE live job pointing at exactly ONE
//                     function. (This is the defect filed as #2297 against
//                     #1770's non-idempotent sibling; #2290 must not share it.)
//   A-4  TOP-LEVEL.   The guard credits a `cron.schedule` that can never
//                     execute — one nested in a dead conditional branch. That
//                     is demonstrated here, and #2290's own schedule is pinned
//                     at statement top level, the only form the model reads
//                     faithfully.
//   A-5  DYNAMIC UNSCHEDULE. `cronReachability` COUNTS but does not APPLY a
//                     non-literal `cron.unschedule(...)`. A future migration
//                     that permanently kills this job that way would leave the
//                     gate green and the worker dark — the exact failure mode
//                     #2290 exists to prevent. Demonstrated, then frozen as a
//                     tripwire on the repo-wide count.
//   A-6  FAIL-CLOSED HALF. The dependency block RAISEs EXCEPTION on a missing
//                     extension but only RAISEs NOTICE on an unseeded vault.
//                     Pin which half is which: downgrading the fatal half would
//                     silently register a job that can never authenticate.
//   A-7  STALE EXEMPTION. Prove an allowlist entry matching nothing FAILS the
//                     gate, so HAND_KICKED cannot quietly widen.
//   A-8  LAUNDERING.  Prove a dark worker whose only invoker is ITSELF dark is
//                     still reported — the negative case for the closure.
//
// Anti-vacuity throughout (#2113): every parse asserts it found something
// before asserting a property of it. A-1…A-4 all fail if the cron.schedule
// block is deleted.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  analyze,
  cronReachability,
  stripSqlComments,
  loadMigrations,
} from "../issue-2290-queue-worker-has-cron-caller.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");
const MIGRATION_FILE =
  "supabase/migrations/20270423002290_issue_2290_brand_person_ingest_cron.sql";
const MIGRATION = path.join(REPO_ROOT, MIGRATION_FILE);

const JOB = "issue_2290_brand_person_ingest_worker";
const FN = "brand-person-ingest-worker";

function migrationSql() {
  assert.ok(
    fs.existsSync(MIGRATION),
    `${MIGRATION_FILE} must exist — without it the ingest worker has no caller`,
  );
  return fs.readFileSync(MIGRATION, "utf8");
}

/** Offsets of every `cron.<verb>(` call and the first single-quoted argument. */
function cronCalls(cleanSql) {
  const out = [];
  for (const m of cleanSql.matchAll(/\bcron\.(schedule|unschedule)\s*\(\s*'([^']*)'/gi)) {
    out.push({ verb: m[1].toLowerCase(), name: m[2], at: m.index });
  }
  return out;
}

/** Spans of every `DO $tag$ … $tag$` block, so nesting can be detected. */
function doBlockSpans(sql) {
  const spans = [];
  for (const m of sql.matchAll(/\bDO\s*(\$[A-Za-z_]*\$)/gi)) {
    const tag = m[1];
    const bodyStart = m.index + m[0].length;
    const end = sql.indexOf(tag, bodyStart);
    if (end !== -1) spans.push([m.index, end + tag.length]);
  }
  return spans;
}

// ── A-1  ATOMICITY ──────────────────────────────────────────────────────────

test("A-1 the unschedule and the schedule COMMIT together — no interposed COMMIT", () => {
  const clean = stripSqlComments(migrationSql());

  const begin = clean.search(/\bBEGIN\s*;/i);
  const commit = clean.search(/\bCOMMIT\s*;/i);
  assert.ok(begin !== -1, "the migration must open an explicit transaction (BEGIN;)");
  assert.ok(commit !== -1, "the migration must close its transaction (COMMIT;)");

  const calls = cronCalls(clean);
  const unsched = calls.find((c) => c.verb === "unschedule" && c.name === JOB);
  const sched = calls.find((c) => c.verb === "schedule" && c.name === JOB);
  assert.ok(unsched, `must cron.unschedule('${JOB}') before rescheduling it`);
  assert.ok(sched, `must cron.schedule('${JOB}') — anti-vacuity for this whole file`);

  // Both halves inside the SAME transaction.
  assert.ok(
    begin < unsched.at && sched.at < commit,
    "both the unschedule and the schedule must sit inside the BEGIN…COMMIT pair",
  );

  // And nothing commits BETWEEN them. If it did, a failure of the schedule half
  // would leave the unschedule durable: production keeps NO ingest worker, the
  // queue silently refills, and every string assertion in T-1…T-10 still passes.
  const between = clean.slice(unsched.at, sched.at);
  assert.doesNotMatch(
    between,
    /\b(COMMIT|END)\s*;/i,
    "no COMMIT/END may separate the unschedule from the schedule — the pair is only " +
      "safe because it is atomic. Splitting it makes a mid-failure leave the job MISSING.",
  );
});

// ── A-2  IDEMPOTENCY, DERIVED BY PARSE ──────────────────────────────────────

test("A-2 every scheduled job name is unscheduled-if-exists first (whitespace-independent)", () => {
  const clean = stripSqlComments(migrationSql());
  const calls = cronCalls(clean);

  const scheduled = calls.filter((c) => c.verb === "schedule");
  assert.ok(scheduled.length > 0, "anti-vacuity: the migration must schedule at least one job");
  assert.deepEqual(
    [...new Set(scheduled.map((c) => c.name))],
    [JOB],
    "this migration may register exactly one job, and it must be the ingest worker's",
  );

  for (const s of scheduled) {
    const guard = calls.find(
      (c) => c.verb === "unschedule" && c.name === s.name && c.at < s.at,
    );
    assert.ok(
      guard,
      `cron.schedule('${s.name}') has no preceding cron.unschedule('${s.name}'). ` +
        "Re-applying the migration could then leave a duplicate job. This is the " +
        "defect filed as #2297 against #1770's export worker; #2290 must not share it.",
    );
  }
});

// ── A-3  REPLAY: APPLY IT TWICE ─────────────────────────────────────────────

test("A-3 replaying the migration twice yields exactly ONE job and ONE target", () => {
  const sql = migrationSql();
  const twice = cronReachability([
    { file: "0001_first_apply.sql", sql },
    { file: "0002_second_apply.sql", sql },
  ]);

  assert.equal(
    twice.scheduleCalls,
    2,
    "anti-vacuity: both replayed copies must actually have been parsed",
  );
  assert.equal(
    twice.jobs.size,
    1,
    "a second apply must not add a second job — that is exactly #2297's defect",
  );
  assert.deepEqual(twice.jobs.get(JOB), [FN], `the one job must still post only to ${FN}`);
  assert.deepEqual([...twice.functions], [FN]);
});

// ── A-4  THE SCHEDULE MUST BE ABLE TO RUN ───────────────────────────────────

test("A-4 the guard credits an unreachable schedule, so #2290's must be top-level", () => {
  // First, the hole: a cron.schedule nested in a branch that provably never
  // executes still satisfies the gate. The model is textual; it does not
  // evaluate plpgsql control flow.
  const deadBranch = cronReachability([
    {
      file: "dead.sql",
      sql:
        `DO $$ BEGIN IF FALSE THEN PERFORM cron.schedule('${JOB}','*/5 * * * *', ` +
        `$c$ SELECT net.http_post(url := 'https://x/functions/v1/${FN}'); $c$); END IF; END $$;`,
    },
  ]);
  assert.equal(
    deadBranch.functions.has(FN),
    true,
    "documents the guard's optimism: a schedule that can never execute is still credited. " +
      "If this ever flips, the model learned control flow and this note can be dropped.",
  );

  // Therefore #2290's own schedule must be a top-level statement, which is the
  // only form the model reads faithfully.
  const sql = migrationSql();
  const clean = stripSqlComments(sql);
  const sched = cronCalls(clean).find((c) => c.verb === "schedule" && c.name === JOB);
  assert.ok(sched, `anti-vacuity: cron.schedule('${JOB}') must be present`);

  const raw = sql.indexOf(`cron.schedule(`);
  assert.ok(raw !== -1, "anti-vacuity: the raw file must contain the schedule call");
  for (const [start, end] of doBlockSpans(sql)) {
    assert.ok(
      raw < start || raw > end,
      "cron.schedule must NOT be nested inside a DO block. Nested in a conditional it " +
        "may never execute, and this gate would still report the worker scheduled.",
    );
  }
});

// ── A-5  DYNAMIC UNSCHEDULE IS A BLIND SPOT — FREEZE IT ─────────────────────

test("A-5 a non-literal cron.unschedule is NOT modelled — frozen as a tripwire", () => {
  const sched =
    `SELECT cron.schedule('${JOB}','*/5 * * * *', ` +
    `$c$ SELECT net.http_post(url := 'https://x/functions/v1/${FN}'); $c$);`;

  // A literal unschedule IS applied — control, proving the model works at all.
  const literal = cronReachability([
    { file: "a.sql", sql: sched },
    { file: "b.sql", sql: `SELECT cron.unschedule('${JOB}');` },
  ]);
  assert.equal(
    literal.functions.has(FN),
    false,
    "a literal unschedule must remove the job from the model",
  );

  // A dynamic one is counted but NOT applied → the worker would be dark in
  // production while this gate stayed green.
  const dynamic = cronReachability([
    { file: "a.sql", sql: sched },
    { file: "b.sql", sql: `SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = '${JOB}';` },
  ]);
  assert.equal(dynamic.dynamicUnschedules, 1, "the dynamic unschedule must at least be COUNTED");
  assert.equal(
    dynamic.functions.has(FN),
    true,
    "documents the blind spot: a dynamic unschedule does not remove the job from the model",
  );

  // So freeze the repo-wide count. Every one today is the
  // unschedule-then-reschedule idiom, where the reschedule restores the entry.
  // A NEW one must force a human to confirm it is not a permanent kill.
  const repo = cronReachability(loadMigrations());
  assert.ok(repo.scheduleCalls > 0, "anti-vacuity: the repo scan must parse real migrations");
  assert.equal(
    repo.dynamicUnschedules,
    5,
    "the number of unmodelled dynamic cron.unschedule calls changed. Each one is a place " +
      "where this gate cannot see a job being removed. Confirm the new call is the " +
      "unschedule-then-reschedule idiom (and not a permanent removal of a live worker) " +
      "before updating this number.",
  );
});

// ── A-6  THE FAIL-CLOSED HALF MUST STAY FAIL-CLOSED ─────────────────────────

test("A-6 missing extensions are FATAL; an unseeded vault is advisory and says so", () => {
  const clean = stripSqlComments(migrationSql());
  const flat = clean.replace(/\s+/g, " ");

  // Fail-closed half: no cron/net/vault namespace => the migration must ABORT.
  assert.match(
    flat,
    /IF to_regnamespace\('cron'\) IS NULL OR to_regnamespace\('net'\) IS NULL OR to_regnamespace\('vault'\) IS NULL THEN RAISE EXCEPTION/,
    "the dependency check must RAISE EXCEPTION. Downgraded to a NOTICE it would register " +
      "a job whose http_post can never resolve, and the migration would report success.",
  );

  // Advisory half: an unseeded vault must NOT abort, but must not be silent either.
  const advisories = [...clean.matchAll(/RAISE NOTICE '([^']*)'/g)].map((m) => m[1]);
  assert.equal(advisories.length, 2, "both vault secrets must have an advisory");
  for (const [secret, text] of [["supabase_url", advisories[0]], ["service_role_key", advisories[1]]]) {
    assert.match(text, new RegExp(secret), `the advisory must name the missing secret ${secret}`);
    assert.match(
      text,
      /will register but its http_post calls will fail/,
      "an advisory that does not state the consequence is a silent failure: the job " +
        "registers, looks healthy, and can never authenticate.",
    );
  }

  // And the fatal half must not have been softened into the advisory half.
  assert.doesNotMatch(
    flat,
    /to_regnamespace\('cron'\)[^;]*RAISE NOTICE/,
    "the extension dependency check must never be advisory-only",
  );
});

// ── A-7  A STALE EXEMPTION FAILS THE GATE ───────────────────────────────────

test("A-7 an allowlist entry that matches no dark worker is itself a failure", () => {
  // The hand-kicked function is absent from this function set, so its exemption
  // matches nothing and must be reported stale.
  const { staleExemptions } = analyze([], [], "");
  assert.deepEqual(
    staleExemptions,
    ["attendance-claim-backfill"],
    "an exemption matching nothing must be reported, so HAND_KICKED cannot quietly widen " +
      "into a list of names nobody re-checks.",
  );
});

// ── A-8  AN UNREACHABLE CALLER CANNOT VOUCH FOR ITS CALLEE ──────────────────

test("A-8 a dark worker invoked only by another dark worker is still reported", () => {
  const machineDoor =
    'const K = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");\n' +
    'if (req.headers.get("authorization") !== `Bearer ${K}`) return new Response("no");\n';

  // Both are machine-only claim workers. `dark-caller` invokes `dark-worker`,
  // but nothing invokes `dark-caller` — so the invocation must buy `dark-worker`
  // nothing.
  const { violations, workers } = analyze(
    [
      { name: "dark-worker", source: machineDoor + 'await sb.rpc("biz_claim_thing");' },
      {
        name: "dark-caller",
        source:
          machineDoor +
          'await sb.rpc("biz_claim_other");\nawait sb.functions.invoke("dark-worker", {});',
      },
    ],
    [],
    "",
  );

  assert.equal(workers.length, 2, "anti-vacuity: both fixtures must register as claim workers");
  assert.deepEqual(
    violations.map((v) => v.name).sort(),
    ["dark-caller", "dark-worker"],
    "reachability is a closure rooted at live cron jobs and human-openable doors. A caller " +
      "that is itself unreachable must NOT launder its callee green — both are dark.",
  );

  // The control: give the caller a human-openable door and the closure DOES
  // credit the callee — so A-8 is discriminating, not merely always-red.
  const openDoor = 'const { data } = await sb.auth.getUser(req.headers.get("authorization"));\n';
  const credited = analyze(
    [
      { name: "dark-worker", source: machineDoor + 'await sb.rpc("biz_claim_thing");' },
      { name: "open-caller", source: openDoor + 'await sb.functions.invoke("dark-worker", {});' },
    ],
    [],
    "",
  );
  assert.deepEqual(
    credited.violations.map((v) => v.name),
    [],
    "a callee invoked by a genuinely reachable caller must be credited",
  );
});
