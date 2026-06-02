// ORCH-1032 migration regression test (SQL shape + cron-promotion arithmetic).
//
// Pins the additive-only migration contract (T-12) + the v3 cancelling re-kick
// preservation (T-13) + the cron-promotion arithmetic (T-09/T-10/T-11):
// promote exactly free-slot-count, never over-cap, oldest-first. The
// behavioral half is a pure simulation of the FOR ... LIMIT free_slots loop
// that fails on revert; the source-inspect half guards the SQL itself.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const migrationRaw = await Deno.readTextFile(
  new URL(
    "../20260811000000_orch_1032_queued_status_and_cap.sql",
    import.meta.url,
  ),
);

// Strip SQL line comments (-- …) so prose in the additive-safety / rollback
// reference blocks (which legitimately MENTION "DROP TABLE", "LIMIT 5", etc. to
// explain what the migration does NOT do) never trips a forbidden-literal scan.
// Destructive-statement assertions run against executable SQL only.
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

const MAX_CONCURRENT_RUNS = 4;

// Pure mirror of the cron promotion block (ORCH-1032 S-4):
//   free_slots := 4 - running_count;
//   IF free_slots > 0 THEN
//     FOR q IN SELECT id ... WHERE status='queued' ORDER BY created_at ASC
//              LIMIT free_slots ... promote each to running
type QueuedRun = { id: string; createdAt: number };
function promote(
  runningCount: number,
  queued: QueuedRun[],
): { promoted: string[]; remainingQueued: number } {
  const freeSlots = MAX_CONCURRENT_RUNS - runningCount;
  if (freeSlots <= 0) return { promoted: [], remainingQueued: queued.length };
  const oldestFirst = [...queued].sort((a, b) => a.createdAt - b.createdAt);
  const promoted = oldestFirst.slice(0, freeSlots).map((q) => q.id);
  return { promoted, remainingQueued: queued.length - promoted.length };
}

// ── T-09: promote exactly free-slot count, no more ──────────────────────────
Deno.test("T-09 running=2, 5 queued → promote exactly 2, 3 stay queued", () => {
  const queued: QueuedRun[] = [
    { id: "q0", createdAt: 0 },
    { id: "q1", createdAt: 1 },
    { id: "q2", createdAt: 2 },
    { id: "q3", createdAt: 3 },
    { id: "q4", createdAt: 4 },
  ];
  const r = promote(2, queued);
  assertEquals(r.promoted.length, 2); // free_slots = 4 - 2
  assertEquals(r.remainingQueued, 3);
  assertEquals(r.promoted, ["q0", "q1"]); // oldest first
});

// ── T-10: over-cap guard — zero promotions when no free slot ─────────────────
Deno.test("T-10 running=4, 3 queued → free_slots=0 → zero promotions", () => {
  const queued: QueuedRun[] = [
    { id: "a", createdAt: 0 },
    { id: "b", createdAt: 1 },
    { id: "c", createdAt: 2 },
  ];
  const r = promote(4, queued);
  assertEquals(r.promoted.length, 0);
  assertEquals(r.remainingQueued, 3);
});

Deno.test("T-10b running=5 (legacy over-cap) → free_slots<0 → zero promotions", () => {
  const r = promote(5, [{ id: "x", createdAt: 0 }]);
  assertEquals(r.promoted.length, 0);
});

// ── T-11: oldest-first promotion with 1 free slot ───────────────────────────
Deno.test("T-11 t0<t1<t2, 1 free slot → t0 promoted", () => {
  const queued: QueuedRun[] = [
    { id: "t2", createdAt: 200 },
    { id: "t0", createdAt: 0 }, // intentionally out of insertion order
    { id: "t1", createdAt: 100 },
  ];
  const r = promote(3, queued); // free_slots = 1
  assertEquals(r.promoted, ["t0"]);
});

// ── T-11 (source): ORDER BY created_at ASC + LIMIT free_slots present ────────
Deno.test("T-11 source: promotion query is oldest-first, LIMIT free_slots, SKIP LOCKED", () => {
  assert(
    /WHERE\s+status\s*=\s*'queued'[\s\S]*ORDER BY\s+created_at\s+ASC/i.test(
      migration,
    ),
    "promotion select must filter status='queued' ORDER BY created_at ASC",
  );
  assert(
    /LIMIT\s+free_slots/i.test(migration),
    "promotion select must LIMIT free_slots",
  );
  assert(
    /FOR UPDATE SKIP LOCKED/i.test(migration),
    "promotion select must use FOR UPDATE SKIP LOCKED (concurrent-tick safety)",
  );
  assert(
    /IF\s+free_slots\s*>\s*0\s+THEN/i.test(migration),
    "promotion must be guarded by IF free_slots > 0",
  );
  assert(
    /SET\s+status\s*=\s*'running',\s*started_at\s*=\s*now\(\)/i.test(migration),
    "promotion must stamp status='running' + started_at=now()",
  );
});

// ── T-12: migration is additive / safe ──────────────────────────────────────
Deno.test("T-12 migration is additive-only (no rewrite)", () => {
  // widened CHECK admits 'queued' in the 7-value set
  assert(
    /DROP CONSTRAINT IF EXISTS place_intelligence_runs_status_check/.test(
      migration,
    ),
    "must DROP CONSTRAINT IF EXISTS the status check",
  );
  assert(
    /ADD CONSTRAINT place_intelligence_runs_status_check[\s\S]*CHECK\s*\(status IN \([^)]*'queued'[^)]*\)\)/
      .test(migration),
    "must ADD the status CHECK including 'queued'",
  );
  // widened unique index WHERE clause
  assert(
    /WHERE status IN \('pending','queued','running','cancelling'\)/.test(
      migration,
    ),
    "unique index WHERE must include 'queued'",
  );
  // NOT destructive
  assert(!/DROP TABLE/i.test(migration), "must NOT DROP TABLE");
  assert(
    !/ALTER COLUMN[\s\S]*TYPE/i.test(migration),
    "must NOT change a column TYPE",
  );
  assert(!/SET NOT NULL/i.test(migration), "must NOT add SET NOT NULL");
});

// ── T-13: v3 cancelling re-kick preserved (INV-P4) ──────────────────────────
Deno.test("T-13 v3 cancelling re-kick preserved verbatim", () => {
  assert(
    /status IN \('running', 'cancelling'\)/.test(migration),
    "stale-heartbeat re-kick must still filter status IN ('running','cancelling')",
  );
  assert(
    /last_heartbeat_at\s*<\s*now\(\)\s*-\s*interval '90 seconds'/.test(
      migration,
    ),
    "stale-heartbeat 90s window must be preserved",
  );
  // SECURITY DEFINER + vault secret read preserved (HG-6)
  assert(/SECURITY DEFINER/.test(migration), "function must stay SECURITY DEFINER");
  assert(
    /vault\.decrypted_secrets/.test(migration),
    "must read service_role_key from vault.decrypted_secrets",
  );
  // no service-key literal (HG-6)
  assert(
    !/Bearer\s+eyJ/.test(migration),
    "must NOT embed a literal service-role JWT",
  );
});
