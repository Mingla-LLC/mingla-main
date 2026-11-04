// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4265 — the Explore deck shows the last deck at once on a cold start.
//
// Root cause: the last deck lived only inside the React Query persisted blob,
// and `app/_layout.tsx` deletes that whole blob at startup when it is over
// 1.5 MB. One 125-card deck page was ~1.2 MB, so on every launch the deck,
// preferences and location were thrown away and the first card waited for
// GPS → preferences → two curated edge calls (~6.4 s on the simulator).
//
// Driven behaviourally here (storage + cache fakes, no network anywhere):
//   * the first fetched page is saved as a small snapshot under its own key;
//   * a cold start seeds the cache under the SAME production key from storage
//     alone, for the same user / ~110 m bucket / < 24 h only;
//   * cards the user swiped or dismissed are never seeded, and never come back
//     when the fresh deck is merged in behind the snapshot;
//   * the fresh merge keeps every on-screen card in place (superset), so the
//     card under the thumb does not move; an empty fresh deck is honest;
//   * RACE (sim, combined build): the deck fetch started before the ~100-190 ms
//     storage read finished, and the restore bailed ("fetch-in-flight") on every
//     launch. Now the snapshot is seeded even with a fetch in flight, and that
//     fetch's partial + final arrivals merge BEHIND it; the deck query also
//     waits (≤ 300 ms) for the restore, which runs once per launch.
// Plus the wiring that makes it run in the app.
//
// FAILS-ON-REVERT: removing the restore call, the restore gate or the
// serving-side exclusion from RecommendationsContext; the restored-snapshot
// staleTime or fetchDeckKeepingSnapshot in useDeckCards; reading the cache
// only at fetch start (the old `prior` capture); the in-flight skip; the
// once-per-launch share; or the swiped-card filter in deckSnapshot.ts.

import {
  buildDeckSnapshotRecord,
  DECK_LAST_SNAPSHOT_KEY,
  DECK_SNAPSHOT_MAX_CARDS,
  deckSwipeStateStorageKeys,
  dismissedCardsStorageKey,
  isRestoredDeckSnapshot,
  LAST_RESOLVED_LOCATION_KEY,
  DECK_SNAPSHOT_RESTORE_GATE_MS,
  fetchDeckKeepingSnapshot,
  mergeFreshDeckBehindSnapshot,
  resetDeckSnapshotRestoreForTests,
  restoreDeckSnapshotController,
  restoreDeckSnapshotOnce,
  settleWithin,
} from "../deckSnapshot.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message = "mismatch"): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  actual:   ${a}\n  expected: ${e}`);
}

const USER = "c727d491-4884-4e72-b467-d6c124b9a8b9";
const OTHER = "11111111-1111-4111-8111-111111111111";
const NOW = 1_793_758_510_361;
const KEY = [
  "deck-cards", "solo", null, 35.78, -78.638, "", "adventurous,romantic",
  "driving", "time", 30, "2026-04-15T21:20:44.492Z", "this_weekend", 0, "",
  "USD", null, null, null, null,
];

function card(id: string) {
  return { id, title: `Card ${id}` };
}
function deck(ids: string[]) {
  return {
    cards: ids.map(card),
    deckMode: "mixed",
    activePills: ["romantic", "adventurous"],
    total: ids.length,
    hasMore: true,
    fxSnapshotId: null,
    serverPath: "pipeline",
  };
}

function keyHash(key: readonly unknown[]): string {
  return JSON.stringify(key);
}
function fakeCache(fetchingKeys: unknown[][] = []) {
  const data = new Map<string, unknown>();
  const updatedAt = new Map<string, number>();
  const fetching = new Set(fetchingKeys.map(keyHash));
  return {
    data,
    updatedAt,
    isFetching: ({ queryKey }) => (fetching.has(keyHash(queryKey)) ? 1 : 0),
    getQueryData: (key) => data.get(keyHash(key)),
    setQueryData: (key, value, options) => {
      const next = typeof value === "function" ? value(data.get(keyHash(key))) : value;
      if (next === undefined) return undefined;
      data.set(keyHash(key), next);
      updatedAt.set(keyHash(key), options?.updatedAt ?? NOW);
      return next;
    },
  };
}
function fakeStorage(entries: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    getItem: async (key: string) => {
      reads.push(key);
      return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
    },
  };
}

function savedSnapshot(ids: string[], overrides = {}) {
  return JSON.stringify(buildDeckSnapshotRecord({
    userId: USER,
    now: NOW - 60_000,
    queryKey: KEY,
    location: { lat: 35.779557, lng: -78.638148 },
    fxSnapshotId: null,
    response: deck(ids),
    ...overrides,
  }));
}
const RALEIGH = JSON.stringify({ lat: 35.779557, lng: -78.638148, ts: NOW - 60_000 });

Deno.test("first fetched page is saved as a small snapshot keyed by the production key", () => {
  const ids = Array.from({ length: 125 }, (_, i) => `c${i}`);
  const record = JSON.parse(savedSnapshot(ids));
  assertEquals(record.queryKey, KEY, "snapshot must carry the exact production key");
  assertEquals(record.location, { lat: 35.78, lng: -78.638 }, "location stored in the key's 3dp bucket");
  assertEquals(record.userId, USER, "snapshot is owned by the signed-in user");
  assert(record.response.cards.length === DECK_SNAPSHOT_MAX_CARDS, "snapshot keeps only the leading slice");
  assertEquals(record.response.cards[0].id, "c0", "snapshot keeps deck order");
  assert(DECK_LAST_SNAPSHOT_KEY.startsWith("@mingla"), "snapshot key must be cleared by sign-out cleanup (@mingla prefix)");
});

Deno.test("cold start seeds the cached deck from storage alone, under the same key", async () => {
  const cache = fakeCache();
  const storage = fakeStorage({
    [DECK_LAST_SNAPSHOT_KEY]: savedSnapshot(["a", "b", "c"]),
    [LAST_RESOLVED_LOCATION_KEY]: RALEIGH,
  });
  const result = await restoreDeckSnapshotController(
    { userId: USER, mode: "solo", refreshKey: 3, now: NOW },
    { queryClient: cache, storage },
  );
  assertEquals(result.skipped, null, "same user + bucket + fresh snapshot must restore");
  assertEquals(result.queryKey, KEY, "restore must return the production key");
  const seeded = cache.getQueryData(KEY);
  assert(isRestoredDeckSnapshot(seeded), "seeded data must be marked as a restored snapshot");
  assertEquals(seeded.cards.map((c) => c.id), ["a", "b", "c"], "cards render in the saved order");
  assertEquals(cache.updatedAt.get(keyHash(KEY)), NOW, "seed is stamped now so a late persister restore cannot clobber it");
  for (const read of storage.reads) {
    assert(!read.startsWith("http"), "restore reads AsyncStorage only, never the network");
  }
});

Deno.test("swiped and dismissed cards are never seeded and never return from the fresh merge", async () => {
  const swipeKeys = deckSwipeStateStorageKeys("solo", 3);
  const cache = fakeCache();
  const storage = fakeStorage({
    [DECK_LAST_SNAPSHOT_KEY]: savedSnapshot(["a", "b", "c", "d"]),
    [LAST_RESOLVED_LOCATION_KEY]: RALEIGH,
    [swipeKeys.removedCards]: JSON.stringify(["a"]),
    [dismissedCardsStorageKey(USER, "solo")]: JSON.stringify([card("c")]),
  });
  const result = await restoreDeckSnapshotController(
    { userId: USER, mode: "solo", refreshKey: 3, now: NOW },
    { queryClient: cache, storage },
  );
  assertEquals([...result.excludedCardIds].sort(), ["a", "c"],
    "exclusions are handed to the deck so a fresh deck under another key also keeps them out");
  const seeded = cache.getQueryData(KEY);
  assertEquals(seeded.cards.map((x) => x.id), ["b", "d"], "swiped (a) and dismissed (c) cards must not be seeded");
  assertEquals(seeded.restoredExcludedCardIds.sort(), ["a", "c"], "exclusions travel with the seeded deck");

  const fresh = deck(["a", "e", "b", "c", "f"]);
  const merged = mergeFreshDeckBehindSnapshot(seeded, fresh);
  assertEquals(merged.cards.map((x) => x.id), ["b", "d", "e", "f"],
    "fresh deck merges BEHIND the on-screen cards and drops swiped/dismissed ones");
  assert(!isRestoredDeckSnapshot(merged), "merged result is a fetched deck, not a snapshot");
  assertEquals(merged.total, 4, "total follows the merged cards");
});

Deno.test("fresh merge is a superset of what is on screen, so the top card stays put", () => {
  const restored = { ...deck(["x", "y", "z"]), restoredFromSnapshot: true, restoredExcludedCardIds: [] };
  const merged = mergeFreshDeckBehindSnapshot(restored, deck(["q", "z", "r"]));
  const onScreen = new Set(restored.cards.map((c) => c.id));
  for (const id of onScreen) {
    assert(merged.cards.some((c) => c.id === id), `on-screen card ${id} must survive the fresh merge`);
  }
  assertEquals(merged.cards.slice(0, 3).map((c) => c.id), ["x", "y", "z"], "on-screen order unchanged");
  const empty = mergeFreshDeckBehindSnapshot(restored, deck([]));
  assertEquals(empty.cards, [], "an empty fresh deck is the server's honest verdict, not hidden behind stale cards");
});

Deno.test("snapshot is not shown for another user, a stale deck, a moved location, or when all were swiped", async () => {
  const cases = [
    { name: "other user", input: { userId: OTHER }, entries: {}, reason: "other-user" },
    { name: "expired", input: { now: NOW + 25 * 60 * 60 * 1000 }, entries: {}, reason: "expired" },
    {
      name: "moved",
      input: {},
      entries: { [LAST_RESOLVED_LOCATION_KEY]: JSON.stringify({ lat: 35.9, lng: -78.638 }) },
      reason: "location-moved",
    },
    { name: "no location", input: {}, entries: { [LAST_RESOLVED_LOCATION_KEY]: null }, reason: "no-location" },
    {
      name: "all swiped",
      input: {},
      entries: { [deckSwipeStateStorageKeys("solo", 3).removedCards]: JSON.stringify(["a", "b"]) },
      reason: "all-swiped",
    },
  ];
  for (const c of cases) {
    const cache = fakeCache();
    const entries = {
      [DECK_LAST_SNAPSHOT_KEY]: savedSnapshot(["a", "b"]),
      [LAST_RESOLVED_LOCATION_KEY]: RALEIGH,
      ...c.entries,
    };
    for (const [k, v] of Object.entries(entries)) if (v === null) delete entries[k];
    const result = await restoreDeckSnapshotController(
      { userId: USER, mode: "solo", refreshKey: 3, now: NOW, ...c.input },
      { queryClient: cache, storage: fakeStorage(entries) },
    );
    assertEquals(result.skipped, c.reason, `${c.name}: wrong skip reason`);
    assertEquals(result.queryKey, null, `${c.name}: no key may be handed to the deck`);
    assertEquals(cache.data.size, 0, `${c.name}: nothing may be seeded`);
  }
});

function partialShape(prev, cards) {
  return { ...(prev ?? deck([])), cards, total: cards.length };
}

Deno.test("RACE: fetch already in flight when the restore lands → snapshot shown, fresh merged behind", async () => {
  const swipeKeys = deckSwipeStateStorageKeys("solo", 3);
  const cache = fakeCache();
  let deliverPartial;
  let finishFetch;
  const fetchStarted = new Promise((started) => {
    // The deck fetch starts FIRST (cache empty), exactly as on the simulator.
    void fetchDeckKeepingSnapshot(cache, KEY, (onPartial) => {
      deliverPartial = onPartial;
      started(undefined);
      return new Promise((resolve) => { finishFetch = resolve; });
    }, partialShape).then((result) => { cache.result = result; });
  });
  await fetchStarted;
  assertEquals(cache.getQueryData(KEY), undefined, "fetch is in flight with an empty cache");

  // The local restore resolves while that fetch is still running.
  const restored = await restoreDeckSnapshotController(
    { userId: USER, mode: "solo", refreshKey: 3, now: NOW },
    {
      queryClient: cache,
      storage: fakeStorage({
        [DECK_LAST_SNAPSHOT_KEY]: savedSnapshot(["a", "b", "c", "d"]),
        [LAST_RESOLVED_LOCATION_KEY]: RALEIGH,
        [swipeKeys.removedCards]: JSON.stringify(["a"]),
      }),
    },
  );
  assertEquals(restored.skipped, null, "an in-flight fetch must not stop the snapshot");
  assertEquals(cache.getQueryData(KEY).cards.map((c) => c.id), ["b", "c", "d"],
    "the snapshot is on screen while the fetch is still running");

  // A partial (singles) arrives: behind the snapshot, swiped card still out.
  deliverPartial([card("a"), card("e")]);
  const afterPartial = cache.getQueryData(KEY);
  assertEquals(afterPartial.cards.map((c) => c.id), ["b", "c", "d", "e"], "partial merges behind, without swiped a");
  assert(isRestoredDeckSnapshot(afterPartial), "partial keeps the snapshot marker + exclusions for the final merge");

  // The final interleaved deck arrives.
  finishFetch(deck(["e", "a", "f", "c", "b"]));
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(cache.result.cards.map((c) => c.id), ["b", "c", "d", "e", "f"],
    "final deck merges behind the on-screen cards; the top card (b) never moves; swiped a never returns");
  assert(!isRestoredDeckSnapshot(cache.result), "the merged result is a fetched deck");
});

Deno.test("no snapshot → the fetch result is returned exactly as fetched", async () => {
  const cache = fakeCache();
  const fresh = deck(["x", "y"]);
  const result = await fetchDeckKeepingSnapshot(cache, KEY, async () => fresh, partialShape);
  assertEquals(result, fresh);
});

Deno.test("the restore runs once per launch and every caller shares its result", async () => {
  resetDeckSnapshotRestoreForTests();
  const storage = fakeStorage({
    [DECK_LAST_SNAPSHOT_KEY]: savedSnapshot(["a", "b"]),
    [LAST_RESOLVED_LOCATION_KEY]: RALEIGH,
  });
  const cache = fakeCache();
  const input = { userId: USER, mode: "solo", refreshKey: 3, now: NOW };
  const one = restoreDeckSnapshotOnce(input, { queryClient: cache, storage });
  const two = restoreDeckSnapshotOnce(input, { queryClient: cache, storage });
  assert(one.first && !two.first, "second mount must reuse the first restore");
  assert(one.promise === two.promise, "both mounts get the same result");
  assertEquals((await two.promise).queryKey, KEY);
  assertEquals(storage.reads.filter((k) => k === DECK_LAST_SNAPSHOT_KEY).length, 1, "snapshot read once per launch");
  const other = restoreDeckSnapshotOnce({ ...input, refreshKey: 4 }, { queryClient: cache, storage });
  assert(other.first, "a new preference generation restores again");
  await other.promise;
  resetDeckSnapshotRestoreForTests();
});

Deno.test("the restore gate releases the deck when the read settles, or after 300 ms at most", async () => {
  assertEquals(DECK_SNAPSHOT_RESTORE_GATE_MS, 300);
  assertEquals(await settleWithin(Promise.resolve(1), 50), "settled");
  assertEquals(await settleWithin(Promise.reject(new Error("x")), 50), "settled", "a failed read still opens the gate");
  assertEquals(await settleWithin(new Promise(() => {}), 20), "timeout", "a hung read cannot block the deck");
});

Deno.test("a deck already in the cache is never overwritten by the snapshot", async () => {
  const cache = fakeCache();
  const live = deck(["live-1", "live-2"]);
  cache.setQueryData(KEY, live, { updatedAt: NOW - 1 });
  await restoreDeckSnapshotController(
    { userId: USER, mode: "solo", refreshKey: 3, now: NOW },
    {
      queryClient: cache,
      storage: fakeStorage({
        [DECK_LAST_SNAPSHOT_KEY]: savedSnapshot(["a"]),
        [LAST_RESOLVED_LOCATION_KEY]: RALEIGH,
      }),
    },
  );
  assertEquals(cache.getQueryData(KEY), live, "existing live data wins over the snapshot");
});

// ── Wiring (source contract) ────────────────────────────────────────────────
const contextSource = await Deno.readTextFile(
  new URL("../../contexts/RecommendationsContext.tsx", import.meta.url),
);
const hookSource = await Deno.readTextFile(new URL("../../hooks/useDeckCards.ts", import.meta.url));
const swipeSource = await Deno.readTextFile(
  new URL("../../components/SwipeableCards.tsx", import.meta.url),
);

Deno.test("the app restores the snapshot on cold start and keys the deck on it", () => {
  assert(contextSource.includes("restoreDeckSnapshotOnce("), "RecommendationsContext must restore the cold-start snapshot once per launch");
  assert(
    contextSource.includes("settleWithin(promise, DECK_SNAPSHOT_RESTORE_GATE_MS)"),
    "the deck must wait (bounded) for the local restore",
  );
  const soloHook = contextSource.slice(contextSource.indexOf("const flagSoloDeck = useDeckCards({"));
  assert(
    soloHook.slice(0, soloHook.indexOf("excludeCardIds")).includes("deckSnapshotGateOpen"),
    "the solo deck query must not fetch before the restore gate opens",
  );
  assert(/setLastDeckKey\(restored\.queryKey\)/.test(contextSource), "restored key must drive lastKnownQueryKey");
  assert(/setPinnedFxSnapshotId\(restored\.fxSnapshotId\)/.test(contextSource), "restored FX pin keeps the live key identical");
  assert(
    contextSource.includes("location: isSoloMode && stableDeckParams !== null ? userLocation : null"),
    "until preferences resolve the solo deck must stay on the persisted key",
  );
  assert(contextSource.includes("!isActiveDeckRestored"), "a restored snapshot must never be re-persisted as a fresh page");
  assert(!contextSource.includes("cachedLocationSync"), "the old proximity-only key restore must be gone");
  assert(
    contextSource.includes("soloDeckCards.filter((card) => !coldStartExcludedIds.has(card.id))"),
    "the solo deck must keep pre-restart swiped/dismissed cards out at serving",
  );
  assert(contextSource.includes("setColdStartExcludedIds(null);"), "preference change must clear the cold-start exclusion");
});

Deno.test("useDeckCards loads a fresh deck behind a restored snapshot and merges it in", () => {
  assert(
    hookSource.includes("staleTime: (q) => (isRestoredDeckSnapshot(q.state.data) ? 0 : Infinity)"),
    "restored snapshot must be stale so the fresh deck loads behind it",
  );
  assert(
    hookSource.includes("return fetchDeckKeepingSnapshot<Recommendation, DeckResponse>("),
    "the deck fetch must go through the keep-my-place snapshot merge",
  );
  assert(!hookSource.includes("const prior = queryClient.getQueryData"), "the cache must not be read only at fetch start");
  assert(hookSource.includes("JSON.stringify(record)"), "first page must write the snapshot record");
});

Deno.test("SwipeableCards and the snapshot read one swiped-card key", () => {
  assert(
    swipeSource.includes("deckSwipeStateStorageKeys(currentMode, refreshKey)"),
    "SwipeableCards must build its swipe-state keys with the shared builder",
  );
  assertEquals(deckSwipeStateStorageKeys("solo", 0).removedCards, "mingla_card_state_solo_0_removed",
    "storage key shape must not change (persisted swipe state from older builds)");
});
