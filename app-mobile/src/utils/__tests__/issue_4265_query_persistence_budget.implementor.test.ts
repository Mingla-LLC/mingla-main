// @ts-nocheck — Deno-discovered suite; app-mobile's tsc sweep has no Deno globals,
// URL imports or allowImportingTsExtensions, while the deno-2-unit lane executes it directly.
/* eslint-disable import/no-unresolved -- Deno-discovered suite; Expo ESLint does not resolve URL imports. */
//
// #4265 — the persisted React Query cache keeps every query that fits and drops
// only the largest, instead of the startup guard deleting the whole cache.
//
// Measured on the iOS simulator's signed-in account: REACT_QUERY_OFFLINE_CACHE was
// 1,872,829 characters (deck-cards 1,191,452, savedCards 807,848, 13 small queries
// ~50 KB). The old guard removed it on every launch (> 1.5 MB), so no cold start
// ever restored a cache.
//
// The budget is UTF-8 bytes (Android's AsyncStorage limit), not characters.
//
// FAILS-ON-REVERT: make serializePersistedClientWithinBudget keep every query (or
// write JSON.stringify(client)) → B-1/B-2 fail; measure `.length` (characters)
// instead of utf8ByteLength → B-8/B-9 fail; restore the wipe-all guard in
// app/_layout.tsx → B-6 fails; persist deck-cards again → B-7 fails.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  PERSISTED_CACHE_BUDGET_BYTES,
  prunePersistedCacheString,
  serializePersistedClientWithinBudget,
  serializePersistedQuery,
  utf8ByteLength,
} from "../queryPersistenceBudget.ts";
import { shouldDehydrateMinglaQuery } from "../queryPersistence.ts";

const root = new URL("../../../", import.meta.url);
const read = (rel: string): string => Deno.readTextFileSync(new URL(rel, root));

const blob = (chars: number): string => "x".repeat(chars);

function query(key: unknown[], data: unknown, extra: Record<string, unknown> = {}) {
  return {
    dehydratedAt: 1_793_758_510_000,
    queryKey: key,
    queryHash: JSON.stringify(key),
    state: { data, dataUpdatedAt: 1_793_758_500_000, status: "success", fetchStatus: "idle", error: null, ...extra },
  };
}

// The shape the simulator cache had: two huge entries and many small ones.
function simulatorLikeClient() {
  const user = "c727d491-4884-4e72-b467-d6c124b9a8b9";
  return {
    timestamp: 1_793_758_510_361,
    buster: "",
    clientState: {
      mutations: [],
      queries: [
        query(["deck-cards", "solo", 35.78, -78.638], { cards: [{ id: "a", stops: blob(1_190_000) }] }),
        query(["savedCards", "list", user], [{ id: "s", openingHours: blob(806_000) }]),
        query(["userPreferences", user], { discover_city_name: "Raleigh" }),
        query(["friends", "list", user], [{ id: "f1" }, { id: "f2" }]),
        query(["purchases", "lastClaim", user], { at: 1 }),
        query(["discover-last-city", user], { city: { name: "Raleigh", lat: 35.78, lng: -78.64 }, source: "device" }),
      ],
    },
  };
}

Deno.test("#4265 B-1 an oversized cache keeps every small query and drops only the largest", () => {
  const client = simulatorLikeClient();
  const result = serializePersistedClientWithinBudget(client);
  assert(utf8ByteLength(result.serialized) <= PERSISTED_CACHE_BUDGET_BYTES, `wrote ${utf8ByteLength(result.serialized)} bytes`);
  assertEquals(result.dropped.map((entry) => JSON.parse(entry.queryHash)[0]), ["deck-cards"]);
  const kept = JSON.parse(result.serialized).clientState.queries.map((q) => q.queryKey[0]);
  assertEquals(kept, ["savedCards", "userPreferences", "friends", "purchases", "discover-last-city"]);
});

Deno.test("#4265 B-2 under budget the output is exactly the client, in order", () => {
  const client = simulatorLikeClient();
  client.clientState.queries = client.clientState.queries.slice(2);
  const result = serializePersistedClientWithinBudget(client);
  assertEquals(result.dropped, []);
  assertEquals(JSON.parse(result.serialized), JSON.parse(JSON.stringify(client)));
});

Deno.test("#4265 B-3 one query serialises to the same JSON as JSON.stringify, with or without data", () => {
  const withData = query(["k", 1], { nested: [1, "two", null, { three: true }] });
  assertEquals(JSON.parse(serializePersistedQuery(withData)), JSON.parse(JSON.stringify(withData)));
  const pending = { queryKey: ["p"], queryHash: '["p"]', state: { status: "pending", fetchStatus: "idle" } };
  assertEquals(JSON.parse(serializePersistedQuery(pending)), JSON.parse(JSON.stringify(pending)));
  const primitive = query(["n"], 42);
  assertEquals(JSON.parse(serializePersistedQuery(primitive)), JSON.parse(JSON.stringify(primitive)));
});

Deno.test("#4265 B-4 unchanged data is reused across writes; changed data is re-serialised", () => {
  const data = { list: [1, 2, 3] };
  const first = serializePersistedQuery(query(["k"], data));
  data.list.push(4); // same object, same dataUpdatedAt: reused (React Query never mutates in place)
  assertEquals(serializePersistedQuery(query(["k"], data)), first);
  const refreshed = serializePersistedQuery(query(["k"], data, { dataUpdatedAt: 1_793_758_600_000 }));
  assert(refreshed.includes("[1,2,3,4]"), "a new dataUpdatedAt must re-serialise the data");
});

Deno.test("#4265 B-5 the startup read trims an old oversized blob and reports a corrupt one", () => {
  const raw = JSON.stringify(simulatorLikeClient());
  assert(raw.length > 1_500_000, "fixture must be past the old wipe-all threshold");
  const result = prunePersistedCacheString(raw);
  assertEquals(result.kind, "ok");
  assert(result.rewrite !== null && utf8ByteLength(result.rewrite) <= PERSISTED_CACHE_BUDGET_BYTES);
  assertEquals(result.client.clientState.queries.length, 5);
  const small = JSON.stringify({ ...simulatorLikeClient(), clientState: { mutations: [], queries: [] } });
  const untouched = prunePersistedCacheString(small);
  assertEquals(untouched.kind === "ok" && untouched.rewrite, null);
  assertEquals(prunePersistedCacheString("{not json").kind, "corrupt");
  assertEquals(prunePersistedCacheString('{"clientState":{}}').kind, "corrupt");
});

Deno.test("#4265 B-6 startup no longer deletes the whole cache; the persister writes within budget", () => {
  const layout = read("app/_layout.tsx").replace(/^\s*\/\/.*$/gm, "");
  assert(!/removeItem\(\s*["']REACT_QUERY_OFFLINE_CACHE/.test(layout), "the wipe-all startup guard is back");
  assert(/primePersistedQueryCache\(\)[\s\S]{0,80}?setCacheReady\(true\)/.test(layout), "the provider must wait for the trimmed read");
  const client = read("src/config/queryClient.ts");
  assert(client.includes("serialize: serializeWithinBudget"), "the persister must serialise through the budget");
  assert(client.includes("prunePersistedCacheString<PersistedClient>(raw)"), "the startup read must trim, not delete");
});

Deno.test("#4265 B-7 the Home deck is never persisted in the query cache (its snapshot owns cold start)", () => {
  const user = "c727d491-4884-4e72-b467-d6c124b9a8b9";
  const idle = (queryKey, data) => ({ queryKey, state: { status: "success", fetchStatus: "idle", data } });
  assertEquals(shouldDehydrateMinglaQuery(idle(["deck-cards", "solo", 35.78], { cards: [{ id: "a" }] }), user), false);
  assertEquals(shouldDehydrateMinglaQuery(idle(["deck-cards", "solo", 35.78], { cards: [] }), user), false);
  // Everything else is unchanged: per-user entries persist for their own user only.
  assertEquals(shouldDehydrateMinglaQuery(idle(["discover-last-city", user], { city: {}, source: "device" }), user), true);
  assertEquals(shouldDehydrateMinglaQuery(idle(["discover-last-city", user], { city: {}, source: "device" }), "a1b2c3d4-0000-4000-8000-000000000000"), false);
  assertEquals(shouldDehydrateMinglaQuery(idle(["savedCards", "list", user], []), user), true);
});

Deno.test("#4265 B-8 utf8ByteLength matches a real UTF-8 encoder for ASCII, accents, CJK and emoji", () => {
  const encoder = new TextEncoder();
  for (const sample of ["", "plain", "Café Brûlée", "東京の夜", "Jazz 🎷 night 🌃", "mixé 東 🎷 x"]) {
    assertEquals(utf8ByteLength(sample), encoder.encode(sample).byteLength, sample);
  }
  assertEquals(utf8ByteLength("\ud83c"), 3, "a lone surrogate costs what an encoder writes for U+FFFD");
  assertEquals(utf8ByteLength("é"), 2, "one character, two bytes");
});

Deno.test("#4265 B-9 a non-ASCII cache is held to the byte budget, not the character count", () => {
  const user = "c727d491-4884-4e72-b467-d6c124b9a8b9";
  // ~450k characters but ~1.35 MB of UTF-8 (东 is 3 bytes).
  const client = {
    timestamp: 1, buster: "",
    clientState: {
      mutations: [],
      queries: [
        query(["savedCards", "list", user], [{ id: "s", title: "东".repeat(450_000) }]),
        query(["userPreferences", user], { discover_city_name: "São Paulo" }),
      ],
    },
  };
  const result = serializePersistedClientWithinBudget(client);
  assert(result.serialized.length < PERSISTED_CACHE_BUDGET_BYTES, "fixture: under budget if characters were counted");
  assertEquals(result.dropped.map((entry) => JSON.parse(entry.queryHash)[0]), ["savedCards"],
    "the 1.35 MB (UTF-8) list is dropped even though it is only 450k characters");
  assert(result.dropped[0].bytes > PERSISTED_CACHE_BUDGET_BYTES);
  assert(utf8ByteLength(result.serialized) <= PERSISTED_CACHE_BUDGET_BYTES);
  // The startup read trims the same blob by bytes too.
  const raw = JSON.stringify(client);
  assert(raw.length < PERSISTED_CACHE_BUDGET_BYTES);
  const pruned = prunePersistedCacheString(raw);
  assertEquals(pruned.kind === "ok" && pruned.client.clientState.queries.map((q) => q.queryKey[0]), ["userPreferences"]);
});
