// Issue #1644 — Stage 0 storage guardrail contract.
//
// Storage sits at ~78.21 GiB of a SPEND-CAPPED 100 GiB quota, so an overage is a
// Fair-Use restriction (possible org-wide read-only database), not a bill. A
// re-run of the place-photo/collage backfill was measured at 29.3 GiB/week and
// would burn the 21.79 GiB of headroom in about five days.
//
// The contract these tests pin:
//   1. PERMIT below the ceiling, REFUSE at or above it.
//   2. FAIL CLOSED whenever usage cannot be measured. A guard that fails open is
//      worse than no guard — it manufactures confidence exactly when the
//      measurement path is broken.
//   3. The refusal message must be ACTIONABLE: current usage, the ceiling, and
//      what to do about it.
//   4. The env override can raise the ceiling without a redeploy, but a typo'd
//      override must fall back to the SAFE default rather than disabling the guard.
//   5. Successful measurements are memoised (the underlying query is a full seq
//      scan of storage.objects: measured 854 ms cold / 118 ms warm in production),
//      but FAILURES are never cached, so a transient blip cannot pin the guard shut.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  checkStorageHeadroom,
  measureStorageTotalBytes,
  resetStorageHeadroomCache,
  resolveStorageHeadroomThreshold,
  STORAGE_HEADROOM_DEFAULT_MAX_BYTES,
  STORAGE_HEADROOM_MAX_BYTES_ENV,
  STORAGE_TOTAL_BYTES_RPC,
  type StorageHeadroomDb,
} from "../storageHeadroomGuard.ts";

const GIB = 1024 * 1024 * 1024;

/** Production reading at the time of the sweep. */
const CURRENT_USAGE_BYTES = 83_976_304_453; // 78.21 GiB

type RpcCall = { fn: string };

function dbReturning(value: unknown, calls: RpcCall[] = []): StorageHeadroomDb {
  return {
    rpc: (fn: string) => {
      calls.push({ fn });
      return Promise.resolve({ data: value, error: null });
    },
  };
}

function dbErroring(message: string, calls: RpcCall[] = []): StorageHeadroomDb {
  return {
    rpc: (fn: string) => {
      calls.push({ fn });
      return Promise.resolve({ data: null, error: { message } });
    },
  };
}

function envOf(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

// ── 1. The core permit / refuse boundary ────────────────────────────────────

Deno.test("#1644 PERMITS a backfill when storage is below the 85 GiB ceiling", async () => {
  resetStorageHeadroomCache();
  const verdict = await checkStorageHeadroom(
    dbReturning(CURRENT_USAGE_BYTES),
    "test",
    { getEnv: envOf({}) },
  );
  assertEquals(verdict.ok, true);
  if (verdict.ok) {
    assertEquals(verdict.totalBytes, CURRENT_USAGE_BYTES);
    assertEquals(verdict.thresholdBytes, 85 * GIB);
  }
});

Deno.test("#1644 REFUSES a backfill when storage is above the 85 GiB ceiling", async () => {
  resetStorageHeadroomCache();
  const over = 90 * GIB;
  const verdict = await checkStorageHeadroom(dbReturning(over), "backfill-place-photos create_run", {
    getEnv: envOf({}),
  });
  assertEquals(verdict.ok, false);
  if (!verdict.ok) {
    assertEquals(verdict.reason, "over_threshold");
    assertEquals(verdict.totalBytes, over);
    // The message must be actionable: name the caller, the usage, and the ceiling.
    assert(verdict.message.includes("backfill-place-photos create_run"), "names the caller");
    assert(verdict.message.includes("90.00 GiB"), "names current usage");
    assert(verdict.message.includes("85.00 GiB"), "names the ceiling");
    assert(verdict.message.includes("TO FIX"), "tells the operator what to do");
    assert(
      verdict.message.includes(STORAGE_HEADROOM_MAX_BYTES_ENV),
      "names the override lever",
    );
  }
});

Deno.test("#1644 REFUSES exactly AT the ceiling (boundary is >=, not >)", async () => {
  resetStorageHeadroomCache();
  const atCeiling = await checkStorageHeadroom(dbReturning(85 * GIB), "test", { getEnv: envOf({}) });
  assertEquals(atCeiling.ok, false);

  resetStorageHeadroomCache();
  const oneByteUnder = await checkStorageHeadroom(dbReturning(85 * GIB - 1), "test", {
    getEnv: envOf({}),
  });
  assertEquals(oneByteUnder.ok, true);
});

// ── 2. Fail-closed on every unmeasurable path ───────────────────────────────

Deno.test("#1644 FAILS CLOSED when the measurement RPC returns an error", async () => {
  resetStorageHeadroomCache();
  const verdict = await checkStorageHeadroom(
    dbErroring(`function ${STORAGE_TOTAL_BYTES_RPC} does not exist`),
    "test",
    { getEnv: envOf({}) },
  );
  assertEquals(verdict.ok, false);
  if (!verdict.ok) {
    assertEquals(verdict.reason, "unmeasurable");
    assertEquals(verdict.totalBytes, null);
    assert(verdict.message.includes("could not be measured"));
    assert(verdict.message.includes(STORAGE_TOTAL_BYTES_RPC), "names the missing RPC");
  }
});

Deno.test("#1644 FAILS CLOSED when the RPC throws rather than returning an error", async () => {
  resetStorageHeadroomCache();
  const db: StorageHeadroomDb = {
    rpc: () => Promise.reject(new Error("connection reset")),
  };
  const verdict = await checkStorageHeadroom(db, "test", { getEnv: envOf({}) });
  assertEquals(verdict.ok, false);
  if (!verdict.ok) assertEquals(verdict.reason, "unmeasurable");
});

Deno.test("#1644 FAILS CLOSED on a non-numeric or negative payload", async () => {
  for (const payload of [null, undefined, "not-a-number", {}, [], -1, Number.NaN]) {
    resetStorageHeadroomCache();
    const verdict = await checkStorageHeadroom(dbReturning(payload), "test", { getEnv: envOf({}) });
    assertEquals(verdict.ok, false, `payload ${JSON.stringify(payload) ?? "undefined"} must refuse`);
  }
});

Deno.test("#1644 accepts a bigint rendered as a STRING (PostgREST renders bigint as text)", async () => {
  resetStorageHeadroomCache();
  const verdict = await checkStorageHeadroom(dbReturning(String(CURRENT_USAGE_BYTES)), "test", {
    getEnv: envOf({}),
  });
  assertEquals(verdict.ok, true);
  if (verdict.ok) assertEquals(verdict.totalBytes, CURRENT_USAGE_BYTES);
});

// ── 3. The env override ─────────────────────────────────────────────────────

Deno.test("#1644 the env override raises the ceiling without a redeploy", async () => {
  const raised = String(95 * GIB);
  assertEquals(resolveStorageHeadroomThreshold(envOf({ [STORAGE_HEADROOM_MAX_BYTES_ENV]: raised })), 95 * GIB);

  resetStorageHeadroomCache();
  // 90 GiB is refused by default...
  assertEquals((await checkStorageHeadroom(dbReturning(90 * GIB), "t", { getEnv: envOf({}) })).ok, false);

  resetStorageHeadroomCache();
  // ...and permitted once the operator raises the ceiling to 95 GiB.
  const verdict = await checkStorageHeadroom(dbReturning(90 * GIB), "t", {
    getEnv: envOf({ [STORAGE_HEADROOM_MAX_BYTES_ENV]: raised }),
  });
  assertEquals(verdict.ok, true);
});

Deno.test("#1644 an UNPARSEABLE override falls back to the safe default, never to 'no guard'", () => {
  // A typo must not silently disable the guardrail. Every one of these resolves
  // to the 85 GiB default — the conservative outcome.
  for (const bad of ["", "   ", "abc", "85GB", "-1", "0", "1.5", "NaN", "Infinity"]) {
    assertEquals(
      resolveStorageHeadroomThreshold(envOf({ [STORAGE_HEADROOM_MAX_BYTES_ENV]: bad })),
      STORAGE_HEADROOM_DEFAULT_MAX_BYTES,
      `override "${bad}" must fall back to the default ceiling`,
    );
  }
  // Unset also resolves to the default, so the guard protects with zero config.
  assertEquals(resolveStorageHeadroomThreshold(envOf({})), STORAGE_HEADROOM_DEFAULT_MAX_BYTES);
  assertEquals(STORAGE_HEADROOM_DEFAULT_MAX_BYTES, 85 * GIB);
});

// ── 4. Caching behaviour (the query is a full seq scan) ─────────────────────

Deno.test("#1644 a successful measurement is memoised within the TTL, but a FAILURE is never cached", async () => {
  resetStorageHeadroomCache();
  const calls: RpcCall[] = [];
  const db = dbReturning(CURRENT_USAGE_BYTES, calls);

  const first = await measureStorageTotalBytes(db, { nowMs: 1_000_000 });
  assertEquals(first.cached, false);
  assertEquals(calls.length, 1);

  // Within the 60s TTL → served from cache, no second seq scan.
  const second = await measureStorageTotalBytes(db, { nowMs: 1_030_000 });
  assertEquals(second.cached, true);
  assertEquals(second.totalBytes, CURRENT_USAGE_BYTES);
  assertEquals(calls.length, 1, "must not re-query inside the TTL");

  // Past the TTL → re-measured.
  const third = await measureStorageTotalBytes(db, { nowMs: 1_070_000 });
  assertEquals(third.cached, false);
  assertEquals(calls.length, 2, "must re-query once the TTL expires");

  // A failure must NOT be cached, or a transient blip pins the guard shut for a
  // full TTL and a recovered database still cannot start a backfill.
  resetStorageHeadroomCache();
  const failCalls: RpcCall[] = [];
  const failing = dbErroring("timeout", failCalls);
  await measureStorageTotalBytes(failing, { nowMs: 2_000_000 });
  await measureStorageTotalBytes(failing, { nowMs: 2_000_001 });
  assertEquals(failCalls.length, 2, "failures must never be memoised");
});

Deno.test("#1644 the guard reads the agreed RPC name", async () => {
  resetStorageHeadroomCache();
  const calls: RpcCall[] = [];
  await checkStorageHeadroom(dbReturning(1, calls), "test", { getEnv: envOf({}) });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, STORAGE_TOTAL_BYTES_RPC);
  assertEquals(STORAGE_TOTAL_BYTES_RPC, "issue_1644_storage_total_bytes");
});
