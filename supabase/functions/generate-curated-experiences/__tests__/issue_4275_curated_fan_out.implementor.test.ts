// Issue #4275 Part C — the curated function's fan-out, driven through the real
// handler over a counting fake PostgREST.
//
// invariant: I-FEED-BATCHED-LOOKUPS — the curated function makes no per-category or
// per-anchor RPC. Cards stay the same.
//
// FAILS-ON-REVERT: fetch near data one anchor at a time and T-C2 fails on the
// request count. Put `photos` back in the hydrate columns and T-C6 fails. Remove the
// PGRST202 branch and T-C4 fails. Remove the anchors-exhausted break and T-C5 fails.
// Put the auth.getUser block back and "no auth call" fails.

import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  comparableCards,
  createFakeBackend,
  curatedRequest,
  LIMITS,
  setCuratedEnv,
  SIX_TYPES,
} from "./_issue4275FakeBackend.ts";
import {
  fetchSinglesForSignalRank,
  fetchSinglesForSignalRankBatch,
  type SignalRankParams,
} from "../../_shared/signalRankFetch.ts";

setCuratedEnv();
const { handler } = await import("../index.ts");

// The handler's teaser and phone work carries on after the response by design.
const options = { sanitizeOps: false, sanitizeResources: false };
const plainTest = (name: string, fn: () => void | Promise<void>) => Deno.test({ name, ...options, fn });

async function generate(body: Record<string, unknown>) {
  const response = await handler(curatedRequest(body));
  const json = await response.json();
  assertEquals(response.status, 200, JSON.stringify(json).slice(0, 300));
  return json as { cards: Array<Record<string, unknown>>; summary?: { emptyReason: string } };
}

async function withBackend<T>(backend: ReturnType<typeof createFakeBackend>, run: () => Promise<T>): Promise<T> {
  backend.install();
  const realLog = console.log;
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.log = realLog;
    backend.uninstall();
  }
}

for (const experienceType of SIX_TYPES) {
  for (const limit of LIMITS) {
    Deno.test({
      name: `T-C1 ${experienceType} limit ${limit}: batch and per-request paths give the same cards`,
      ...options,
      fn: async () => {
        const batch = createFakeBackend();
        const perRequest = createFakeBackend({ batchRpcLive: false });
        const realWarn = console.warn;
        console.warn = () => {};
        try {
          const viaBatch = await withBackend(batch, () => generate({ experienceType, limit }));
          const viaSingle = await withBackend(perRequest, () => generate({ experienceType, limit }));
          assert(viaBatch.cards.length > 0, "the fixture must build cards");
          assertEquals(comparableCards(viaBatch.cards), comparableCards(viaSingle.cards));
        } finally {
          console.warn = realWarn;
        }
      },
    });
  }
}

Deno.test({ name: "T-C2 picnic with 50 anchors: 11 batch and 11 hydrate calls, no single lookups", ...options, fn: async () => {
  const backend = createFakeBackend();
  const { cards } = await withBackend(backend, () => generate({ experienceType: "picnic-dates", limit: 10000 }));
  assert(cards.length > 0);
  assertEquals(backend.counts.ranked_batch, 11, "1 anchor batch + 10 near batches of 5 anchors");
  assertEquals(backend.counts.hydrate_rpc, 11);
  assertEquals(backend.counts.ranked_single, undefined);
  assertEquals(backend.counts.hydrate_select, undefined);
  assertEquals(backend.maxBatch(), 10, "5 anchors x 2 categories");
} });

Deno.test({ name: "T-C2 picnic limit 5 needs one near batch; limit 2 fetches only 2 anchors' near data", ...options, fn: async () => {
  const five = createFakeBackend();
  const fiveResult = await withBackend(five, () => generate({ experienceType: "picnic-dates", limit: 5 }));
  assertEquals(fiveResult.cards.length, 5);
  assertEquals(five.counts.ranked_batch, 2, "anchors, then one near batch");
  assertEquals(five.batchSizes, [1, 10]);

  const two = createFakeBackend();
  await withBackend(two, () => generate({ experienceType: "picnic-dates", limit: 2 }));
  assertEquals(two.batchSizes, [1, 4], "2 anchors x 2 categories");
} });

Deno.test({ name: "T-C2 a standard type is one batch and one hydrate", ...options, fn: async () => {
  const backend = createFakeBackend();
  await withBackend(backend, () => generate({ experienceType: "first-date", limit: 10000 }));
  assertEquals(backend.counts.ranked_batch, 1);
  assertEquals(backend.counts.hydrate_rpc, 1);
  assertEquals(backend.batchSizes, [8]);
  assertEquals(backend.counts.ranked_single, undefined);
} });

Deno.test({ name: "SC-C1 a six-intent set is 16 ranked and 16 hydrate requests, and no auth call", ...options, fn: async () => {
  const backend = createFakeBackend();
  await withBackend(backend, async () => {
    for (const experienceType of SIX_TYPES) await generate({ experienceType, limit: 10000 });
  });
  assertEquals(backend.counts.ranked_batch, 5 + 11);
  assertEquals(backend.counts.hydrate_rpc, 5 + 11);
  assertEquals(backend.counts.auth_get_user, undefined, "the unused auth.getUser is gone");
} });

// ── Unit level: the shared shaper over a stub client ─────────────────────

type Row = Record<string, unknown>;
function place(id: string, extra: Row = {}): Row {
  return {
    id,
    google_place_id: `g-${id}`,
    name: id,
    address: "a",
    lat: 1,
    lng: 2,
    rating: 4,
    review_count: 1,
    price_level: null,
    price_range_start_cents: 1000,
    price_range_end_cents: 2000,
    opening_hours: null,
    website: null,
    stored_photo_urls: [`https://example.test/${id}.jpg`],
    types: ["t"],
    primary_type: "t",
    utc_offset_minutes: 0,
    city_id: null,
    city: "c",
    country: "n",
    ai_signal_scores: { romantic: { reasoning: `romantic ${id}` }, lively: { reasoning: `lively ${id}` } },
    ...extra,
  };
}

const PLACES: Record<string, Row> = {
  a: place("a"),
  b: place("b"),
  c: place("c"),
  nophoto: place("nophoto", { stored_photo_urls: [] }),
  failed: place("failed", { stored_photo_urls: ["__backfill_failed__"] }),
};

function stubClient(rowsByFilter: Record<string, Array<{ place_id: string; rank_score: number }>>, live = { batch: true, hydrate: true }) {
  const calls: Array<{ name: string; args: Row }> = [];
  const selects: string[] = [];
  return {
    calls,
    selects,
    rpc(name: string, args: Row) {
      calls.push({ name, args });
      const missing = { data: null, error: { code: "PGRST202", message: "not found" } };
      if (name === "fetch_local_signal_ranked_batch") {
        if (!live.batch) return Promise.resolve(missing);
        const data = (args.p_requests as Row[]).flatMap((request, request_index) =>
          (rowsByFilter[request.p_filter_signal as string] ?? []).map((row) => ({ request_index, ...row }))
        );
        return Promise.resolve({ data, error: null });
      }
      if (name === "fetch_local_signal_ranked") {
        return Promise.resolve({ data: rowsByFilter[args.p_filter_signal as string] ?? [], error: null });
      }
      if (name === "fetch_feed_places_by_ids") {
        if (!live.hydrate) return Promise.resolve(missing);
        return Promise.resolve({ data: (args.p_ids as string[]).map((id) => PLACES[id]), error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from() {
      return {
        select: (columns: string) => {
          selects.push(columns);
          return {
            in: (_column: string, ids: string[]) => Promise.resolve({ data: ids.map((id) => PLACES[id]), error: null }),
          };
        },
      };
    },
  };
}

const params = (filterSignal: string, rankSignal: string, extra: Partial<SignalRankParams> = {}): SignalRankParams => ({
  filterSignal,
  filterMin: 0,
  rankSignal,
  centerLat: 35,
  centerLng: -78,
  radiusMeters: 3000,
  limit: 20,
  ...extra,
});

const RANKED = {
  one: [{ place_id: "a", rank_score: 90 }, { place_id: "nophoto", rank_score: 80 }, { place_id: "b", rank_score: 70 }],
  two: [{ place_id: "b", rank_score: 95 }, { place_id: "failed", rank_score: 85 }, { place_id: "a", rank_score: 15 }, { place_id: "c", rank_score: 5 }],
  three: [],
};

plainTest("T-C3 each request keeps its own exclusions, photo gate, reasoning slice, score and limit", async () => {
  // deno-lint-ignore no-explicit-any
  const client = stubClient(RANKED) as any;
  const requests = [
    params("one", "romantic"),
    params("two", "lively", { excludePlaceIds: ["a"], limit: 1 }),
    params("three", "romantic"),
  ];
  const [one, two, three] = await fetchSinglesForSignalRankBatch(client, requests);

  assertEquals(one.map((r) => r.id), ["a", "b"], "the photo gate dropped nophoto");
  assertEquals(one[0]._rankScore, 90);
  assertEquals(one[1]._rankScore, 70, "a place keeps this request's own score");
  assertEquals(one[0].aiReasoningBySignal, { romantic: "romantic a" });

  assertEquals(two.map((r) => r.id), ["b"], "excluded a, failed photo, limit 1");
  assertEquals(two[0]._rankScore, 95, "the same place, another request, its own score");
  assertEquals(two[0].aiReasoningBySignal, { lively: "lively b" });

  assertEquals(three, []);

  // Exactly what the single path returns for the same requests.
  for (let i = 0; i < requests.length; i += 1) {
    assertEquals(await fetchSinglesForSignalRank(client, requests[i]), [one, two, three][i]);
  }
});

plainTest("T-C3 p_limit stays limit * 2 and the arguments match the single path", async () => {
  // deno-lint-ignore no-explicit-any
  const client = stubClient(RANKED) as any;
  const request = params("one", "romantic", { requiredTypes: ["x"], primaryTypeRequired: ["y"], groceryFloralTag: true });
  await fetchSinglesForSignalRankBatch(client, [request]);
  await fetchSinglesForSignalRank(client, request);
  const batchArgs = (client.calls.find((c: { name: string }) => c.name === "fetch_local_signal_ranked_batch").args.p_requests as Row[])[0];
  const singleArgs = client.calls.find((c: { name: string }) => c.name === "fetch_local_signal_ranked").args;
  assertEquals(batchArgs, singleArgs);
  assertEquals(batchArgs.p_limit, 40);
});

plainTest("T-C3 one hydrate for the union of ids, none when nothing ranked", async () => {
  // deno-lint-ignore no-explicit-any
  const client = stubClient(RANKED) as any;
  await fetchSinglesForSignalRankBatch(client, [params("one", "romantic"), params("two", "lively")]);
  const hydrates = client.calls.filter((c: { name: string }) => c.name === "fetch_feed_places_by_ids");
  assertEquals(hydrates.length, 1);
  assertEquals(new Set(hydrates[0].args.p_ids).size, hydrates[0].args.p_ids.length, "no id twice");

  // deno-lint-ignore no-explicit-any
  const emptyClient = stubClient({}) as any;
  assertEquals(await fetchSinglesForSignalRankBatch(emptyClient, [params("none", "romantic")]), [[]]);
  assertEquals(emptyClient.calls.length, 1, "ranked only");
  assertEquals(await fetchSinglesForSignalRankBatch(emptyClient, []), []);
});

plainTest("the batch refuses what the database or PostgREST would refuse or truncate", async () => {
  // deno-lint-ignore no-explicit-any
  const client = stubClient({}) as any;
  await assertRejects(
    () => fetchSinglesForSignalRankBatch(client, Array.from({ length: 13 }, () => params("x", "x", { limit: 1 }))),
    Error,
    "exceeds the batch caps",
  );
  await assertRejects(
    () => fetchSinglesForSignalRankBatch(client, [params("x", "x", { limit: 501 })]),
    Error,
    "exceeds the batch caps",
  );
  assertEquals(client.calls.length, 0);
});

for (const live of [{ batch: false, hydrate: true }, { batch: true, hydrate: false }]) {
  plainTest(`T-C4 PGRST202 (batch live: ${live.batch}, hydrate live: ${live.hydrate}): warn, per-request path, same cards`, async () => {
    const warnings: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      const requests = [params("one", "romantic"), params("two", "lively")];
      // deno-lint-ignore no-explicit-any
      const expected = await fetchSinglesForSignalRankBatch(stubClient(RANKED) as any, requests);
      // deno-lint-ignore no-explicit-any
      const fallback = await fetchSinglesForSignalRankBatch(stubClient(RANKED, live) as any, requests);
      assertEquals(fallback, expected);
      assert(warnings.some((line) => line.includes("per-request path")), "the fallback is audible");
    } finally {
      console.warn = realWarn;
    }
  });
}

plainTest("T-C4 any other error throws, and is not mistaken for a missing function", async () => {
  // deno-lint-ignore no-explicit-any
  const client = { rpc: () => Promise.resolve({ data: null, error: { code: "57014", message: "statement timeout" } }) } as any;
  await assertRejects(() => fetchSinglesForSignalRankBatch(client, [params("x", "x")]), Error, "statement timeout");
});

Deno.test({ name: "T-C5 anchors exhausted: the loop breaks instead of spinning through every combo", ...options, fn: () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  assert(/if \(anchorPlaces\.length === 0\) \{\s*break;/.test(source), "the anchors-exhausted branch breaks");
} });

Deno.test({ name: "T-C5 with no anchors at all the type reports pool_empty", ...options, fn: async () => {
  const backend = createFakeBackend();
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await withBackend(backend, () =>
      generate({ experienceType: "picnic-dates", limit: 5, location: { lat: 10, lng: 10 } }));
    assertEquals(result.cards.length, 0);
    assertEquals(result.summary?.emptyReason, "pool_empty");
    assertEquals(backend.counts.ranked_batch, 1, "nothing near a non-existent anchor");
  } finally {
    console.warn = realWarn;
  }
} });

plainTest("T-C6 the hydrate selects every curated column and no photos", async () => {
  // deno-lint-ignore no-explicit-any
  const client = stubClient(RANKED) as any;
  await fetchSinglesForSignalRank(client, params("one", "romantic"));
  const columns = client.selects[0].split(", ");
  assert(!columns.includes("photos"), "photos is back in the hydrate");
  for (const column of [
    "id", "google_place_id", "name", "address", "lat", "lng", "rating", "review_count", "price_level",
    "price_range_start_cents", "price_range_end_cents", "opening_hours", "website", "stored_photo_urls", "types",
    "primary_type", "utc_offset_minutes", "city_id", "city", "country", "ai_signal_scores",
  ]) {
    assert(columns.includes(column), `${column} missing`);
  }
});

Deno.test({ name: "source: logged from an allowlist, and nothing else from the body", ...options, fn: async () => {
  const lines: string[] = [];
  const backend = createFakeBackend();
  backend.install();
  const realLog = console.log;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    await generate({ experienceType: "romantic", limit: 5, source: "deck" });
    await generate({ experienceType: "romantic", limit: 5, source: "../../etc/passwd secret" });
    await generate({ experienceType: "romantic", limit: 5 });
  } finally {
    console.log = realLog;
    backend.uninstall();
  }
  const generating = lines.filter((line) => line.includes("[curated-v2] Generating"));
  assertEquals(generating.map((line) => line.match(/source: ([^)]*)\)/)?.[1]), ["deck", "unknown", "unknown"]);
  assert(!lines.some((line) => line.includes("passwd")), "an untrusted body value reached the log");
} });

plainTest("I-FEED-BATCHED-LOOKUPS: the curated function has no single-lookup path of its own", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  assert(!/fetchSinglesForSignalRank\(/.test(source), "no per-category or per-anchor lookup");
  assert(!/poolUserId/.test(source), "the unused auth lookup stays gone");
  const hero = Deno.readTextFileSync(new URL("../../_shared/personHeroCards.ts", import.meta.url));
  assert(/source: "hero"/.test(hero), "hero cards name themselves");
  const discover = Deno.readTextFileSync(new URL("../../discover-cards/index.ts", import.meta.url));
  assert(/source: 'collab'/.test(discover), "collab names itself");
});
