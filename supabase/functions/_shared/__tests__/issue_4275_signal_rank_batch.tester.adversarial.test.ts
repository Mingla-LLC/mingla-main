// Issue #4275 tester adversarial — fetchSinglesForSignalRankBatch against hostile
// server answers. The implementor's suite compares paths on clean data. This one
// feeds out-of-order rows, the same place in two requests with different scores,
// every error code an overloaded or half-migrated server can give, and rows that
// lost their hydrate.
//
// FAILS-ON-REVERT, each proven at the tester commit recorded on #4275:
//   - PGRST202 check widened to any error: AX-C4 fails (an overload would double
//     the load through the per-request path).
//   - PGRST202 branch removed from the hydrate call: AX-C5 fails.
//   - request-scoped exclusion made global: AX-C2 fails.
//   - rankScoreById shared across requests: AX-C3 fails.
//   - cap check removed: AX-C6 fails.
//   - allIds de-duplication removed: AX-C3 fails on the hydrate id count.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fetchSinglesForSignalRankBatch,
  SIGNAL_RANK_BATCH_MAX_REQUESTS,
  type SignalRankParams,
} from "../signalRankFetch.ts";

type Row = { request_index: number; place_id: string; rank_score: number };
type RpcError = { code: string; message: string };
type Answer = { data: unknown; error: RpcError | null };

function place(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    google_place_id: `g-${id}`,
    name: id,
    address: null,
    lat: 35.78,
    lng: -78.64,
    rating: 4,
    review_count: 10,
    price_level: null,
    price_range_start_cents: null,
    price_range_end_cents: null,
    opening_hours: null,
    website: null,
    stored_photo_urls: [`https://example.test/${id}.jpg`],
    types: ["park"],
    primary_type: "park",
    utc_offset_minutes: -300,
    city_id: null,
    city: "C",
    country: "US",
    ai_signal_scores: { rank_a: { reasoning: `a-${id}` }, rank_b: { reasoning: `b-${id}` } },
    ...overrides,
  };
}

function fakeClient(handlers: {
  batch?: (requests: unknown[]) => Answer;
  hydrate?: (ids: string[]) => Answer;
  single?: () => Answer;
  select?: () => Answer;
}) {
  const calls = { batch: 0, hydrate: 0, single: 0, select: 0, hydrateIds: [] as string[][] };
  return {
    calls,
    client: {
      // deno-lint-ignore no-explicit-any
      rpc: (name: string, args: any): Promise<Answer> => {
        if (name === "fetch_local_signal_ranked_batch") {
          calls.batch += 1;
          return Promise.resolve(handlers.batch?.(args.p_requests) ?? { data: [], error: null });
        }
        if (name === "fetch_feed_places_by_ids") {
          calls.hydrate += 1;
          calls.hydrateIds.push(args.p_ids);
          return Promise.resolve(handlers.hydrate?.(args.p_ids) ?? { data: [], error: null });
        }
        calls.single += 1;
        return Promise.resolve(handlers.single?.() ?? { data: [], error: null });
      },
      from: () => ({
        select: () => ({
          in: () => {
            calls.select += 1;
            return Promise.resolve(handlers.select?.() ?? { data: [], error: null });
          },
        }),
      }),
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

const params = (overrides: Partial<SignalRankParams> = {}): SignalRankParams => ({
  filterSignal: "nature",
  filterMin: 120,
  rankSignal: "rank_a",
  centerLat: 35.78,
  centerLng: -78.64,
  radiusMeters: 3000,
  limit: 20,
  ...overrides,
});

const hydrateAll = (ids: string[]): Answer => ({ data: ids.map((id) => place(id)), error: null });

Deno.test("AX-C1 rows out of order and rows for an index nobody asked for do not move or crash results", async () => {
  const { client } = fakeClient({
    batch: () => ({
      data: [
        { request_index: 1, place_id: "b1", rank_score: 5 },
        { request_index: 0, place_id: "a1", rank_score: 1 },
        { request_index: 99, place_id: "ghost", rank_score: 100 },
        { request_index: 0, place_id: "a2", rank_score: 9 },
        { request_index: 1, place_id: "b2", rank_score: 7 },
      ] as Row[],
      error: null,
    }),
    hydrate: hydrateAll,
  });
  const [first, second] = await fetchSinglesForSignalRankBatch(client, [params(), params()]);
  assertEquals(first.map((p) => p.google_place_id), ["g-a2", "g-a1"], "highest score first, in its own request");
  assertEquals(second.map((p) => p.google_place_id), ["g-b2", "g-b1"]);
});

Deno.test("AX-C2 an exclusion stays with its own request", async () => {
  const { client } = fakeClient({
    batch: () => ({
      data: [
        { request_index: 0, place_id: "shared", rank_score: 5 },
        { request_index: 1, place_id: "shared", rank_score: 5 },
      ] as Row[],
      error: null,
    }),
    hydrate: hydrateAll,
  });
  const [first, second] = await fetchSinglesForSignalRankBatch(client, [
    params({ excludePlaceIds: ["shared"] }),
    params(),
  ]);
  assertEquals(first.length, 0);
  assertEquals(second.length, 1);
});

Deno.test("AX-C3 one place in two requests keeps each request's score and reasoning, hydrated once", async () => {
  const { client, calls } = fakeClient({
    batch: () => ({
      data: [
        { request_index: 0, place_id: "shared", rank_score: 11 },
        { request_index: 1, place_id: "shared", rank_score: 77 },
      ] as Row[],
      error: null,
    }),
    hydrate: hydrateAll,
  });
  const [first, second] = await fetchSinglesForSignalRankBatch(client, [
    params({ rankSignal: "rank_a" }),
    params({ rankSignal: "rank_b" }),
  ]);
  assertEquals(calls.hydrateIds, [["shared"]]);
  // deno-lint-ignore no-explicit-any
  const a = first[0] as any, b = second[0] as any;
  assertEquals(a._rankScore, 11);
  assertEquals(b._rankScore, 77);
  assert(JSON.stringify(a).includes("a-shared") && !JSON.stringify(a).includes("b-shared"), "own reasoning slice only");
  assert(JSON.stringify(b).includes("b-shared") && !JSON.stringify(b).includes("a-shared"), "own reasoning slice only");
});

for (const code of ["57014", "42501", "PGRST203", "PGRST301", "PGRST000", "XX000", "42883"]) {
  Deno.test(`AX-C4 ${code} from the batch throws and never falls back to the per-request path`, async () => {
    const { client, calls } = fakeClient({ batch: () => ({ data: null, error: { code, message: `boom ${code}` } }) });
    const error = await assertRejects(() => fetchSinglesForSignalRankBatch(client, [params(), params()]), Error);
    assert((error as Error).message.includes(`boom ${code}`), "the cause stays in the message");
    assertEquals(calls.single, 0, "an overloaded database must not get 2 more requests per lookup");
    assertEquals(calls.select, 0);
  });
}

Deno.test("AX-C5 batch live but hydrate not yet: the per-request path answers, and only then", async () => {
  const { client, calls } = fakeClient({
    batch: () => ({ data: [{ request_index: 0, place_id: "a1", rank_score: 5 }] as Row[], error: null }),
    hydrate: () => ({ data: null, error: { code: "PGRST202", message: "not found" } }),
    single: () => ({ data: [{ place_id: "a1", rank_score: 5 }], error: null }),
    select: () => ({ data: [place("a1")], error: null }),
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const [result] = await fetchSinglesForSignalRankBatch(client, [params()]);
    assertEquals(result.map((p) => p.google_place_id), ["g-a1"]);
    assertEquals(calls.single, 1);
    assertEquals(calls.select, 1);
  } finally {
    console.warn = warn;
  }
});

Deno.test("AX-C5 a hydrate timeout throws and makes no extra requests", async () => {
  const { client, calls } = fakeClient({
    batch: () => ({ data: [{ request_index: 0, place_id: "a1", rank_score: 5 }] as Row[], error: null }),
    hydrate: () => ({ data: null, error: { code: "57014", message: "statement timeout" } }),
  });
  await assertRejects(() => fetchSinglesForSignalRankBatch(client, [params()]), Error, "statement timeout");
  assertEquals(calls.single, 0);
  assertEquals(calls.select, 0);
});

Deno.test("AX-C6 over either cap fails before any request reaches the database", async () => {
  const over = fakeClient({});
  await assertRejects(
    () => fetchSinglesForSignalRankBatch(over.client, Array.from({ length: SIGNAL_RANK_BATCH_MAX_REQUESTS + 1 }, () => params({ limit: 1 }))),
    Error,
    "exceeds the batch caps",
  );
  // 501 * 2 = 1002 rows: PostgREST would silently cut the answer at 1000.
  await assertRejects(() => fetchSinglesForSignalRankBatch(over.client, [params({ limit: 501 })]), Error, "exceeds the batch caps");
  assertEquals(over.calls.batch, 0);

  const edge = fakeClient({});
  await fetchSinglesForSignalRankBatch(edge.client, [params({ limit: 500 })]);
  assertEquals(edge.calls.batch, 1, "exactly 1000 rows is allowed");
});

Deno.test("AX-C7 empty input and all-empty answers make the fewest requests and keep positions", async () => {
  const none = fakeClient({});
  assertEquals(await fetchSinglesForSignalRankBatch(none.client, []), []);
  assertEquals(none.calls.batch, 0);

  const empty = fakeClient({ batch: () => ({ data: null, error: null }) });
  assertEquals(await fetchSinglesForSignalRankBatch(empty.client, [params(), params(), params()]), [[], [], []]);
  assertEquals(empty.calls.hydrate, 0, "nothing to hydrate");
});

Deno.test("AX-C8 a row whose place vanished or failed the photo gate costs only that row", async () => {
  const { client } = fakeClient({
    batch: () => ({
      data: [
        { request_index: 0, place_id: "gone", rank_score: 9 },
        { request_index: 0, place_id: "nophoto", rank_score: 8 },
        { request_index: 0, place_id: "failedphoto", rank_score: 7 },
        { request_index: 0, place_id: "ok", rank_score: 6 },
      ] as Row[],
      error: null,
    }),
    hydrate: () => ({
      data: [
        place("nophoto", { stored_photo_urls: [] }),
        place("failedphoto", { stored_photo_urls: ["__backfill_failed__"] }),
        place("ok"),
      ],
      error: null,
    }),
  });
  const [result] = await fetchSinglesForSignalRankBatch(client, [params()]);
  assertEquals(result.map((p) => p.google_place_id), ["g-ok"]);
});
