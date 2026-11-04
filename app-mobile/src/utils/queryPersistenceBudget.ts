// #4265 — keep the persisted React Query cache under a size budget, one query at
// a time, instead of letting it grow past the startup guard and losing all of it.
//
// Before: the persister wrote every dehydrated query as one JSON blob. On the
// signed-in test account that blob was 1,872,829 characters (the Home deck alone
// 1.19 MB, saved cards 0.81 MB). `app/_layout.tsx` deleted the WHOLE blob on every
// launch once it passed 1.5 MB, so every cold start began with an empty cache and
// every tab refetched everything — and each throttled write re-stringified ~1.9 MB
// on the JS thread while tabs were loading.
//
// Now: each query is serialised separately; the smallest queries are kept first
// and the largest are dropped only when the total would pass the budget. A query's
// data is stringified once per data object (React Query keeps the same object
// until the data changes), so a write after an unrelated query changes costs only
// the changed query.
//
// The budget is in UTF-8 BYTES, not characters: Android's AsyncStorage
// (SQLite, 2 MB CursorWindow) limits bytes, and a non-ASCII character (an
// accented venue name, CJK, emoji) costs 2–4 bytes. Sizes are counted with
// utf8ByteLength — a loop over the string's code units, no encoded copy.
//
// Pure module: no React Native imports, so the Deno unit lane can run it.

/** Target size of the persisted blob, in UTF-8 bytes (what Android's AsyncStorage stores). */
export const PERSISTED_CACHE_BUDGET_BYTES = 1_000_000;

/**
 * UTF-8 byte length of a string without encoding it (no TextEncoder copy of a
 * ~1 MB blob on the JS thread). A surrogate pair is one 4-byte code point; a
 * lone surrogate counts 3 bytes, what an encoder writes for its U+FFFD
 * replacement.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export interface PersistedQueryLike {
  queryKey: unknown;
  queryHash?: string;
  state: { data?: unknown; dataUpdatedAt?: number };
}

export interface PersistedClientLike {
  timestamp: number;
  buster: string;
  clientState: {
    mutations: unknown[];
    queries: PersistedQueryLike[];
  };
}

export interface DroppedQuery {
  queryHash: string;
  /** UTF-8 bytes this query would have cost. */
  bytes: number;
}

export interface BudgetedSerialization<TQuery extends PersistedQueryLike = PersistedQueryLike> {
  serialized: string;
  kept: TQuery[];
  dropped: DroppedQuery[];
}

// A token no real query key or state field contains; the data JSON is spliced in
// where it sits so the (small, ever-changing) rest of the query is stringified
// fresh every write while the (large, rarely-changing) data is reused.
const DATA_TOKEN = "__mingla_4265_persisted_data__";
const QUOTED_DATA_TOKEN = JSON.stringify(DATA_TOKEN);

interface CachedDataJson {
  updatedAt: unknown;
  json: string;
}

const dataJsonCache = new WeakMap<object, CachedDataJson>();

function dataToJson(data: unknown, updatedAt: unknown): string {
  if (data !== null && typeof data === "object") {
    const hit = dataJsonCache.get(data);
    if (hit !== undefined && hit.updatedAt === updatedAt) return hit.json;
    const json = JSON.stringify(data);
    dataJsonCache.set(data, { updatedAt, json });
    return json;
  }
  return JSON.stringify(data);
}

/** One dehydrated query as JSON, equal (after JSON.parse) to JSON.stringify(query). */
export function serializePersistedQuery(query: PersistedQueryLike): string {
  const data = query.state.data;
  if (data === undefined) return JSON.stringify(query);
  const head = JSON.stringify({ ...query, state: { ...query.state, data: DATA_TOKEN } });
  const at = head.lastIndexOf(QUOTED_DATA_TOKEN);
  if (at === -1) return JSON.stringify(query);
  return head.slice(0, at) + dataToJson(data, query.state.dataUpdatedAt) + head.slice(at + QUOTED_DATA_TOKEN.length);
}

/**
 * Serialise a persisted client, keeping as many queries as fit in `budget`
 * UTF-8 bytes. Small queries are kept before large ones, so one oversized query
 * (a big deck or saved list) is dropped on its own instead of costing the whole
 * cache. Kept queries stay in their original order.
 */
export function serializePersistedClientWithinBudget<TQuery extends PersistedQueryLike>(
  client: Omit<PersistedClientLike, "clientState"> & { clientState: { mutations: unknown[]; queries: TQuery[] } },
  budget: number = PERSISTED_CACHE_BUDGET_BYTES,
): BudgetedSerialization<TQuery> {
  const queries = client.clientState.queries ?? [];
  const mutationsJson = JSON.stringify(client.clientState.mutations ?? []);
  const shell = (queriesJson: string): string =>
    `{"timestamp":${JSON.stringify(client.timestamp)},"buster":${JSON.stringify(client.buster ?? "")},"clientState":{"mutations":${mutationsJson},"queries":[${queriesJson}]}}`;

  const entries = queries.map((query) => {
    const json = serializePersistedQuery(query);
    return { query, json, bytes: utf8ByteLength(json) };
  });
  const bySize = entries.map((_, index) => index).sort((a, b) => entries[a].bytes - entries[b].bytes);

  const keep = new Set<number>();
  const dropped: DroppedQuery[] = [];
  let used = utf8ByteLength(shell(""));
  for (const index of bySize) {
    const cost = entries[index].bytes + (keep.size > 0 ? 1 : 0);
    if (used + cost <= budget) {
      keep.add(index);
      used += cost;
    } else {
      dropped.push({ queryHash: entries[index].query.queryHash ?? JSON.stringify(entries[index].query.queryKey), bytes: entries[index].bytes });
    }
  }

  const keptEntries = entries.filter((_, index) => keep.has(index));
  return {
    serialized: shell(keptEntries.map((entry) => entry.json).join(",")),
    kept: keptEntries.map((entry) => entry.query),
    dropped,
  };
}

/**
 * Startup read of an existing blob. Returns the client to restore (trimmed to the
 * budget when it was over) and, when it had to be trimmed, the string to write
 * back. A blob that does not parse is reported as `corrupt` so the caller removes it.
 */
export function prunePersistedCacheString<TClient extends PersistedClientLike = PersistedClientLike>(
  raw: string,
  budget: number = PERSISTED_CACHE_BUDGET_BYTES,
):
  | { kind: "ok"; client: TClient; rewrite: string | null; dropped: DroppedQuery[] }
  | { kind: "corrupt"; error: unknown } {
  let parsed: TClient;
  try {
    parsed = JSON.parse(raw) as TClient;
  } catch (error) {
    return { kind: "corrupt", error };
  }
  if (!parsed || typeof parsed !== "object" || !parsed.clientState || !Array.isArray(parsed.clientState.queries)) {
    return { kind: "corrupt", error: new Error("persisted_cache_shape_invalid") };
  }
  if (utf8ByteLength(raw) <= budget) return { kind: "ok", client: parsed, rewrite: null, dropped: [] };
  const trimmed = serializePersistedClientWithinBudget(parsed, budget);
  return {
    kind: "ok",
    client: { ...parsed, clientState: { ...parsed.clientState, queries: trimmed.kept } } as TClient,
    rewrite: trimmed.serialized,
    dropped: trimmed.dropped,
  };
}
