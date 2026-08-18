// issue #2009 — IMPLEMENTOR REWORK COVERAGE for the pass-2 TEST REPORT,
// DEFECT D-1 (TEST REPORT — CONDITIONAL PASS, #issuecomment-5318617208).
//
// Contract: AMENDMENT 3C (#issuecomment-5318285509) over 3B
//           (#issuecomment-5317545075) over 3A (#issuecomment-5317431821).
//           SC-14 / SC-15 and ORCH-426's overload protection.
//
// THE DEFECT. `_resolve-entry.ts` recovered the fail-closed signal by asking
// whether `discoverBuildCoalesceKey` had CHANGED the cache key. That made the
// classification a function of the whole key — and the key is a JSON blob of
// unsanitised client input: `keywords`, `cityName`, `sort`, `segmentSlug`,
// `timezone` and three slug arrays all land in it. So a client field shaped
// like the `unavailable:<uuid>` fail-closed sentinel flipped `uncacheable` true
// on a PERFECTLY READABLE generation. The endpoint is anonymously reachable
// (`verify_jwt = false`), which made it an anonymous way to shed concurrent
// requests with 503s and suppress L2 caching on the consumer app's hottest
// endpoint — and it falsified Amendment 3C's claim that the healthy path is
// byte-for-byte what ORCH-426 shipped.
//
// THE FIX. `resolveDiscoveryGeneration` returns the readability boolean
// alongside the slot, `index.ts` threads it, and `resolveDiscoverEntry` takes
// it as a PARAMETER. `uncacheable` is now true if and only if the generation
// was genuinely unreadable, whatever the client wrote into the key. The cache
// key itself is unchanged — still per-call-unique when fail-closed, so nothing
// is ever served from or written into a slot keyed on an unknown generation.
//
// WHAT THIS FILE ATTACKS — a DIFFERENT ANGLE from every sibling. The cross-
// isolate suite proves N isolates collapse to one build; the herd suites count
// builds and generation round-trips. NONE of them ever puts an adversarial
// value in a client field, so none of them can see a healthy request being
// misclassified as degraded.
//
//   E1  CONTROL: readable generation, ordinary client input. 12 concurrent
//       requests -> 1 build, 1 L2 row, 12 served, 0 shed.
//   E2  THE ATTACK: readable generation, ONE poisoned client keyword, every
//       other input byte-identical to E1. Must match E1 exactly. Before the fix
//       this was 1 build / 0 L2 rows / 1 served / 11 x 503.
//   E3  the same attack over TIME rather than concurrency: two sequential
//       herds must cost ONE build, because the first published a readable L2
//       row. Before the fix the poison suppressed the write and the second herd
//       rebuilt from scratch.
//   E4  THE ONE-WAY PROPERTY — the reason D-1 was graded P2 and not P1. A
//       fuzz over adversarial client input in the OTHER direction: no
//       fail-closed request may EVER be classified cacheable, and none may ever
//       publish an L2 row. Executed over FUZZ_KEYS generated shapes.
//   E5  the slot-only view has not drifted from the pair it projects.
//
// Per #2113 every assertion EXECUTES the shipped units — `resolveDiscoverEntry`
// against a modelled database, `resolveDiscoveryGeneration`,
// `resolveDiscoveryGenerationSlot`, `buildDiscoverCacheKey`,
// `discoveryGenerationSlot`. Nothing here asserts on source text, and every
// count is read off the modelled database rather than a wrapper around the unit.
//
// Run with:
//   deno test --no-check --allow-env \
//     supabase/functions/discover-merged-events/__tests__/issue_2009_poisoned_cache_key_signal.rework.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildDiscoverCacheKey,
  type DiscoverCacheParams,
  type DiscoveryGenerationRead,
  discoveryGenerationSlot,
  resolveDiscoveryGeneration,
  resolveDiscoveryGenerationSlot,
} from "../_cache.ts";
import { DiscoverOverloadedError, resolveDiscoverEntry } from "../_resolve-entry.ts";

/** Matches the 12 the pass-1 and pass-2 TEST REPORTs both measured. */
const HERD = 12;
/** Milliseconds the modelled discovery RPC takes, so the lock window is real. */
const BUILD_MS = 40;
/** The one-way fuzz breadth the TEST REPORT ran. */
const FUZZ_KEYS = 10_400;
/** How many of those are additionally driven all the way through the resolver. */
const FUZZ_EXECUTED = 200;

// ---------------------------------------------------------------------------
// The modelled database. Every number this suite asserts on is read off it,
// never off a counter wrapped around the unit under test.
// ---------------------------------------------------------------------------
interface SharedDb {
  /** One per `pg_discover_business_events` — i.e. one per BUILD. */
  builds: number;
  /** Every cache_key ever upserted into discover_merged_events_cache. */
  cacheWrites: string[];
  /** Every cache_key the build lock was ever granted on. */
  lockGrants: string[];
  locks: Map<string, number>;
  rows: Map<string, Record<string, unknown>>;
}

function newDb(): SharedDb {
  return { builds: 0, cacheWrites: [], lockGrants: [], locks: new Map(), rows: new Map() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
async function handleOp(db: SharedDb, op: any, buildMs: number): Promise<unknown> {
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
      if (buildMs > 0) await sleep(buildMs);
      return { data: [], error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${op.name}` } };
  }

  // ticketmaster-events, the build's other half. The build is counted at the
  // discovery RPC above, so an empty answer is sufficient and keeps this
  // harness free of network.
  if (op.kind === "invoke") {
    return { data: { events: [], meta: { totalResults: 0 } }, error: null };
  }

  // discover_merged_events_cache
  const ops = op.ops as unknown[][];
  const verbs = ops.map((o) => o[0]);
  if (verbs.includes("upsert")) {
    const row = ops.find((o) => o[0] === "upsert")![1] as Record<string, unknown>;
    db.cacheWrites.push(row.cache_key as string);
    db.rows.set(row.cache_key as string, row);
    return { data: null, error: null };
  }
  // The expiry sweep — a no-op result; D-1's counts are taken on the upsert.
  if (verbs.includes("delete")) return { data: null, error: null };

  const eq = ops.find((o) => o[0] === "eq");
  const row = eq ? db.rows.get(eq[2] as string) : undefined;
  if (!row) return { data: null, error: null };
  const gt = ops.find((o) => o[0] === "gt");
  if (gt && !((row.expires_at as string) > (gt[2] as string))) return { data: null, error: null };
  return { data: row, error: null };
}

/** The PostgREST-ish chain `_distributed-cache.ts` actually builds. */
// deno-lint-ignore no-explicit-any
function modelledSupabase(db: SharedDb, buildMs = BUILD_MS): any {
  // deno-lint-ignore no-explicit-any
  const table = (name: string): any => {
    const ops: unknown[][] = [];
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: (c: string) => (ops.push(["select", c]), chain),
      eq: (c: string, v: unknown) => (ops.push(["eq", c, v]), chain),
      gt: (c: string, v: unknown) => (ops.push(["gt", c, v]), chain),
      lt: (c: string, v: unknown) => (ops.push(["lt", c, v]), chain),
      delete: () => (ops.push(["delete"]), chain),
      upsert: (row: unknown, o: unknown) => (ops.push(["upsert", row, o]), chain),
      maybeSingle: () =>
        handleOp(db, { kind: "table", table: name, ops: [...ops, ["maybeSingle"]] }, buildMs),
      // The write paths `await` the builder itself rather than a terminator.
      // deno-lint-ignore no-explicit-any
      then: (ok: any, err: any) =>
        handleOp(db, { kind: "table", table: name, ops }, buildMs).then(ok, err),
    };
    return chain;
  };
  return {
    from: (n: string) => table(n),
    rpc: (name: string, args: unknown) => handleOp(db, { kind: "rpc", name, args }, buildMs),
    functions: {
      invoke: (name: string, options: unknown) =>
        handleOp(db, { kind: "invoke", name, options }, buildMs),
    },
  };
}

// ---------------------------------------------------------------------------
// The client input. `POISON` is the exact shape `discoverBuildCoalesceKey`
// rewrites — 8-4-4-4-12 lowercase hex behind the `unavailable:` prefix — placed
// in a field a client fully controls.
// ---------------------------------------------------------------------------
const POISON = `unavailable:${crypto.randomUUID()}`;

function paramsFor(
  city: string,
  keywords: string[],
  discoveryGeneration: string,
): DiscoverCacheParams {
  return {
    cityName: city,
    stateCode: null,
    countryCode: "NG",
    page: 1,
    size: 20,
    partyTypeSlugs: [],
    vibeTagSlugs: [],
    musicGenreSlugs: [],
    dateWindowUtc: null,
    timezone: "Africa/Lagos",
    keywords,
    discoveryGeneration,
  };
}

// deno-lint-ignore no-explicit-any
function buildCtxFor(supabase: any, city: string): any {
  return {
    supabase,
    cityName: city,
    city: {},
    page: 1,
    size: 20,
    partyTypeSlugs: [],
    vibeTagSlugs: [],
    musicGenreSlugs: [],
    dateWindowUtc: null,
    // deno-lint-ignore no-explicit-any
  } as any;
}

/** A generation reader that always succeeds — the READABLE arm. */
function okReader(value: number): () => Promise<DiscoveryGenerationRead> {
  return () => Promise.resolve({ data: value, error: null });
}

/** A generation reader that always fails — the FAIL-CLOSED arm. */
function failingReader(): () => Promise<DiscoveryGenerationRead> {
  return () =>
    Promise.resolve({
      data: null,
      error: { message: "issue_2009_event_discovery_generation is unavailable" },
    });
}

interface HerdResult {
  db: SharedDb;
  served: number;
  shed: number;
  cacheKey: string;
}

/**
 * Replays index.ts's post-validation sequence for a herd of concurrent
 * requests: resolve the generation, build the key, then drive the SHIPPED
 * `resolveDiscoverEntry` with the readability threaded exactly as index.ts
 * threads it. The isolate-local single-flight is deliberately bypassed (as in
 * the cross-isolate suite) so what is measured is the DATABASE-level
 * coalescing, which is where D-1's 503s came from.
 */
async function herd(
  city: string,
  keywords: string[],
  read: () => Promise<DiscoveryGenerationRead>,
  now: number,
  db: SharedDb = newDb(),
): Promise<HerdResult> {
  const supabase = modelledSupabase(db);
  const { slot, readable } = await resolveDiscoveryGeneration(read, now);
  const cacheKey = buildDiscoverCacheKey(paramsFor(city, keywords, slot));
  const buildCtx = buildCtxFor(supabase, city);

  let served = 0;
  let shed = 0;
  await Promise.all(
    Array.from({ length: HERD }, async () => {
      try {
        await resolveDiscoverEntry(supabase, cacheKey, buildCtx, !readable);
        served += 1;
      } catch (err) {
        if (err instanceof DiscoverOverloadedError) shed += 1;
        else throw err;
      }
    }),
  );
  return { db, served, shed, cacheKey };
}

// ---------------------------------------------------------------------------
// E1 — the CONTROL. Without it E2's numbers prove nothing.
// ---------------------------------------------------------------------------
Deno.test({
  name:
    "#2009 E1 — CONTROL: a readable generation with ordinary client input is 1 build, 1 L2 row, 12 served, 0 shed",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const r = await herd("Controlville", ["afrobeats"], okReader(7), 100_000_000);
    console.log(
      `#2009 E1 CONTROL: builds=${r.db.builds} l2Rows=${r.db.cacheWrites.length} ` +
        `served=${r.served} shed503=${r.shed}`,
    );
    assertEquals(r.db.builds, 1, "ORCH-426 coalescing: one build for the herd");
    assertEquals(r.db.cacheWrites.length, 1, "the healthy path publishes exactly one readable L2 row");
    assertEquals(r.served, HERD, "every request is served");
    assertEquals(r.shed, 0, "nothing is shed on the healthy path");
  },
});

// ---------------------------------------------------------------------------
// E2 — THE ATTACK (SENTINEL). One client field differs from E1.
// ---------------------------------------------------------------------------
Deno.test({
  name:
    "#2009 E2 — SENTINEL: a client field shaped like the fail-closed sentinel must NOT degrade a readable generation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const r = await herd("Controlville", [POISON], okReader(7), 200_000_000);
    console.log(
      `#2009 E2 POISONED: builds=${r.db.builds} l2Rows=${r.db.cacheWrites.length} ` +
        `served=${r.served} shed503=${r.shed}`,
    );

    // The key must still literally carry the client's value — the fix does not
    // sanitise or rewrite the cache key, it stops CLASSIFYING on it. If this
    // ever fails the "fix" has become input filtering, which would silently
    // merge two genuinely different queries onto one cache entry.
    assert(
      r.cacheKey.includes(POISON),
      "the cache key must still carry the client's value verbatim — the fix is to stop " +
        "classifying on the key, not to rewrite it",
    );

    assertEquals(
      r.db.builds,
      1,
      "a poisoned client field must not change how many builds a readable generation costs",
    );
    assertEquals(
      r.db.cacheWrites.length,
      1,
      `DEFECT D-1: ${r.db.cacheWrites.length} L2 row(s) published. A client-supplied ` +
        `keyword shaped like 'unavailable:<uuid>' made \`uncacheable\` true on generation ` +
        `g7, so the L2 write was suppressed and discovery stopped caching on the consumer ` +
        `app's hottest endpoint — anonymously, since verify_jwt is false.`,
    );
    assertEquals(
      r.shed,
      0,
      `DEFECT D-1: ${r.shed} of ${HERD} concurrent requests were shed with ` +
        `DiscoverOverloadedError (503 + Retry-After) even though the generation read ` +
        `cleanly. The fail-closed signal was being recovered by pattern-matching the cache ` +
        `key, which carries unsanitised client input, so any client could put the whole ` +
        `endpoint into its degraded branch.`,
    );
    assertEquals(r.served, HERD, "every request must be served, exactly as in the control");
  },
});

// ---------------------------------------------------------------------------
// E3 — the same attack over TIME. A suppressed L2 row costs a rebuild.
// ---------------------------------------------------------------------------
Deno.test({
  name: "#2009 E3 — two SEQUENTIAL poisoned herds cost ONE build, because the first published a row",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const db = newDb();
    await herd("Sequentialville", [POISON], okReader(7), 300_000_000, db);
    await herd("Sequentialville", [POISON], okReader(7), 300_000_000 + 10_000, db);
    console.log(
      `#2009 E3 SEQUENTIAL x2 poisoned: builds=${db.builds} l2Rows=${db.cacheWrites.length}`,
    );
    assertEquals(
      db.builds,
      1,
      `DEFECT D-1: two sequential herds produced ${db.builds} builds. The first herd's L2 ` +
        `write was suppressed by the client's poisoned keyword, so nothing was there for the ` +
        `second to read — every later request pays a full rebuild for as long as the client ` +
        `keeps sending that field.`,
    );
    assertEquals(db.cacheWrites.length, 1, "exactly one readable row is published and then reused");
  },
});

// ---------------------------------------------------------------------------
// E4 — THE ONE-WAY PROPERTY. This is why D-1 is a P2 and not a P1, and it must
// survive the fix: no fail-closed request may EVER be classified cacheable.
// ---------------------------------------------------------------------------
Deno.test({
  name:
    "#2009 E4 — ONE-WAY: no adversarial client input can make a FAIL-CLOSED request look cacheable",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const read = failingReader();

    // Shapes chosen to attack the classification from the cacheable side: values
    // that look like a HEALTHY generation slot (`g<n>`), values that look like a
    // whole readable key fragment, casing variants, and the empty/degenerate
    // cases. If any of these could make `readable` true, a request whose
    // generation this isolate could not confirm would be served from — and
    // written into — a shared cache slot. That is the stale-privacy read #2009
    // exists to close.
    const shapes: ((i: number) => { city: string; keywords: string[] })[] = [
      (i) => ({ city: `Fuzz${i}`, keywords: [`g${i}`] }),
      (i) => ({ city: `g${i}`, keywords: [] }),
      (i) => ({ city: `Fuzz${i}`, keywords: [`"gen":"g${i}"`] }),
      (i) => ({ city: `Fuzz${i}`, keywords: [POISON, `g${i}`] }),
      (i) => ({ city: `Fuzz${i}`, keywords: [POISON.toUpperCase()] }),
      (i) => ({ city: `Fuzz${i}`, keywords: [`unavailable:${crypto.randomUUID()}`] }),
      (i) => ({ city: `discover:{"gen":"g${i}"}`, keywords: [] }),
      (i) => ({ city: `Fuzz${i}`, keywords: ["", " ", "unavailable:"] }),
    ];

    let classifiedCacheable = 0;
    let checked = 0;
    const uncacheableSample: boolean[] = [];

    for (let i = 0; i < FUZZ_KEYS; i++) {
      const shape = shapes[i % shapes.length](i);
      // A fresh `now` outside the 5s ceiling on every iteration, so the memo can
      // never short-circuit the read and hand back a stale `readable: true`.
      const now = 400_000_000 + i * 10_000;
      const { slot, readable } = await resolveDiscoveryGeneration(read, now);
      const key = buildDiscoverCacheKey(paramsFor(shape.city, shape.keywords, slot));
      checked += 1;
      if (readable) classifiedCacheable += 1;
      uncacheableSample.push(!readable);
      // The key must remain per-call unique in the fail-closed state, whatever
      // the client wrote — that uniqueness is what makes it unservable.
      assert(
        key.includes("unavailable:"),
        "a fail-closed key must carry the per-call-unique sentinel in its generation slot",
      );
    }

    console.log(
      `#2009 E4 ONE-WAY FUZZ: ${checked} fail-closed keys generated across ${shapes.length} ` +
        `adversarial client-input shapes -> ${classifiedCacheable} classified cacheable ` +
        `(must be 0), ${uncacheableSample.filter(Boolean).length} classified uncacheable`,
    );
    assertEquals(
      classifiedCacheable,
      0,
      `${classifiedCacheable} of ${checked} fail-closed requests were classified CACHEABLE. ` +
        `That is the one direction #2009 must never allow: a request whose generation this ` +
        `isolate could not confirm would be served from, and written into, a shared slot.`,
    );
    assertEquals(
      uncacheableSample.filter(Boolean).length,
      checked,
      "every fail-closed request must be classified uncacheable",
    );

    // ...and executed end to end, a fail-closed request must publish nothing,
    // however the client shaped the key. Classification alone could be right
    // while the guard it feeds was vacuous (#2113), so drive the real resolver.
    const db = newDb();
    const supabase = modelledSupabase(db, 0);
    let executedServed = 0;
    let executedShed = 0;
    for (let i = 0; i < FUZZ_EXECUTED; i++) {
      const shape = shapes[i % shapes.length](i);
      const now = 900_000_000 + i * 10_000;
      const { slot, readable } = await resolveDiscoveryGeneration(read, now);
      const key = buildDiscoverCacheKey(paramsFor(shape.city, shape.keywords, slot));
      try {
        await resolveDiscoverEntry(supabase, key, buildCtxFor(supabase, shape.city), !readable);
        executedServed += 1;
      } catch (err) {
        if (err instanceof DiscoverOverloadedError) executedShed += 1;
        else throw err;
      }
    }
    console.log(
      `#2009 E4 EXECUTED: ${FUZZ_EXECUTED} fail-closed requests driven through ` +
        `resolveDiscoverEntry -> ${db.cacheWrites.length} L2 row(s), ` +
        `${executedServed} served, ${executedShed} shed`,
    );
    assertEquals(
      db.cacheWrites.length,
      0,
      `${db.cacheWrites.length} L2 row(s) were published from a fail-closed build. Nothing ` +
        `can ever read a row keyed on a per-call uuid, so each one is permanent garbage in ` +
        `discover_merged_events_cache written exactly when the database can least absorb it.`,
    );
    assertEquals(
      executedServed,
      FUZZ_EXECUTED,
      "an uncontended fail-closed request is still SERVED — fail-closed costs a cache miss, " +
        "never availability",
    );
  },
});

// ---------------------------------------------------------------------------
// E5 — the slot-only view is a projection, not a second implementation.
// ---------------------------------------------------------------------------
Deno.test("#2009 E5 — resolveDiscoveryGenerationSlot returns exactly the pair's slot, readable and not", async () => {
  const t0 = 1_000_000_000;

  const viaSlot = await resolveDiscoveryGenerationSlot(okReader(88), t0);
  const viaPair = await resolveDiscoveryGeneration(okReader(88), t0 + 10_000);
  assertEquals(viaSlot, viaPair.slot, "the two entry points must agree on a readable generation");
  assertEquals(viaSlot, discoveryGenerationSlot(88), "and it must be the canonical slot");
  assert(viaPair.readable, "a generation that read cleanly must be reported readable");

  const badSlot = await resolveDiscoveryGenerationSlot(failingReader(), t0 + 20_000);
  const badPair = await resolveDiscoveryGeneration(failingReader(), t0 + 30_000);
  assert(badSlot.startsWith("unavailable:"), "a failed read still yields the fail-closed slot");
  assert(badPair.slot.startsWith("unavailable:"), "and so does the pair");
  assert(!badPair.readable, "a failed read must never be reported readable");
});
