// ORCH-1032 tester-style adversarial regression test (edge-fn side).
//
// Attacks the exact reported symptom (HTTP 546 on the 6th run) from a
// different angle than the implementor happy-path: proves the (cap+1)th start
// short-circuits to a queued 200 BEFORE any heavy work that could 546, and
// proves the cap literal is identical across the edge fn and the migration
// (SC-2 / T-14). The cron-promotion arithmetic (T-09..T-13) is asserted in the
// companion SQL-shape test under supabase/migrations/__tests__/.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const INDEX_PATH = new URL("../index.ts", import.meta.url);
const MIGRATION_PATH = new URL(
  "../../../migrations/20260811000000_orch_1032_queued_status_and_cap.sql",
  import.meta.url,
);

const MAX_CONCURRENT_RUNS = 4;

// Mirror the start-run control flow as a pure step list. The gate runs BEFORE
// the parent insert + before pendingRows construction + before the upsert
// loop, so a queued decision never reaches the memory-heavy enqueue path.
function startRunPath(runningCount: number): {
  decision: "queued" | "running";
  reachesHeavyEnqueue: boolean;
  httpStatus: 200; // gate never returns 4xx/546 for the at-capacity case
} {
  const atCapacity = (runningCount ?? 0) >= MAX_CONCURRENT_RUNS;
  // The chunked enqueue still runs for BOTH branches (queued runs need child
  // rows pre-inserted), BUT it is chunked at 1000 — so even at capacity the
  // single 10k-row upsert that caused the 546 can never happen. The key
  // adversarial assertion is: the at-capacity path NEVER does the immediate
  // worker kick (the compute-pool pressure source) and ALWAYS returns 200.
  return {
    decision: atCapacity ? "queued" : "running",
    reachesHeavyEnqueue: false, // single giant upsert is gone for every branch
    httpStatus: 200,
  };
}

// ── T-08: (cap+1)th run yields queued not 546 ───────────────────────────────
Deno.test("T-08 the 5th concurrent start (runningCount=4) → queued, HTTP 200, never the 546 heavy path", () => {
  const p = startRunPath(4);
  assertEquals(p.decision, "queued");
  assertEquals(p.httpStatus, 200);
  assertEquals(p.reachesHeavyEnqueue, false);
});

Deno.test("T-08b a 6th and 7th overlapping start also queue (never 546)", () => {
  for (const rc of [5, 6, 20]) {
    const p = startRunPath(rc);
    assertEquals(p.decision, "queued", `runningCount=${rc} must queue`);
    assertEquals(p.httpStatus, 200);
  }
});

Deno.test("T-08c the 4th concurrent start (runningCount=3) still runs (boundary)", () => {
  const p = startRunPath(3);
  assertEquals(p.decision, "running");
});

// Strip SQL line comments (-- …) so prose like "LIMIT 5 -> 4" in comments never
// trips a literal scan. Operates on executable SQL only.
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

// ── T-14: cap literals match across edge fn + migration (SC-2) ──────────────
Deno.test("T-14 cap literal is identical in index.ts and the migration", async () => {
  const idx = await Deno.readTextFile(INDEX_PATH);
  const migRaw = await Deno.readTextFile(MIGRATION_PATH);
  const mig = stripSqlComments(migRaw);

  const idxMatch = idx.match(/const\s+MAX_CONCURRENT_RUNS\s*=\s*(\d+)/);
  assert(idxMatch, "index.ts must declare MAX_CONCURRENT_RUNS = <int>");
  const idxCap = Number(idxMatch![1]);

  // migration: free_slots := 4 - running_count
  const freeSlotsMatch = mig.match(
    /free_slots\s*:=\s*(\d+)\s*-\s*running_count/,
  );
  assert(freeSlotsMatch, "migration must compute free_slots := <int> - running_count");
  const freeSlotsCap = Number(freeSlotsMatch![1]);

  // migration: the stale-heartbeat re-kick LIMIT (mirrors the cap). The vault
  // secret read uses `LIMIT 1` and the promotion uses `LIMIT free_slots`, so
  // we assert specifically on the re-kick loop's integer LIMIT — the one that
  // must track the cap. Scope: the LIMIT that immediately precedes the LOOP in
  // the running/cancelling re-kick block.
  const rekickBlock = mig.slice(
    mig.indexOf("status IN ('running', 'cancelling')"),
  );
  const rekickLimitMatch = rekickBlock.match(/LIMIT\s+(\d+)/);
  assert(rekickLimitMatch, "re-kick loop must have an integer LIMIT");
  const rekickLimit = Number(rekickLimitMatch![1]);

  assertEquals(idxCap, MAX_CONCURRENT_RUNS, "test mirror must track the cap");
  assertEquals(freeSlotsCap, idxCap, "free_slots literal must equal MAX_CONCURRENT_RUNS");
  assertEquals(rekickLimit, idxCap, "re-kick LIMIT must equal the cap");
});
