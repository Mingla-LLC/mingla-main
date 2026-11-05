/**
 * #4265 — cold-start deck snapshot. Pure (no React, no React Query import, no
 * Supabase) so the rules run under the Deno unit lane.
 *
 * Why it exists: the last deck page the user saw used to live ONLY inside the
 * React Query persisted blob. That blob is removed whole at startup once it
 * outgrows the 1.5 MB Android guard in `app/_layout.tsx` — and a single
 * 125-card deck page was ~1.2 MB on its own — so every cold start threw the
 * deck, preferences and location away and the Explore tab waited ~6.4 s for
 * GPS → preferences → two curated "pill" edge calls. The snapshot keeps a
 * small slice of the deck under its own AsyncStorage key. The `@mingla`
 * prefix is removed on sign-out by `authCleanup` (Constitution 6).
 */

export const DECK_LAST_SNAPSHOT_KEY = '@mingla/lastDeckSnapshot';
/** Enough cards to start swiping without waiting; not the whole deck (~10 KB a card). */
export const DECK_SNAPSHOT_MAX_CARDS = 40;
/** Matches the React Query persister maxAge — older decks are not shown. */
export const DECK_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DECK_SNAPSHOT_VERSION = 1;
/** Same AsyncStorage key `useUserLocation` writes the last resolved location to. */
export const LAST_RESOLVED_LOCATION_KEY = '@mingla/lastLocation';

export interface DeckCardLike {
  id: string;
}

export interface DeckResponseLike<C extends DeckCardLike = DeckCardLike> {
  cards: C[];
  total: number;
  fxSnapshotId: string | null;
}

/**
 * A deck response seeded from the cold-start snapshot rather than fetched.
 * useDeckCards treats it as stale (a fresh deck loads behind it) and merges
 * the fresh result AFTER these cards, so the card under the thumb never moves.
 */
export type RestoredDeck<R extends DeckResponseLike> = R & {
  restoredFromSnapshot: true;
  /** Ids the user swiped or dismissed before the restart; never served again. */
  restoredExcludedCardIds: string[];
};

/**
 * Storage keys SwipeableCards uses for its swipe state (current index and the
 * ids the user already swiped). Shared so the snapshot reads the exact swiped
 * set the deck writes — one exclusion, two readers (Constitution 13).
 */
export function deckSwipeStateStorageKeys(
  mode: string,
  refreshKey: number | string | undefined,
): { index: string; removedCards: string } {
  const baseKey = `mingla_card_state_${mode}_${refreshKey || 0}`;
  return {
    index: `${baseKey}_index`,
    removedCards: `${baseKey}_removed`,
  };
}

/** Storage key for the cards the user dismissed in a mode (RecommendationsContext). */
export function dismissedCardsStorageKey(userId: string, mode: string): string {
  return `dismissed_cards_${userId}_${mode}`;
}

/**
 * ORCH-0490 Phase 2.2 — dedupe by `id`, PRESERVE existing positions, append new
 * cards to the tail. `mergeCardsByIdPreservingOrder([A,B,C],[B,D,E])` is
 * `[A,B,C,D,E]`. Load-bearing for I-PROGRESSIVE-DELIVERY-EXPANSION-NOT-REPLACEMENT.
 */
export function mergeCardsByIdPreservingOrder<C extends DeckCardLike>(
  prev: C[],
  incoming: C[],
): C[] {
  if (prev.length === 0) return incoming;
  if (incoming.length === 0) return prev;
  const prevIds = new Set<string>();
  for (const card of prev) prevIds.add(card.id);
  const toAppend: C[] = [];
  for (const card of incoming) {
    if (!prevIds.has(card.id)) toAppend.push(card);
  }
  if (toAppend.length === 0) return prev;
  return [...prev, ...toAppend];
}

export function isRestoredDeckSnapshot<R extends DeckResponseLike>(
  data: R | undefined | null,
): data is RestoredDeck<R> {
  return !!data && Reflect.get(data, 'restoredFromSnapshot') === true;
}

/**
 * The deck card currently on top of the swipe stack. SwipeableCards writes it
 * whenever the top card changes so the final fresh-deck merge knows which
 * snapshot card is under the thumb. Client-only UI state (Constitution 5); a
 * stale value is harmless because the merge only honours an id that is part of
 * the restored snapshot.
 */
let onScreenDeckTopCardId: string | null = null;

export function noteDeckTopCardId(cardId: string | null): void {
  onScreenDeckTopCardId = cardId;
}

export function readDeckTopCardId(): string | null {
  return onScreenDeckTopCardId;
}

/**
 * Merge the FINAL freshly fetched deck behind a restored snapshot.
 *
 * Snapshot cards the fresh deck no longer contains are dropped — the server no
 * longer serves them (closed, removed, filtered) — except the card currently on
 * top, which never moves: it stays (alone, of the missing ones) so the card
 * under the thumb does not jump. Snapshot cards the fresh deck still has keep
 * their positions, new cards are appended, and anything the user already
 * swiped or dismissed is dropped. Partial deliveries never come through here
 * (fetchDeckKeepingSnapshot merges them without pruning). An empty fresh deck
 * is the server's honest verdict (pool empty / all closed) and is returned
 * as-is.
 *
 * @param topCardId the card on top of the stack now; defaults to the one
 *   SwipeableCards last noted, else the snapshot's first card.
 */
export function mergeFreshDeckBehindSnapshot<R extends DeckResponseLike>(
  restored: RestoredDeck<R>,
  fresh: R,
  topCardId: string | null = readDeckTopCardId(),
): R {
  if (fresh.cards.length === 0) return fresh;
  const excluded = new Set(restored.restoredExcludedCardIds);
  const freshIds = new Set<string>();
  for (const card of fresh.cards) freshIds.add(card.id);
  const snapshotIds = new Set(restored.cards.map((card) => card.id));
  const top =
    topCardId !== null && snapshotIds.has(topCardId)
      ? topCardId
      : (restored.cards[0]?.id ?? null);
  const keptSnapshot = restored.cards.filter(
    (card) => card.id === top || freshIds.has(card.id),
  );
  const cards = mergeCardsByIdPreservingOrder(
    keptSnapshot,
    fresh.cards.filter((card) => !excluded.has(card.id)),
  );
  return { ...fresh, cards, total: cards.length };
}

export interface DeckSnapshotRecord<R extends DeckResponseLike = DeckResponseLike> {
  version: number;
  savedAt: number;
  userId: string;
  queryKey: unknown[];
  location: { lat: number; lng: number };
  fxSnapshotId: string | null;
  response: R;
}

/** The ~110 m bucket the deck query key itself uses (3 dp). */
export function roundDeckLocation(location: { lat: number; lng: number }): {
  lat: number;
  lng: number;
} {
  return {
    lat: Math.round(location.lat * 1000) / 1000,
    lng: Math.round(location.lng * 1000) / 1000,
  };
}

export function buildDeckSnapshotRecord<R extends DeckResponseLike>(input: {
  userId: string;
  now: number;
  queryKey: readonly unknown[];
  location: { lat: number; lng: number };
  fxSnapshotId: string | null;
  response: R;
}): DeckSnapshotRecord<R> {
  return {
    version: DECK_SNAPSHOT_VERSION,
    savedAt: input.now,
    userId: input.userId,
    queryKey: [...input.queryKey],
    location: roundDeckLocation(input.location),
    fxSnapshotId: input.fxSnapshotId,
    response: {
      ...input.response,
      cards: input.response.cards.slice(0, DECK_SNAPSHOT_MAX_CARDS),
    },
  };
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isDeckSnapshotRecord(value: unknown): value is DeckSnapshotRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DeckSnapshotRecord>;
  return (
    record.version === DECK_SNAPSHOT_VERSION &&
    typeof record.savedAt === 'number' &&
    typeof record.userId === 'string' &&
    Array.isArray(record.queryKey) &&
    record.queryKey[0] === 'deck-cards' &&
    !!record.location &&
    typeof record.location.lat === 'number' &&
    typeof record.location.lng === 'number' &&
    !!record.response &&
    Array.isArray(record.response.cards)
  );
}

/** Swiped ids are stored as `string[]`; dismissed cards as card objects. */
function idsFromStoredList(raw: string | null): string[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === 'string') {
      ids.push(entry);
    } else if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { id?: unknown }).id === 'string'
    ) {
      ids.push((entry as { id: string }).id);
    }
  }
  return ids;
}

export type DeckSnapshotSkipReason =
  | 'none'
  | 'invalid'
  | 'other-user'
  | 'expired'
  | 'no-location'
  | 'location-moved'
  | 'all-swiped';

export interface DeckSnapshotRestoreResult {
  queryKey: readonly unknown[] | null;
  fxSnapshotId: string | null;
  cardCount: number;
  /** Swiped + dismissed ids read at restore; the deck keeps them out all session. */
  excludedCardIds: string[];
  skipped: DeckSnapshotSkipReason | null;
}

export interface DeckSnapshotReadStorage {
  getItem(key: string): Promise<string | null>;
}

/** The two QueryClient methods the restore needs (structural, so tests use a Map). */
export interface DeckSnapshotCache {
  getQueryData(queryKey: readonly unknown[]): unknown;
  setQueryData(
    queryKey: readonly unknown[],
    data: unknown,
    options: { updatedAt: number },
  ): unknown;
}

/**
 * Cold start: seed the cache with the last deck page the user saw, under the
 * exact production key it was fetched with, minus every card the user swiped
 * or dismissed. Only for the same user, within 24 h, and when the last
 * resolved location is in the same ~110 m bucket the deck was built for.
 * Reads AsyncStorage only — never the network.
 */
export async function restoreDeckSnapshotController(
  input: {
    userId: string;
    mode: 'solo';
    refreshKey: number | string | undefined;
    now: number;
  },
  dependencies: {
    queryClient: DeckSnapshotCache;
    storage: DeckSnapshotReadStorage;
  },
): Promise<DeckSnapshotRestoreResult> {
  const skip = (reason: DeckSnapshotSkipReason): DeckSnapshotRestoreResult => ({
    queryKey: null,
    fxSnapshotId: null,
    cardCount: 0,
    excludedCardIds: [],
    skipped: reason,
  });
  const swipeKeys = deckSwipeStateStorageKeys(input.mode, input.refreshKey);
  const [snapshotRaw, locationRaw, removedRaw, dismissedRaw] = await Promise.all([
    dependencies.storage.getItem(DECK_LAST_SNAPSHOT_KEY),
    dependencies.storage.getItem(LAST_RESOLVED_LOCATION_KEY),
    dependencies.storage.getItem(swipeKeys.removedCards),
    dependencies.storage.getItem(dismissedCardsStorageKey(input.userId, input.mode)),
  ]);
  if (!snapshotRaw) return skip('none');
  const record = parseJson(snapshotRaw);
  if (!isDeckSnapshotRecord(record)) return skip('invalid');
  if (record.userId !== input.userId) return skip('other-user');
  if (input.now < record.savedAt || input.now - record.savedAt > DECK_SNAPSHOT_MAX_AGE_MS) {
    return skip('expired');
  }
  const lastLocation = parseJson(locationRaw) as { lat?: unknown; lng?: unknown } | null;
  if (
    !lastLocation ||
    typeof lastLocation.lat !== 'number' ||
    typeof lastLocation.lng !== 'number'
  ) {
    return skip('no-location');
  }
  const bucket = roundDeckLocation({ lat: lastLocation.lat, lng: lastLocation.lng });
  if (bucket.lat !== record.location.lat || bucket.lng !== record.location.lng) {
    return skip('location-moved');
  }

  const excludedIds = [
    ...new Set([...idsFromStoredList(removedRaw), ...idsFromStoredList(dismissedRaw)]),
  ];
  const excluded = new Set(excludedIds);
  const cards = record.response.cards.filter((card) => !excluded.has(card.id));
  if (cards.length === 0) return skip('all-swiped');

  // A fetch already running for this key does NOT stop the seed: the
  // snapshot shows now, and fetchDeckKeepingSnapshot re-reads the cache when
  // that fetch lands and merges the fresh deck BEHIND the snapshot (#4265 —
  // the in-flight skip made the restore lose the race on every launch).
  // A deck already in the cache under this key (e.g. restored by the React
  // Query persister) wins — never overwrite live data with the snapshot.
  const existing = dependencies.queryClient.getQueryData(record.queryKey) as
    | DeckResponseLike
    | undefined;
  if (!existing || !Array.isArray(existing.cards) || existing.cards.length === 0) {
    const restored: RestoredDeck<DeckResponseLike> = {
      ...record.response,
      cards,
      total: cards.length,
      restoredFromSnapshot: true,
      restoredExcludedCardIds: excludedIds,
    };
    dependencies.queryClient.setQueryData(record.queryKey, restored, {
      updatedAt: input.now,
    });
  }
  return {
    queryKey: record.queryKey,
    fxSnapshotId: record.fxSnapshotId,
    cardCount: cards.length,
    excludedCardIds: excludedIds,
    skipped: null,
  };
}

/** The cache methods the deck fetch needs (structural; QueryClient satisfies it). */
export interface DeckFetchCache<R extends DeckResponseLike> {
  getQueryData(queryKey: readonly unknown[]): R | undefined;
  setQueryData(
    queryKey: readonly unknown[],
    updater: (prev: R | undefined) => R | undefined,
  ): unknown;
}

/**
 * #4265 — one deck fetch that never yanks a cold-start snapshot, whenever the
 * snapshot lands. The cache is read at each arrival (partial and final), NOT
 * once at the start, so a snapshot seeded while the fetch is already in flight
 * still wins:
 *   * a partial delivery merges behind whatever is on screen, keeps a
 *     snapshot's marker + exclusions, and drops swiped/dismissed cards;
 *   * the final result is merged behind a snapshot if one is in the cache now,
 *     otherwise returned as fetched.
 * `emptyPartial(prev, cards)` builds the non-snapshot partial shape (the hook's
 * existing ORCH-0490 Phase 2.2 progressive-delivery shape).
 */
export async function fetchDeckKeepingSnapshot<C extends DeckCardLike, R extends DeckResponseLike<C>>(
  cache: DeckFetchCache<R>,
  queryKey: readonly unknown[],
  fetchDeck: (onPartial: (cards: C[]) => number) => Promise<R>,
  partialShape: (prev: R | undefined, mergedCards: C[]) => R,
): Promise<R> {
  const fresh = await fetchDeck((partialCards) => {
    let added = 0;
    cache.setQueryData(queryKey, (prev) => {
      const restored = isRestoredDeckSnapshot(prev) ? prev : null;
      const excluded = new Set(restored?.restoredExcludedCardIds ?? []);
      const cards = restored
        ? partialCards.filter((card) => !excluded.has(card.id))
        : partialCards;
      if (cards.length === 0) return prev;
      const merged = mergeCardsByIdPreservingOrder(prev?.cards ?? [], cards);
      added = merged.length - (prev?.cards?.length ?? 0);
      if (restored) {
        return { ...restored, cards: merged, total: merged.length };
      }
      return partialShape(prev, merged);
    });
    return added;
  });
  const latest = cache.getQueryData(queryKey);
  return isRestoredDeckSnapshot(latest) ? mergeFreshDeckBehindSnapshot(latest, fresh) : fresh;
}

// ── Once per launch ─────────────────────────────────────────────────────────
// Every solo RecommendationsProvider mount asked for the restore (two calls per
// launch were logged). One storage read per (user, refreshKey) per JS runtime;
// later callers share the same promise and result.
let restoreOnce: { key: string; promise: Promise<DeckSnapshotRestoreResult> } | null = null;

export function restoreDeckSnapshotOnce(
  input: Parameters<typeof restoreDeckSnapshotController>[0],
  dependencies: Parameters<typeof restoreDeckSnapshotController>[1],
): { promise: Promise<DeckSnapshotRestoreResult>; first: boolean } {
  const key = `${input.userId}:${String(input.refreshKey ?? 0)}`;
  if (restoreOnce && restoreOnce.key === key) {
    return { promise: restoreOnce.promise, first: false };
  }
  const promise = restoreDeckSnapshotController(input, dependencies);
  restoreOnce = { key, promise };
  return { promise, first: true };
}

/** Test seam — forget the once-per-launch restore. */
export function resetDeckSnapshotRestoreForTests(): void {
  restoreOnce = null;
}

/** The deck waits at most this long for the local restore before fetching. */
export const DECK_SNAPSHOT_RESTORE_GATE_MS = 300;

/** Resolves when `promise` settles or after `ms`, whichever is first. Never rejects. */
export function settleWithin(promise: Promise<unknown>, ms: number): Promise<'settled' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve('settled');
      },
      () => {
        clearTimeout(timer);
        resolve('settled');
      },
    );
  });
}
