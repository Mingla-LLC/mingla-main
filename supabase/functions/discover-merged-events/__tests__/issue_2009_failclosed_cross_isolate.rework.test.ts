// issue #2009 — IMPLEMENTOR REWORK COVERAGE for AMENDMENT 3C, Defect 5.
//
// Contract: AMENDMENT 3C (#issuecomment-5318285509) over 3B
//           (#issuecomment-5317545075). SC-14 / SC-15 and ORCH-426's
//           cross-isolate overload protection.
//
// THE DEFECT. AMENDMENT 3B separated the SERVE key from the COALESCING key and
// pointed the isolate-local single-flight map at the coalescing one. That
// collapsed a fail-closed herd to one build INSIDE one isolate. But
// `_resolve-entry.ts` still handed the raw per-call-unique cache key to the
// DISTRIBUTED build lock and to the L2 write. Across isolates — which is how
// the edge runtime actually serves a herd — N requests therefore still ran N
// independent database builds, and each one upserted a cache row keyed on a
// uuid no later request can ever mint, i.e. permanent garbage. Both happen
// precisely when the database is too stressed to answer a single-row
// primary-key read, which is when an N-fold amplification on the consumer app's
// hottest path turns a slow period into an outage.
//
// WHY THIS FILE USES WORKERS. Every other #2009 suite runs in one process, so
// every one of them shares a single `_memory-cache.ts` module instance — and
// therefore cannot distinguish "the herd collapsed because the isolate-local
// single-flight map caught it" from "the herd collapsed because the isolates
// agreed at the database". That distinction IS Defect 5. So each request here
// runs in a Deno `Worker`: a real separate V8 isolate with its own module graph,
// its own L1 map, its own single-flight map and its own generation memo. The
// ONLY thing they share is the database, which this process models and which
// counts the builds. D0 asserts the separation rather than assuming it.
//
// WHAT COUNTS AS A BUILD. Not a test-local counter around the unit — the number
// of `pg_discover_business_events` calls that ARRIVE AT THE SHARED DATABASE.
// `buildDiscoverMergedResponse` issues exactly one per build, so this is the
// same quantity an operator would read off the database under load.
//
//   D0  the workers really are separate isolates (distinct module instances),
//       and in the fail-closed state each independently mints its own unique
//       cache key. Without this, D1's number proves nothing.
//   D1  THE FIX: N fail-closed requests across N isolates produce exactly ONE
//       build at the database, and N-1 degrade with `DiscoverOverloadedError`
//       (503 + Retry-After in index.ts) instead of amplifying.
//   D2  no unreadable L2 row is written: zero cache upserts on the fail-closed
//       path, where the pre-fix code wrote one per request.
//   D3  CONTROL: with the generation readable, the very same harness serves ALL
//       N from one build and writes exactly one L2 row — so D1/D2's numbers are
//       attributable to the fail-closed branch and the readable path is
//       demonstrably untouched.
//   D4  the distributed lock is RELEASED on the coalescing key, so a later
//       fail-closed herd can still build. A lock leak would look like a fix in
//       D1 while making discovery permanently unavailable.
//
// Per #2113 nothing here asserts on source text; every assertion is a count
// taken at the shared database after executing the shipped
// `resolveDiscoverEntry`.
//
// Run with:
//   deno test --no-check --allow-env --allow-read \
//     supabase/functions/discover-merged-events/__tests__/issue_2009_failclosed_cross_isolate.rework.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const WORKER_URL = new URL(
  "./issue_2009_failclosed_cross_isolate.worker.ts",
  import.meta.url,
);

/** How many isolates. Matches the 12 the pass-1 TEST REPORT measured. */
const HERD = 12;

/** Milliseconds the modelled discovery RPC takes, so the lock window is real. */
const BUILD_MS = 40;

interface CacheRow {
  cache_key: string;
  response: unknown;
  response_gzip_base64: string | null;
  fetched_at: string;
  expires_at: string;
}

/**
 * The shared database. It is the ONLY thing the isolates have in common, and
 * every number this suite asserts on is read off it.
 */
interface SharedDb {
  /** One per `pg_discover_business_events` — i.e. one per BUILD. */
  builds: number;
  /** Every cache_key ever upserted into discover_merged_events_cache. */
  cacheWrites: string[];
  /** Every cache_key the build lock was ever taken on. */
  lockGrants: string[];
  /** Currently-held locks: cache_key -> expiry epoch ms. */
  locks: Map<string, number>;
  rows: Map<string, CacheRow>;
  cacheReads: number;
}

function newDb(): SharedDb {
  return {
    builds: 0,
    cacheWrites: [],
    lockGrants: [],
    locks: new Map(),
    rows: new Map(),
    cacheReads: 0,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
async function handleOp(db: SharedDb, op: any): Promise<unknown> {
  if (op.kind === "rpc") {
    if (op.name === "pg_try_discover_cache_build_lock") {
      const key = op.args.p_cache_key as string;
      const now = Date.now();
      const held = db.locks.get(key);
      if (held !== undefined && held > now) return { data: false, error: null };
      db.locks.set(key, now + Number(op.args.p_ttl_seconds ?? 60) * 1000);
      db.lockGrants.push(key);
      return { data: true, error: null };
    }
    if (op.name === "pg_release_discover_cache_build_lock") {
      db.locks.delete(op.args.p_cache_key as string);
      return { data: null, error: null };
    }
    if (op.name === "pg_discover_business_events") {
      db.builds += 1;
      await sleep(BUILD_MS);
      return { data: [], error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${op.name}` } };
  }

  if (op.kind === "invoke") {
    // ticketmaster-events, the build's other half. Empty is fine: the build is
    // counted at the discovery RPC above.
    return { data: { events: [], meta: { totalResults: 0 } }, error: null };
  }

  // discover_merged_events_cache
  const ops = op.ops as unknown[][];
  const verbs = ops.map((o) => o[0]);

  if (verbs.includes("upsert")) {
    const row = ops.find((o) => o[0] === "upsert")![1] as CacheRow;
    db.cacheWrites.push(row.cache_key);
    db.rows.set(row.cache_key, row);
    return { data: null, error: null };
  }

  if (verbs.includes("delete")) {
    // The expiry sweep. Modelled as a no-op result; it is still a write the
    // fail-closed path should not be paying for, and D2 counts the upsert.
    return { data: null, error: null };
  }

  db.cacheReads += 1;
  const eq = ops.find((o) => o[0] === "eq");
  const row = eq ? db.rows.get(eq[2] as string) : undefined;
  if (!row) return { data: null, error: null };
  const gt = ops.find((o) => o[0] === "gt");
  if (gt && !(row.expires_at > (gt[2] as string))) return { data: null, error: null };
  return { data: row, error: null };
}

interface WorkerResult {
  isolate: string;
  served: boolean;
  cacheKey: string;
  itemCount?: number;
  errorName?: string;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * Spawn `count` isolates, hold them at a barrier, release them together, and
 * return the shared database plus what each isolate saw.
 */
async function runHerd(
  count: number,
  request: { failClosed: boolean; generation?: number },
  db: SharedDb = newDb(),
): Promise<{ db: SharedDb; results: WorkerResult[]; readyIsolates: string[] }> {
  const workers: Worker[] = [];
  const readyGates: Promise<void>[] = [];
  const doneGates: Promise<void>[] = [];
  const results: WorkerResult[] = [];
  const readyIsolates: string[] = [];

  for (let i = 0; i < count; i++) {
    const worker = new Worker(WORKER_URL, { type: "module" });
    const ready = deferred();
    const done = deferred();
    readyGates.push(ready.promise);
    doneGates.push(done.promise);

    worker.onmessage = async (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "ready") {
        readyIsolates.push(message.isolate);
        ready.resolve();
        return;
      }
      if (message.type === "db") {
        const result = await handleOp(db, message.op);
        worker.postMessage({ type: "db-result", id: message.id, result });
        return;
      }
      if (message.type === "done") {
        results.push(message as WorkerResult);
        done.resolve();
      }
    };

    workers.push(worker);
  }

  // Barrier: nothing runs until every isolate has booted, so the lock really is
  // contended rather than serialised by worker start-up.
  await Promise.all(readyGates);
  for (const worker of workers) {
    worker.postMessage({
      type: "go",
      failClosed: request.failClosed,
      generation: request.generation ?? 41,
    });
  }
  await Promise.all(doneGates);
  for (const worker of workers) worker.terminate();

  return { db, results, readyIsolates };
}

// ---------------------------------------------------------------------------
// D0 + D1 + D2 — one run, because they are three readings of the same herd.
// ---------------------------------------------------------------------------
Deno.test({
  name:
    "#2009 D0/D1/D2 — N fail-closed requests across N SEPARATE isolates are ONE database build and ZERO cache rows",
  // Deno's op sanitiser sees the terminated workers' message ports settle after
  // the test body returns; the workers are explicitly terminated in runHerd.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { db, results, readyIsolates } = await runHerd(HERD, { failClosed: true });

    // ---- D0: these really are separate isolates, each minting its own key ---
    assertEquals(
      new Set(readyIsolates).size,
      HERD,
      "each worker must be a DISTINCT module instantiation — otherwise the collapse " +
        "measured below could be the isolate-local single-flight map, which is the " +
        "thing AMENDMENT 3B already fixed and 3C is explicitly not about",
    );
    assertEquals(
      new Set(results.map((r) => r.cacheKey)).size,
      HERD,
      "every fail-closed isolate must mint its OWN per-call-unique cache key — that " +
        "uniqueness is what makes the response uncacheable and it may not be traded away",
    );

    const served = results.filter((r) => r.served);
    const shed = results.filter((r) => !r.served);

    console.log(
      `#2009 D1: ${HERD} concurrent fail-closed requests across ${
        new Set(readyIsolates).size
      } isolates -> ${db.builds} database build(s), ${db.cacheWrites.length} L2 cache row(s) ` +
        `written, ${db.lockGrants.length} build-lock grant(s) on ` +
        `${new Set(db.lockGrants).size} distinct lock key(s), ${served.length} served, ` +
        `${shed.length} shed`,
    );

    // ---- D1: exactly one build -------------------------------------------
    assertEquals(
      db.builds,
      1,
      `AMENDMENT 3C Defect 5: ${HERD} concurrent fail-closed requests across separate ` +
        `isolates produced ${db.builds} independent database builds. The distributed ` +
        `build lock is being taken on the per-call-unique CACHE key instead of the ` +
        `stable COALESCING key, so every isolate wins its own lock and rebuilds — an ` +
        `N-fold amplification on discovery at the exact moment the database is already ` +
        `failing a single-row read.`,
    );
    assertEquals(
      new Set(db.lockGrants).size,
      1,
      "and the lock must have been contended on ONE namespace, not granted per request",
    );
    assertEquals(
      served.length,
      1,
      "exactly the lock winner is served; the rest degrade rather than amplify",
    );
    assertEquals(
      shed.length,
      HERD - 1,
      "the losers must all be shed",
    );
    for (const r of shed) {
      assertEquals(
        r.errorName,
        "DiscoverOverloadedError",
        "a shed fail-closed request must surface the existing overload signal, which " +
          "index.ts already maps to 503 + Retry-After — not an unhandled throw",
      );
    }

    // ---- D2: no unreadable row -------------------------------------------
    assertEquals(
      db.cacheWrites.length,
      0,
      `AMENDMENT 3C: ${db.cacheWrites.length} L2 cache row(s) were written under ` +
        `per-call-unique keys. Nothing can ever read them — the only request whose key ` +
        `matches is the one that just built the bytes — so they are permanent garbage ` +
        `accumulating in discover_merged_events_cache under exactly the conditions ` +
        `where the database can least absorb it.`,
    );
    assertEquals(db.rows.size, 0, "and therefore no row exists in the cache table");
  },
});

// ---------------------------------------------------------------------------
// D3 — the CONTROL. Same harness, readable generation.
// ---------------------------------------------------------------------------
Deno.test({
  name:
    "#2009 D3 — CONTROL: with the generation readable the same harness serves ALL N from one build and one L2 row",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { db, results } = await runHerd(HERD, { failClosed: false, generation: 41 });

    assertEquals(
      new Set(results.map((r) => r.cacheKey)).size,
      1,
      "a readable generation must give every isolate the SAME cache key",
    );

    console.log(
      `#2009 D3 CONTROL: ${HERD} concurrent readable-generation requests -> ` +
        `${db.builds} build(s), ${db.cacheWrites.length} L2 row(s), ` +
        `${results.filter((r) => r.served).length} served`,
    );

    assertEquals(
      db.builds,
      1,
      "ORCH-426's cross-isolate coalescing on the healthy path must be untouched",
    );
    assertEquals(
      db.cacheWrites.length,
      1,
      "and the healthy path must still publish exactly one readable L2 row — if this " +
        "hits 0 the fix has stopped the cache from caching, which is a far worse " +
        "regression than the defect it was fixing",
    );
    assertEquals(
      results.filter((r) => r.served).length,
      HERD,
      "every isolate must be SERVED on the healthy path — the losers read the winner's " +
        "published row rather than being shed",
    );
    assert(
      db.cacheReads > HERD,
      "the losers must actually have read the shared row from the database",
    );
  },
});

// ---------------------------------------------------------------------------
// D4 — the lock is released, so fail-closed does not become permanently down.
// ---------------------------------------------------------------------------
Deno.test({
  name: "#2009 D4 — the collapsed distributed lock is released, so a later fail-closed herd still builds",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await runHerd(4, { failClosed: true }, db);
    assertEquals(db.builds, 1, "the first fail-closed herd is one build");
    assertEquals(
      db.locks.size,
      0,
      "the winner must RELEASE the collapsed lock — a leak here would look exactly " +
        "like a fix in D1 while making discovery permanently unavailable for the rest " +
        "of the lock TTL",
    );

    await runHerd(4, { failClosed: true }, db);
    assertEquals(
      db.builds,
      2,
      "a later fail-closed herd must be able to build its own single deck",
    );
    assertEquals(db.cacheWrites.length, 0, "and still write nothing unreadable");
  },
});
