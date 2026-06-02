// ORCH-1032 implementor happy-path regression test.
//
// Proves the concurrency gate + chunked-enqueue behavior. handleStartRun isn't
// exported, so we mirror the EXACT pure decisions the implementation makes
// (gate at index.ts ~line 1262, chunk loop at ~line 1314) as small functions
// here, plus source-inspect the edge fn to catch a mirror-only revert. The
// behavioral half (T-01..T-04) fails the moment the cap literal / branch /
// batch loop is reverted; the source-inspect half (T-05..T-07) catches a
// revert that only touches the real source. Two-key revert detector, matching
// runRemainder.test.ts.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const INDEX_PATH = new URL("../index.ts", import.meta.url);

// Inline mirror of the gate at index.ts (ORCH-1032 S-3). Mirrors:
//   const atCapacity = (runningCount ?? 0) >= MAX_CONCURRENT_RUNS;
const MAX_CONCURRENT_RUNS = 4;
function gateDecision(runningCount: number): {
  atCapacity: boolean;
  status: "queued" | "running";
  kicks: boolean;
} {
  const atCapacity = (runningCount ?? 0) >= MAX_CONCURRENT_RUNS;
  return {
    atCapacity,
    status: atCapacity ? "queued" : "running",
    // first-chunk kick is gated on !atCapacity (and mode full_city/remainder).
    kicks: !atCapacity,
  };
}

// Inline mirror of the chunked enqueue loop (ORCH-1032 S-5).
const BATCH_INSERT_SIZE = 1000;
function planBatches(totalRows: number): number[] {
  const sizes: number[] = [];
  for (let i = 0; i < totalRows; i += BATCH_INSERT_SIZE) {
    sizes.push(Math.min(BATCH_INSERT_SIZE, totalRows - i));
  }
  return sizes;
}

// ── T-01: below cap → running, kick fires ──────────────────────────────────
Deno.test("T-01 gate decision below cap (3 < 4) → running + kick", () => {
  const d = gateDecision(3);
  assertEquals(d.atCapacity, false);
  assertEquals(d.status, "running");
  assertEquals(d.kicks, true);
});

// ── T-02: at cap → queued, no kick ──────────────────────────────────────────
Deno.test("T-02 gate decision at cap (4 >= 4) → queued + no kick", () => {
  const d = gateDecision(4);
  assertEquals(d.atCapacity, true);
  assertEquals(d.status, "queued");
  assertEquals(d.kicks, false);
});

// ── T-03: above cap (legacy 5) → queued ─────────────────────────────────────
Deno.test("T-03 gate decision above cap (5 >= 4) → queued", () => {
  const d = gateDecision(5);
  assertEquals(d.atCapacity, true);
  assertEquals(d.status, "queued");
  assertEquals(d.kicks, false);
});

// ── T-04: chunking math for a 10,706-place city ─────────────────────────────
Deno.test("T-04 chunked enqueue: 10706 rows → 11 batches, last=706, no batch > 1000", () => {
  const sizes = planBatches(10706);
  assertEquals(sizes.length, 11);
  assertEquals(sizes[sizes.length - 1], 706);
  assertEquals(sizes.reduce((a, b) => a + b, 0), 10706);
  for (const s of sizes) {
    assert(s <= BATCH_INSERT_SIZE, `batch ${s} exceeds BATCH_INSERT_SIZE`);
  }
  // exact multiple boundary
  const exact = planBatches(3000);
  assertEquals(exact.length, 3);
  assertEquals(exact.every((s) => s === 1000), true);
  // single small enqueue
  assertEquals(planBatches(42), [42]);
});

// ── T-05: source-inspect — gate exists in the real edge fn ──────────────────
Deno.test("T-05 source-inspect: concurrency gate present in index.ts", async () => {
  const src = await Deno.readTextFile(INDEX_PATH);
  assert(
    src.includes("const MAX_CONCURRENT_RUNS = 4"),
    "index.ts must declare MAX_CONCURRENT_RUNS = 4",
  );
  assert(
    src.includes("const atCapacity ="),
    "index.ts must compute atCapacity",
  );
  assert(
    src.includes('status: atCapacity ? "queued" : "running"'),
    "parent insert must branch status on atCapacity",
  );
  assert(
    src.includes("started_at: atCapacity ? null :"),
    "parent insert must leave started_at NULL when queued",
  );
  assert(
    src.includes("!atCapacity &&"),
    "first-chunk kick must be gated on !atCapacity",
  );
  // queued response payload contract (LOCKED).
  assert(
    src.includes("queued: atCapacity"),
    "response must carry queued:atCapacity",
  );
  assert(
    src.includes("maxConcurrentRuns: MAX_CONCURRENT_RUNS"),
    "response must carry maxConcurrentRuns",
  );
});

// ── T-06: source-inspect — chunked enqueue exists ───────────────────────────
Deno.test("T-06 source-inspect: chunked enqueue present in index.ts", async () => {
  const src = await Deno.readTextFile(INDEX_PATH);
  assert(
    src.includes("const BATCH_INSERT_SIZE = 1000"),
    "index.ts must declare BATCH_INSERT_SIZE = 1000",
  );
  assert(
    src.includes("i += BATCH_INSERT_SIZE"),
    "enqueue must loop in BATCH_INSERT_SIZE strides",
  );
  assert(
    src.includes("slice(i, i + BATCH_INSERT_SIZE)"),
    "enqueue must slice the pendingRows per batch",
  );
  assert(
    src.includes('onConflict: "run_id,place_pool_id"'),
    "enqueue must preserve onConflict run_id,place_pool_id",
  );
});

// ── T-07: source-inspect — list_active_runs includes queued ─────────────────
Deno.test("T-07 source-inspect: list_active_runs includes queued", async () => {
  const src = await Deno.readTextFile(INDEX_PATH);
  assert(
    src.includes(
      '.in("status", ["pending", "queued", "running", "cancelling"])',
    ),
    "handleListActiveRuns must include 'queued' in the status .in(...) array",
  );
});
