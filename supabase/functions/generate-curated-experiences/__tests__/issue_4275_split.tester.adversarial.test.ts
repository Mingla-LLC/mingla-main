// Issue #4275 tester adversarial, split round — standard intents at 4 lookups per
// statement. The implementor proves the split and the count. This attacks the split
// itself: which chunk fails, what the handler then answers, what a PGRST202 does
// partway through, whether chunks ever overlap, and whether each row lands on the
// request it belongs to at every size.
//
// FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
//   - `start + row.request_index` back to `row.request_index`: XS-1 fails.
//   - chunks made parallel: XS-2 fails (two statements at once).
//   - a chunk failure carrying on to the next chunk: XS-3 fails.
//   - PGRST202 on a later chunk returning only what is left: XS-4 fails.
//   - STANDARD_INTENT_LOOKUPS_PER_BATCH back to 8: XS-6 fails on the recount.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createFakeBackend, curatedRequest, setCuratedEnv, SIX_TYPES } from "./_issue4275FakeBackend.ts";
import { fetchSinglesForSignalRankBatch, type SignalRankParams } from "../../_shared/signalRankFetch.ts";

setCuratedEnv();
const { handler } = await import("../index.ts");
const options = { sanitizeOps: false, sanitizeResources: false };

const params = (index: number): SignalRankParams => ({
  filterSignal: `f${index}`,
  filterMin: 120,
  rankSignal: "rank",
  centerLat: 35.78,
  centerLng: -78.64,
  radiusMeters: 3000,
  limit: 5,
});
const place = (id: string) => ({
  id,
  google_place_id: `g-${id}`,
  name: id,
  lat: 35.78,
  lng: -78.64,
  stored_photo_urls: [`https://example.test/${id}.jpg`],
  types: ["park"],
  primary_type: "park",
  ai_signal_scores: {},
});

type RpcAnswer = { data: unknown; error: { code: string; message: string } | null };

function client(batch: (chunkIndex: number, requests: Array<Record<string, unknown>>) => RpcAnswer | Promise<RpcAnswer>) {
  const calls = { batch: 0, hydrate: 0, single: 0, select: 0, sizes: [] as number[], signals: [] as string[][], inFlight: 0, peak: 0, order: [] as string[] };
  const c = {
    // deno-lint-ignore no-explicit-any
    rpc: async (name: string, args: any): Promise<RpcAnswer> => {
      if (name === "fetch_local_signal_ranked_batch") {
        const chunkIndex = calls.batch;
        calls.batch += 1;
        calls.order.push(`chunk${chunkIndex}`);
        calls.sizes.push(args.p_requests.length);
        calls.signals.push(args.p_requests.map((r: { p_filter_signal: string }) => r.p_filter_signal));
        calls.inFlight += 1;
        calls.peak = Math.max(calls.peak, calls.inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        const answer = await batch(chunkIndex, args.p_requests);
        calls.inFlight -= 1;
        return answer;
      }
      if (name === "fetch_feed_places_by_ids") {
        calls.hydrate += 1;
        calls.order.push("hydrate");
        return { data: args.p_ids.map(place), error: null };
      }
      calls.single += 1;
      return { data: [{ place_id: args.p_filter_signal, rank_score: 1 }], error: null };
    },
    from: () => ({
      select: () => ({
        in: (_column: string, ids: string[]) => {
          calls.select += 1;
          return Promise.resolve({ data: ids.map(place), error: null });
        },
      }),
    }),
  };
  // deno-lint-ignore no-explicit-any
  return { c: c as any, calls };
}

// Each row names the request it answers, so a wrong offset is visible.
const answerByName = (_chunk: number, requests: Array<Record<string, unknown>>): RpcAnswer => ({
  data: requests.map((request, request_index) => ({ request_index, place_id: request.p_filter_signal, rank_score: 1 })),
  error: null,
});

for (const size of [1, 2, 3, 4, 5, 7, 8, 12]) {
  for (const total of [1, 4, 5, 7, 8, 12]) {
    Deno.test(`XS-1 ${total} lookups at ${size} per statement: every result lands on its own request`, async () => {
      const { c, calls } = client(answerByName);
      const all = Array.from({ length: total }, (_, index) => params(index));
      const results = await fetchSinglesForSignalRankBatch(c, all, size);
      assertEquals(results.map((rows) => rows.map((row) => row.google_place_id)), all.map((_, index) => [`g-f${index}`]));
      assertEquals(calls.batch, Math.ceil(total / size));
      assertEquals(calls.signals.flat(), all.map((p) => p.filterSignal), "in input order");
      assertEquals(calls.hydrate, 1, "one hydrate however many statements");
    });
  }
}

Deno.test("XS-2 statements run one at a time and the hydrate comes last", async () => {
  const { c, calls } = client(answerByName);
  await fetchSinglesForSignalRankBatch(c, Array.from({ length: 8 }, (_, index) => params(index)), 4);
  assertEquals(calls.peak, 1, "never two statements from one intent at once");
  assertEquals(calls.order, ["chunk0", "chunk1", "hydrate"]);
  assertEquals(calls.sizes, [4, 4]);
});

Deno.test("XS-3 a timed-out chunk stops the rest: no later chunk, no hydrate, no fallback, the cause kept", async () => {
  const { c, calls } = client((chunk, requests) =>
    chunk === 1
      ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
      : answerByName(chunk, requests)
  );
  await assertRejects(() => fetchSinglesForSignalRankBatch(c, Array.from({ length: 12 }, (_, index) => params(index)), 4), Error, "statement timeout");
  assertEquals(calls.batch, 2, "the third chunk never ran");
  assertEquals(calls.hydrate, 0);
  assertEquals(calls.single, 0);
  assertEquals(calls.select, 0);
});

Deno.test("XS-4 PGRST202 on a later chunk: the whole group goes down the per-request path, once each", async () => {
  const { c, calls } = client((chunk, requests) =>
    chunk === 1
      ? { data: null, error: { code: "PGRST202", message: "not found" } }
      : answerByName(chunk, requests)
  );
  const warn = console.warn;
  console.warn = () => {};
  try {
    const all = Array.from({ length: 8 }, (_, index) => params(index));
    const results = await fetchSinglesForSignalRankBatch(c, all, 4);
    assertEquals(results.map((rows) => rows.map((row) => row.google_place_id)), all.map((_, index) => [`g-f${index}`]));
    assertEquals(calls.batch, 2, "no further batch call after the fallback");
    assertEquals(calls.single, 8, "first chunk's lookups repeat: the cost of the fallback");
    assertEquals(calls.select, 8);
    assertEquals(calls.hydrate, 0);
  } finally {
    console.warn = warn;
  }
});

for (const bad of [0, -1, 13, 1.5, Number.NaN]) {
  Deno.test(`XS-5 a size of ${bad} is refused before any request`, async () => {
    const { c, calls } = client(answerByName);
    await assertRejects(() => fetchSinglesForSignalRankBatch(c, [params(0)], bad), Error, "outside");
    assertEquals(calls.batch, 0);
  });
}

// ── Through the real handler ─────────────────────────────────────────────

async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  try {
    return await run();
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
}

Deno.test({ name: "XS-6 recount: a six-intent set is 19 ranked and 16 hydrates, and no statement over 10 lookups, none standard over 4", ...options, fn: async () => {
  const backend = createFakeBackend();
  backend.install();
  const perType: Record<string, number[]> = {};
  try {
    await quiet(async () => {
      for (const experienceType of SIX_TYPES) {
        const before = backend.batchSizes.length;
        await (await handler(curatedRequest({ experienceType, limit: 10000 }))).json();
        perType[experienceType] = backend.batchSizes.slice(before);
      }
    });
  } finally {
    backend.uninstall();
  }
  assertEquals(perType["adventurous"], [4, 3]);
  assertEquals(perType["first-date"], [4, 4]);
  assertEquals(perType["romantic"], [4]);
  assertEquals(perType["group-fun"], [4, 3]);
  assertEquals(perType["take-a-stroll"], [4]);
  assertEquals(perType["picnic-dates"], [1, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], "Picnic unchanged");
  assertEquals(backend.counts.ranked_batch, 19);
  assertEquals(backend.counts.hydrate_rpc, 16);
  assertEquals(backend.counts.ranked_single, undefined);
  assertEquals(backend.counts.hydrate_select, undefined);
  assertEquals(Object.values(perType).flat().reduce((sum, size) => sum + size, 0), 131, "the same 131 lookups");
} });

Deno.test({ name: "XS-7 what the person's phone receives when the second chunk times out: a 500 with no cards, for that intent", ...options, fn: async () => {
  const backend = createFakeBackend();
  backend.install();
  const inner = globalThis.fetch;
  let batches = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/rpc/fetch_local_signal_ranked_batch")) {
      batches += 1;
      if (batches === 2) {
        return new Response(JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout", details: null, hint: null }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }
    return inner(input, init);
  }) as typeof fetch;
  try {
    const response = await quiet(() => handler(curatedRequest({ experienceType: "first-date", limit: 200 })));
    const body = await response.json();
    assertEquals(response.status, 500);
    assertEquals(body.cards, []);
    assert(String(body.error).includes("statement timeout"));
    assertEquals(batches, 2);
    assertEquals(backend.counts.hydrate_rpc ?? 0, 0, "nothing hydrated for a failed intent");
  } finally {
    globalThis.fetch = inner;
    backend.uninstall();
  }
} });
