/**
 * ORCH-426 G1 — short-TTL response cache for discover-merged-events.
 * Absorbs thundering-herd on identical city/page/filter queries under load.
 */

export const DISCOVER_CACHE_TTL_MS = Number(
  Deno.env.get("DISCOVER_MERGED_CACHE_TTL_MS") ?? "120000",
);

export const DISCOVER_STALE_TTL_MS = Number(
  Deno.env.get("DISCOVER_MERGED_STALE_MS") ?? "600000",
);

/**
 * issue #2009 (BINDING SPEC AMENDMENT 3B, Defect 3) — the hard ceiling on how
 * long a successfully-read discovery generation may be reused from this
 * isolate's memory before it must be read from the database again.
 *
 * WORST-CASE STALENESS, IN PLAIN WORDS: after an organiser changes a standard
 * ticketed event's visibility, a discover deck built before that change can
 * still be served for AT MOST FIVE SECONDS. After five seconds this isolate
 * re-reads the generation, the cache key changes, and the pre-change deck is
 * unreachable in L1, in the L2 DB cache and behind the cross-isolate build
 * lock. (Amendment 3A closed a 2-minute-fresh / 10-minute-stale hole by reading
 * the generation on EVERY request; this bound gives ~5s of that back in
 * exchange for keeping discovery — ORCH-426's hot path — off the database on an
 * L1 hit.)
 *
 * A LITERAL CONSTANT, NOT AN ENVIRONMENT VARIABLE, DELIBERATELY. Amendment 3B
 * is explicit that the ceiling must not be tunable into a large staleness
 * window. The two TTLs above ARE env-tunable, and that is precisely how the
 * ten-minute hole came to exist. The #2009 strict-grep gate fails if this
 * constant is turned into a `Deno.env.get` read or raised above 5000.
 */
export const DISCOVER_GENERATION_TTL_MS = 5000;

/**
 * issue #2009 — the prefix of the fail-closed, per-call-unique generation slot.
 * Shared by the slot builder and the memo policy below so "is this slot
 * cacheable?" has exactly one definition.
 */
const UNAVAILABLE_GENERATION_PREFIX = "unavailable:";

/**
 * issue #2009 (pass-1 TEST REPORT P1-2) — the ONE namespace every fail-closed
 * key collapses onto for the purpose of request coalescing.
 *
 * TWO DIFFERENT QUESTIONS, TWO DIFFERENT KEYS. The fail-closed slot below is
 * per-call unique, and it must stay that way: uniqueness is what makes the
 * response UNCACHEABLE — nothing can be read from L1 or the L2 database cache
 * under a key that has never existed and will never be minted again, so a
 * request whose generation could not be read can never be served an entry keyed
 * on a generation this isolate cannot confirm.
 *
 * But `cacheKey` was ALSO doing a second job: it is the single-flight key in
 * `coalesceDiscoverBuild` and the cross-isolate build-lock namespace. Making it
 * unique per request therefore did not merely cost a cache miss — it dissolved
 * ORCH-426's overload protection on the consumer app's hottest path, at exactly
 * the moment the system is already degraded. Measured: 12 concurrent requests
 * produced 12 independent database builds where a readable generation produces
 * 1, and the `DiscoverOverloadedError` backstop (itself per-key) could not fire
 * either. It is reachable through the documented deploy order — the edge
 * function live before the migration lands — and through any transient RPC
 * error or PostgREST schema-cache miss.
 *
 * So the two concerns are separated: the CACHE key stays unique (uncacheable),
 * and the COALESCING key erases the uuid so concurrent fail-closed requests
 * collapse onto one build. Nothing is served from a shared entry — the build's
 * result is still stored under the winner's own unique key, which no later
 * request can mint — so availability is preserved without reintroducing the
 * stale-privacy read.
 */
export const UNAVAILABLE_GENERATION_COALESCE_SLOT =
  `${UNAVAILABLE_GENERATION_PREFIX}*`;

/**
 * `crypto.randomUUID()` output, exactly — 8-4-4-4-12 hex. Deliberately NOT a
 * loose `[^"]*`: a narrow pattern cannot swallow a legitimate generation slot
 * (`g<n>`) or any other part of the key, so collapsing can only ever affect the
 * fail-closed namespace.
 */
const UNAVAILABLE_SLOT_IN_KEY =
  /unavailable:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * issue #2009 (pass-1 TEST REPORT P1-2) — the single-flight / build-lock
 * namespace for a discover cache key.
 *
 * For a readable generation this is the IDENTITY function, so the normal path
 * is byte-for-byte what ORCH-426 shipped. For a fail-closed key it erases the
 * per-call uuid, so a herd arriving while the generation is unreadable
 * coalesces onto one build instead of one build per request.
 */
export function discoverBuildCoalesceKey(cacheKey: string): string {
  return cacheKey.replace(
    UNAVAILABLE_SLOT_IN_KEY,
    UNAVAILABLE_GENERATION_COALESCE_SLOT,
  );
}

export interface DiscoverCacheParams {
  /**
   * #1637 — null for a coords-anchored request (a cold consumer launch, before
   * any reverse-geocode). The `geo` slot below then carries the whole anchor.
   */
  cityName: string | null;
  stateCode?: string | null;
  countryCode?: string | null;
  page: number;
  size: number;
  partyTypeSlugs: string[];
  vibeTagSlugs: string[];
  musicGenreSlugs: string[];
  dateWindowUtc: { startUtc: string; endUtc: string } | null;
  segmentSlug?: string;
  genreSlugs?: string[];
  localStartEndDateTime?: string;
  keywords?: string[];
  sort?: string;
  timezone: string;
  // issue #1020 — browsed metro geo center/radius. Folded into the cache key so
  // two same-name requests with different centers/radii key distinctly.
  fallbackLat?: number | null;
  fallbackLng?: number | null;
  fallbackRadiusKm?: number | null;
  /**
   * issue #2009 (BINDING SPEC AMENDMENT 3A, Defect 2) — the discovery
   * generation slot, produced by `discoveryGenerationSlot()` below.
   *
   * `pg_discover_business_events` filters `e.visibility = 'public'` at source,
   * so an Unlisted row leaves the QUERY immediately — but this function serves
   * from an L1 memory cache, an L2 DB cache and a cross-isolate build lock, all
   * keyed by this key, under stale-while-revalidate. Without a generation in
   * the key a Public -> Unlisted flip kept being served for up to
   * DISCOVER_CACHE_TTL_MS fresh (120s) and DISCOVER_STALE_TTL_MS stale (600s).
   *
   * Every real standard-event visibility transition increments
   * `event_discovery_generation` in the SAME transaction as the row write, so a
   * flip mints a brand-new key here and the pre-change response can never be
   * served from any of the three layers.
   */
  discoveryGeneration?: string;
}

/**
 * issue #2009 — turn a raw `event_discovery_generation` read into the cache-key
 * slot, FAIL CLOSED.
 *
 * A valid positive integer generation produces a shared, stable slot — that is
 * what makes the cache a cache. Anything else (RPC error, null, NaN, a
 * non-integer, a non-positive value) means the generation COULD NOT BE READ,
 * and the amendment is explicit that such a request must not be served a cached
 * entry keyed on a stale or absent generation. It therefore gets a per-call
 * unique slot: the key it mints cannot collide with any entry that exists or
 * will ever exist, so L1, L2 and the build lock all miss and the response is
 * built fresh. Availability is preserved; a stale-privacy read is not possible.
 */
export function discoveryGenerationSlot(raw: unknown): string {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return `g${value}`;
  }
  return `${UNAVAILABLE_GENERATION_PREFIX}${crypto.randomUUID()}`;
}

/** The shape of an awaited `supabase.rpc(...)` result, structurally. */
export interface DiscoveryGenerationRead {
  data: unknown;
  error: { message?: string } | null;
}

/**
 * issue #2009 (pass-2 TEST REPORT, Defect D-1) — THE FAIL-CLOSED SIGNAL, AS
 * DATA.
 *
 * The resolver below is the ONLY place in the system that knows whether this
 * isolate currently holds a confirmed discovery generation. Before this pass it
 * told nobody: `_resolve-entry.ts` recovered the answer by regexing the
 * `unavailable:<uuid>` sentinel out of the FULL cache key — and that key is a
 * JSON blob of unsanitised client input (`keywords`, `cityName`, `sort`,
 * `segmentSlug`, `timezone` and three slug arrays all land in it). A client
 * field shaped like the sentinel therefore made `uncacheable` true with a
 * perfectly readable generation. Measured on `resolveDiscoverEntry`: 12
 * concurrent requests on generation `g7` went from 1 build / 1 L2 row / 12
 * served / 0x503 to 1 build / 0 L2 rows / 1 served / 11x503, anonymously
 * (`verify_jwt = false`), on the consumer app's hottest endpoint.
 *
 * So the answer travels as a BOOLEAN from the one place that knows it, rather
 * than being re-derived from a string an attacker can write into. `readable` is
 * true if and only if `slot` was built from a generation this isolate actually
 * read (or memoized inside the ceiling); no client-supplied value can move it.
 */
export interface DiscoveryGenerationResolution {
  /** `g<n>` when the generation was read, `unavailable:<uuid>` when it was not. */
  slot: string;
  /** TRUE only when `slot` names a generation this isolate has confirmed. */
  readable: boolean;
}

/**
 * issue #2009 — the isolate-local memo of the last successfully-read
 * generation. Same lifetime and same blast radius as the L1 map in
 * `_memory-cache.ts`: per isolate, dropped when the isolate is recycled.
 */
let generationMemo: { slot: string; readAt: number } | null = null;

/**
 * issue #2009 (BINDING SPEC AMENDMENT 3B, Defect 3) — resolve the cache-key
 * generation slot, reading the database AT MOST ONCE PER
 * `DISCOVER_GENERATION_TTL_MS` per isolate.
 *
 * Amendment 3A threaded the generation into the key but read it on EVERY
 * request, above the L1 lookup — so discovery, the consumer app's hottest path
 * and the exact path ORCH-426 exists to keep off the database, made a round
 * trip even on requests L1 would have served with zero database contact. This
 * bounds the read rather than removing it: inside the ceiling window the answer
 * comes from memory and L1 serves untouched; outside it, one primary-key read
 * on a service-only singleton refreshes it.
 *
 * FAIL CLOSED, unchanged from Amendment 3A. Only a slot built from a valid
 * positive integer is ever remembered. An unreadable generation — RPC error, a
 * throw, null, NaN, a non-integer, a non-positive value — returns the per-call
 * unique `unavailable:<uuid>` slot AND clears the memo, so no request is ever
 * served an entry keyed on a generation this isolate cannot currently confirm,
 * and the next request re-reads rather than coasting on an unconfirmed value.
 */
export async function resolveDiscoveryGeneration(
  readGeneration: () => Promise<DiscoveryGenerationRead>,
  now: number = Date.now(),
): Promise<DiscoveryGenerationResolution> {
  const memo = generationMemo;
  if (
    memo !== null && now >= memo.readAt &&
    now - memo.readAt < DISCOVER_GENERATION_TTL_MS
  ) {
    return { slot: memo.slot, readable: true };
  }

  let read: DiscoveryGenerationRead;
  try {
    read = await readGeneration();
  } catch (err) {
    console.warn(
      "[discover-merged-events] issue #2009 discovery generation read threw; failing closed to an uncacheable key:",
      err instanceof Error ? err.message : String(err),
    );
    generationMemo = null;
    return { slot: discoveryGenerationSlot(null), readable: false };
  }

  if (read.error) {
    console.warn(
      "[discover-merged-events] issue #2009 discovery generation unreadable; failing closed to an uncacheable key:",
      read.error.message,
    );
    generationMemo = null;
    return { slot: discoveryGenerationSlot(null), readable: false };
  }

  const slot = discoveryGenerationSlot(read.data);
  if (slot.startsWith(UNAVAILABLE_GENERATION_PREFIX)) {
    generationMemo = null;
    return { slot, readable: false };
  }

  generationMemo = { slot, readAt: now };
  return { slot, readable: true };
}

/**
 * issue #2009 — the SLOT-ONLY VIEW of the resolver above, for callers that only
 * need the cache-key slot. It is a projection, never a second implementation:
 * the bound, the fail-closed rule and the memo all have exactly one home, so
 * the two answers cannot drift apart.
 */
export async function resolveDiscoveryGenerationSlot(
  readGeneration: () => Promise<DiscoveryGenerationRead>,
  now: number = Date.now(),
): Promise<string> {
  return (await resolveDiscoveryGeneration(readGeneration, now)).slot;
}

export function buildDiscoverCacheKey(p: DiscoverCacheParams): string {
  const normalized = {
    // issue #2009 — the visibility epoch. FIRST slot so a generation change is
    // visible at the head of every key. `null` only ever occurs for a caller
    // that supplied no generation at all; the edge handler always supplies one
    // via discoveryGenerationSlot(), and the #2009 strict-grep gate fails if
    // that threading is removed.
    gen: p.discoveryGeneration ?? null,
    // #1637 — null (not "") for a coords-anchored request, so a coords key can
    // never collide with a city key and JSON.stringify keeps the slot explicit.
    // The client snaps device coordinates to ~110m before they arrive here, so
    // the 4-dp rounding below is a float-jitter guard, not the deduplicator —
    // without the client-side snap a 7-decimal GPS fix would mint one cache row
    // per request and the L2 layer would stop being a cache.
    city: p.cityName === null ? null : p.cityName.trim().toLowerCase(),
    state: p.stateCode ?? null,
    country: p.countryCode ?? null,
    page: p.page,
    size: p.size,
    party: [...p.partyTypeSlugs].sort(),
    vibe: [...p.vibeTagSlugs].sort(),
    music: [...p.musicGenreSlugs].sort(),
    dw: p.dateWindowUtc,
    segment: p.segmentSlug ?? null,
    genres: [...(p.genreSlugs ?? [])].sort(),
    lse: p.localStartEndDateTime ?? null,
    kw: [...(p.keywords ?? [])].sort(),
    sort: p.sort ?? null,
    tz: p.timezone,
    // issue #1020 — geo center/radius folded in (Constitution #13). Round lat/lng
    // to 4 dp (~11 m) to prevent float-jitter cache thrash; null when absent so
    // city-only requests keep their prior key shape's geo slot empty.
    geo: (p.fallbackLat != null && p.fallbackLng != null &&
        p.fallbackRadiusKm != null)
      ? {
        lat: Number(p.fallbackLat.toFixed(4)),
        lng: Number(p.fallbackLng.toFixed(4)),
        r: p.fallbackRadiusKm,
      }
      : null,
  };
  return `discover:${JSON.stringify(normalized)}`;
}

export function discoverCacheExpiresAt(nowMs = Date.now()): string {
  return new Date(nowMs + DISCOVER_CACHE_TTL_MS).toISOString();
}

export function discoverStaleExpiresAt(nowMs = Date.now()): string {
  return new Date(nowMs + DISCOVER_STALE_TTL_MS).toISOString();
}
