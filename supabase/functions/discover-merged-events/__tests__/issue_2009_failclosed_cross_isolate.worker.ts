// issue #2009 — ONE ISOLATE, for the AMENDMENT 3C cross-isolate proof.
//
// Not a test file. This module is loaded by
// `issue_2009_failclosed_cross_isolate.rework.test.ts` inside a Deno `Worker`,
// which is a genuinely separate V8 isolate: its own module graph, so its own
// `_memory-cache.ts` L1 map, its own single-flight map and its own
// `_cache.ts` generation memo. Nothing in this file is shared with the test
// process except messages.
//
// That separation is the whole point. AMENDMENT 3B collapsed the fail-closed
// herd WITHIN an isolate by keying the in-memory single-flight map on the
// coalescing namespace. Whether N isolates also collapse to one build is a
// question only the DATABASE can answer, so the harness puts the database in
// the parent process and lets every isolate reach it only through this stub.
//
// The stub is deliberately dumb: it forwards the exact call shape
// `_resolve-entry.ts` / `_distributed-cache.ts` / `_build-response.ts` make and
// returns whatever the parent's database model answers. It contains no #2009
// logic, so it cannot decide the outcome the test is measuring.

import {
  buildDiscoverCacheKey,
  type DiscoverCacheParams,
  discoveryGenerationSlot,
} from "../_cache.ts";
import { resolveDiscoverEntry } from "../_resolve-entry.ts";

/**
 * Minted once per module INSTANTIATION. The test asserts these are all distinct,
 * which is the executed evidence that the workers really are separate isolates
 * with separate module state — i.e. that the collapse it measures cannot have
 * come from the isolate-local single-flight map.
 */
const ISOLATE_ID = crypto.randomUUID();

const BASE: Omit<DiscoverCacheParams, "discoveryGeneration"> = {
  cityName: "Crossisolateville",
  stateCode: null,
  countryCode: "NG",
  page: 1,
  size: 20,
  partyTypeSlugs: [],
  vibeTagSlugs: [],
  musicGenreSlugs: [],
  dateWindowUtc: null,
  timezone: "Africa/Lagos",
};

// ---------------------------------------------------------------------------
// The database, reached over postMessage. One round-trip per call, awaited.
// ---------------------------------------------------------------------------
let seq = 0;
const pending = new Map<number, (value: unknown) => void>();

/**
 * `deno test <directory>` collects every `.ts` file under a `__tests__/` folder,
 * this one included — and in the main thread `self.postMessage` does not exist,
 * so an unguarded top-level post would fail the whole directory run with an
 * uncaught error that has nothing to do with #2009. Posting through this guard
 * makes the module INERT outside a worker instead of a landmine for any future
 * whole-directory run.
 */
function post(message: unknown): void {
  const target = self as unknown as { postMessage?: (m: unknown) => void };
  if (typeof target.postMessage !== "function") return;
  target.postMessage(message);
}

const IN_WORKER = typeof (self as unknown as { postMessage?: unknown }).postMessage ===
  "function";

// deno-lint-ignore no-explicit-any
function db(op: Record<string, unknown>): Promise<any> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve as (value: unknown) => void);
    post({ type: "db", id, op });
  });
}

/** The PostgREST-ish chain `_distributed-cache.ts` actually builds. */
// deno-lint-ignore no-explicit-any
function table(name: string): any {
  const ops: unknown[][] = [];
  // deno-lint-ignore no-explicit-any
  const chain: any = {
    select: (columns: string) => (ops.push(["select", columns]), chain),
    eq: (column: string, value: unknown) => (ops.push(["eq", column, value]), chain),
    gt: (column: string, value: unknown) => (ops.push(["gt", column, value]), chain),
    lt: (column: string, value: unknown) => (ops.push(["lt", column, value]), chain),
    delete: () => (ops.push(["delete"]), chain),
    upsert: (row: unknown, options: unknown) => (ops.push(["upsert", row, options]), chain),
    maybeSingle: () => db({ kind: "table", table: name, ops: [...ops, ["maybeSingle"]] }),
    // The write paths `await` the builder itself rather than a terminator.
    // deno-lint-ignore no-explicit-any
    then: (onOk: any, onErr: any) => db({ kind: "table", table: name, ops }).then(onOk, onErr),
  };
  return chain;
}

// deno-lint-ignore no-explicit-any
const supabase: any = {
  from: (name: string) => table(name),
  rpc: (name: string, args: unknown) => db({ kind: "rpc", name, args }),
  functions: {
    invoke: (name: string, options: unknown) => db({ kind: "invoke", name, options }),
  },
};

const buildCtx = {
  supabase,
  cityName: BASE.cityName,
  city: {},
  page: BASE.page,
  size: BASE.size,
  partyTypeSlugs: BASE.partyTypeSlugs,
  vibeTagSlugs: BASE.vibeTagSlugs,
  musicGenreSlugs: BASE.musicGenreSlugs,
  dateWindowUtc: BASE.dateWindowUtc,
  // deno-lint-ignore no-explicit-any
} as any;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data;

  if (message.type === "db-result") {
    const resolve = pending.get(message.id);
    pending.delete(message.id);
    resolve?.(message.result);
    return;
  }

  if (message.type !== "go") return;

  // The slot is minted HERE, inside this isolate, exactly as `index.ts` mints
  // it — so a fail-closed run really does produce N independently-generated
  // per-call-unique cache keys, one per isolate, not N copies of one string.
  const discoveryGeneration = message.failClosed
    ? discoveryGenerationSlot(null)
    : discoveryGenerationSlot(message.generation);
  const cacheKey = buildDiscoverCacheKey({ ...BASE, discoveryGeneration });

  try {
    const entry = await resolveDiscoverEntry(supabase, cacheKey, buildCtx);
    post({
      type: "done",
      isolate: ISOLATE_ID,
      served: true,
      cacheKey,
      itemCount: entry.response.items.length,
    });
  } catch (err) {
    post({
      type: "done",
      isolate: ISOLATE_ID,
      served: false,
      cacheKey,
      errorName: err instanceof Error ? err.name : String(err),
    });
  }
};

if (IN_WORKER) post({ type: "ready", isolate: ISOLATE_ID });
