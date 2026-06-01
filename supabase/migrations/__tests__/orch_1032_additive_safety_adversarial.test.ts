// ORCH-1032 TESTER-AUTHORED adversarial regression test.
//
// Angle: DIFFERENT from the implementor's concurrencyCap_adversarial.test.ts
// (which attacks the cap+1 short-circuit + cross-file cap-literal match) and
// from orch_1032_cron_promotion.test.ts (which attacks the promotion
// arithmetic). This file attacks TWO surfaces the implementor only SOURCE-GREPPED
// but never EVALUATED AS LOGIC:
//
//   (A) The migration's additive-safety invariant as executable predicate logic:
//       - every one of the 7 status values satisfies the widened CHECK, and
//         every value OUTSIDE the set is rejected (the implementor only grep'd
//         for the literal string "'queued'" in the CHECK — it never proved the
//         predicate actually admits all 7 and rejects an 8th);
//       - the widened per-city unique index admits at most ONE active row per
//         city across {pending,queued,running,cancelling} — so a queued+running
//         pair for the SAME city is rejected, while a queued row for one city +
//         running row for ANOTHER city coexist; AND a terminal row
//         (complete/cancelled/failed) never blocks a new active row for the same
//         city (it is outside the partial-index WHERE).
//
//   (B) The gate's count-query correctness when cancelling/queued rows coexist:
//       the gate counts status = 'running' ONLY. If a future edit widened the
//       count to include 'queued' or 'cancelling', the cap would be reached too
//       early (a city's own cancelling/queued rows would over-park new runs).
//       This re-derives the count predicate from index.ts source and proves it
//       counts running-only against a mixed population — the symmetric failure
//       to over-promotion that the implementor never covered.
//
// Both predicate simulators are parsed/derived from the REAL artifacts (the
// migration SQL + index.ts) so a revert that changes the executable semantics
// — not just deletes a grepped string — fails this test.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_PATH = new URL(
  "../20260811000000_orch_1032_queued_status_and_cap.sql",
  import.meta.url,
);
const INDEX_PATH = new URL(
  "../../functions/run-place-intelligence-trial/index.ts",
  import.meta.url,
);

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

const migRaw = await Deno.readTextFile(MIGRATION_PATH);
const mig = stripSqlComments(migRaw);
const idxSrc = await Deno.readTextFile(INDEX_PATH);

// ── Parse the CHECK status set straight out of the migration SQL ─────────────
// We extract the IN-list from the ADD CONSTRAINT ... CHECK (status IN ( ... ))
// so the test tracks whatever the migration actually declares (a revert to the
// 6-value set is caught because 'queued' disappears from the parsed set).
function parseCheckStatusSet(sql: string): string[] {
  const m = sql.match(
    /ADD CONSTRAINT place_intelligence_runs_status_check\s*CHECK\s*\(\s*status IN \(([^)]*)\)\s*\)/i,
  );
  assert(m, "could not locate ADD CONSTRAINT ... CHECK (status IN (...))");
  return m![1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter((s) => s.length > 0);
}

// ── Parse the unique-index partial WHERE set out of the migration SQL ────────
function parseIndexActiveSet(sql: string): string[] {
  // Grab the CREATE UNIQUE INDEX ... WHERE status IN (...) for the per-city idx.
  const after = sql.slice(sql.indexOf("CREATE UNIQUE INDEX uniq_one_running_run_per_city"));
  const m = after.match(/WHERE status IN \(([^)]*)\)/i);
  assert(m, "could not locate the unique index partial WHERE status IN (...)");
  return m![1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter((s) => s.length > 0);
}

const CHECK_SET = parseCheckStatusSet(mig);
const ACTIVE_SET = parseIndexActiveSet(mig);

// ─────────────────────────────────────────────────────────────────────────
// (A1) CHECK admits ALL 7, rejects an 8th — predicate evaluated, not grepped
// ─────────────────────────────────────────────────────────────────────────
Deno.test("A1 widened CHECK admits exactly the 7 status values and rejects any other", () => {
  const EXPECTED_7 = [
    "pending",
    "queued",
    "running",
    "cancelling",
    "cancelled",
    "complete",
    "failed",
  ].sort();
  assertEquals(
    [...CHECK_SET].sort(),
    EXPECTED_7,
    "CHECK must admit exactly the 7-value set including 'queued'",
  );
  // Simulate the CHECK predicate (status IN CHECK_SET) against every value:
  const passesCheck = (status: string) => CHECK_SET.includes(status);
  for (const s of EXPECTED_7) {
    assert(passesCheck(s), `'${s}' must satisfy the CHECK`);
  }
  // an 8th, never-valid value must be rejected
  for (const bogus of ["paused", "queued ", "QUEUED", "", "draft"]) {
    assert(!passesCheck(bogus), `'${bogus}' must be REJECTED by the CHECK`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// (A2) Unique partial index: at-most-one active row per city across the
// 4-value active set; a queued+running pair for the SAME city is rejected;
// terminal rows never block a new active row.
// ─────────────────────────────────────────────────────────────────────────
// Simulate the unique partial index: it indexes (city_id) only for rows whose
// status is in ACTIVE_SET. A unique violation occurs iff two indexed rows share
// a city_id.
type Row = { city_id: string; status: string };
function indexAcceptsAll(rows: Row[]): boolean {
  const seen = new Set<string>();
  for (const r of rows) {
    if (!ACTIVE_SET.includes(r.status)) continue; // not in the partial index
    if (seen.has(r.city_id)) return false; // unique violation (23505)
    seen.add(r.city_id);
  }
  return true;
}

Deno.test("A2 active-set is exactly {pending,queued,running,cancelling} (queued is counted active)", () => {
  assertEquals(
    [...ACTIVE_SET].sort(),
    ["cancelling", "pending", "queued", "running"].sort(),
    "the unique partial index WHERE must cover the 4 active states incl. 'queued'",
  );
});

Deno.test("A2 a queued + running pair for the SAME city is rejected by the unique index", () => {
  // This is the new guarantee ORCH-1032 adds: a city already running cannot
  // ALSO have a queued run (the 23505 -> 409 concurrent_run guard now fires).
  assertEquals(
    indexAcceptsAll([
      { city_id: "london", status: "running" },
      { city_id: "london", status: "queued" },
    ]),
    false,
    "same-city running+queued must collide on the widened unique index",
  );
  // and two queued rows for one city likewise collide
  assertEquals(
    indexAcceptsAll([
      { city_id: "london", status: "queued" },
      { city_id: "london", status: "queued" },
    ]),
    false,
    "two queued rows for the same city must collide",
  );
});

Deno.test("A2 a queued run for one city coexists with a running run for ANOTHER city", () => {
  assertEquals(
    indexAcceptsAll([
      { city_id: "london", status: "queued" },
      { city_id: "lagos", status: "running" },
      { city_id: "durham", status: "cancelling" },
      { city_id: "brussels", status: "pending" },
    ]),
    true,
    "distinct cities in the active set must all coexist (this is the at-capacity queue scenario)",
  );
});

Deno.test("A2 a terminal row never blocks a NEW active row for the same city", () => {
  // complete/cancelled/failed are OUTSIDE the partial index, so re-running a
  // city that previously finished must be allowed.
  assertEquals(
    indexAcceptsAll([
      { city_id: "london", status: "complete" },
      { city_id: "london", status: "cancelled" },
      { city_id: "london", status: "failed" },
      { city_id: "london", status: "queued" }, // the new active run
    ]),
    true,
    "terminal rows must not occupy the per-city active slot",
  );
});

// ─────────────────────────────────────────────────────────────────────────
// (B) Gate count-query correctness: counts status='running' ONLY. Coexisting
// queued / cancelling rows must NOT inflate the count (else over-parking).
// ─────────────────────────────────────────────────────────────────────────
// Derive the counted status set from the REAL index.ts gate source so a revert
// that widens the .eq("status","running") to .in([...]) is caught.
function parseGateCountedStatuses(src: string): string[] {
  // Locate the gate count query block (the select with count:"exact",head:true
  // immediately preceding `const atCapacity =`).
  const gateIdx = src.indexOf("const atCapacity =");
  assert(gateIdx > 0, "index.ts must compute atCapacity");
  // Look back a bounded window for the status filter feeding runningCount.
  const window = src.slice(Math.max(0, gateIdx - 600), gateIdx);
  const eqMatch = window.match(/\.eq\(\s*"status"\s*,\s*"([^"]+)"\s*\)/);
  if (eqMatch) return [eqMatch[1]];
  // If a future edit used .in(...) instead, parse the array so the test can
  // FAIL loudly (the gate must count running-only).
  const inMatch = window.match(/\.in\(\s*"status"\s*,\s*\[([^\]]*)\]\s*\)/);
  if (inMatch) {
    return inMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter((s) => s.length > 0);
  }
  throw new Error("could not locate the gate's status count filter in index.ts");
}

Deno.test("B the concurrency gate counts status='running' ONLY (not queued/cancelling)", () => {
  const counted = parseGateCountedStatuses(idxSrc);
  assertEquals(
    counted,
    ["running"],
    "the cap gate must count ONLY 'running' — counting queued/cancelling would over-park new runs",
  );
});

Deno.test("B mixed population: only running rows count toward the cap", () => {
  // Simulate the count predicate against a realistic mixed population. The cap
  // gate's `runningCount` must equal the number of 'running' rows regardless of
  // how many queued/cancelling/terminal rows coexist.
  const counted = new Set(parseGateCountedStatuses(idxSrc));
  const population: Row[] = [
    { city_id: "a", status: "running" },
    { city_id: "b", status: "running" },
    { city_id: "c", status: "running" },
    { city_id: "d", status: "cancelling" }, // finishing — must NOT count
    { city_id: "e", status: "queued" }, // parked — must NOT count
    { city_id: "f", status: "queued" },
    { city_id: "g", status: "complete" }, // terminal — must NOT count
    { city_id: "h", status: "pending" }, // not running — must NOT count
  ];
  const runningCount = population.filter((r) => counted.has(r.status)).length;
  const MAX = 4;
  assertEquals(runningCount, 3, "only the 3 running rows count");
  // With 3 running and the cap at 4, a NEW run must still START (not queue),
  // even though 2 queued + 1 cancelling + others coexist. This is the exact
  // over-parking bug a widened count would introduce.
  assertEquals(
    runningCount >= MAX,
    false,
    "atCapacity must be FALSE here — coexisting queued/cancelling rows must not push the gate to capacity",
  );
});
