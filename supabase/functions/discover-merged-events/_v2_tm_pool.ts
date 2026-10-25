import { localWallClockToUtcInstant } from "../_shared/timezone.ts";

export interface TicketmasterPoolEvent {
  id: string;
  eventName: string;
  venueName: string;
  image: string;
  localDate: string;
  localTime: string | null;
  dateTimeUTC: string | null;
  genre: string | null;
  genreId: string | null;
  subGenreId: string | null;
  priceMin: number | null;
  priceMax: number | null;
  priceCurrency: string | null;
  ticketStatus: string;
  ticketUrl: string;
  [key: string]: unknown;
}

export interface TicketmasterPool {
  items: TicketmasterPoolEvent[];
  /** Start instant of the final date-sorted item retained in the pool. */
  poolCoverageEnd: string | null;
  capped: boolean;
  partial: boolean;
  error: string | null;
  fromCache: boolean;
}

interface PoolRequest {
  anchor: { name: string | null; stateCode: string | null; countryCode: string | null; lat: number; lng: number; radiusKm: number };
  localStartEndDateTime: string;
  timezone: string;
}

export interface TicketmasterPoolStore {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
  from: (table: string) => any;
}

const FRESH_MS = 6 * 60 * 60 * 1_000;
const STALE_MS = 24 * 60 * 60 * 1_000;
const TOTAL_DEADLINE_MS = 4_000;
const CALL_TIMEOUT_MS = 2_500;
const MAX_PAGES = 5;
const PAGE_SIZE = 200;
const DAILY_LIMIT = 2_500;
const cache = new Map<string, { pool: TicketmasterPool; at: number }>();
const builds = new Map<string, Promise<TicketmasterPool>>();

function ticketmasterDiscoveryIdentity(item: TicketmasterPoolEvent): string {
  const title = item.eventName.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  const venue = item.venueName.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return title && title !== "untitled event" ? `title:${title}:venue:${venue}` : `id:${item.id}`;
}

/** Keep the earliest date-sorted performance for each named Ticketmaster event. */
export function collapseTicketmasterOccurrences(
  items: readonly TicketmasterPoolEvent[],
): TicketmasterPoolEvent[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = ticketmasterDiscoveryIdentity(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function ticketmasterPoolMetadata(
  items: readonly TicketmasterPoolEvent[],
  totalElements: number,
  partial: boolean,
  timezone = "UTC",
): Pick<TicketmasterPool, "capped" | "poolCoverageEnd"> {
  const last = items.at(-1);
  let poolCoverageEnd = last?.dateTimeUTC ?? null;
  if (!poolCoverageEnd && last?.localDate) {
    try {
      poolCoverageEnd = localWallClockToUtcInstant(
        `${last.localDate}T${last.localTime ?? "00:00:00"}`,
        timezone,
      );
    } catch {
      // A malformed upstream date must not make the complete pool unreadable.
      // Without a trustworthy coverage instant, capped windows stay conservative.
      poolCoverageEnd = null;
    }
  }
  return {
    // A partial build is also incomplete even when TM's reported total happens
    // to equal the rows received before a failed page.
    capped: partial || totalElements > items.length,
    poolCoverageEnd,
  };
}

export function ticketmasterWindowIsCapped(
  pool: Pick<TicketmasterPool, "capped" | "poolCoverageEnd">,
  windowEndUtc: string,
): boolean {
  if (!pool.capped) return false;
  if (!pool.poolCoverageEnd) return true;
  const coverage = Date.parse(pool.poolCoverageEnd);
  const end = Date.parse(windowEndUtc);
  return !Number.isFinite(coverage) || !Number.isFinite(end) || end > coverage;
}

function localDay(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function poolKey(request: PoolRequest): string {
  return `tmpool:${JSON.stringify({
    city: request.anchor.name?.trim().toLowerCase() ?? null,
    state: request.anchor.stateCode,
    country: request.anchor.countryCode,
    lat: request.anchor.lat.toFixed(2), lng: request.anchor.lng.toFixed(2),
    radius: request.anchor.radiusKm, tz: request.timezone,
    day: localDay(request.timezone), segmentMode: "all", horizonDays: 120,
    poolVersion: 1,
  })}`;
}

async function claimBudget(client: TicketmasterPoolStore): Promise<boolean> {
  const { data, error } = await client.rpc("discover_v2_claim_tm_budget", {
    p_utc_day: new Date().toISOString().slice(0, 10),
    p_limit: DAILY_LIMIT,
  });
  if (error) throw new Error("tm_budget_unavailable");
  return data === true;
}

async function budgetAvailable(client: TicketmasterPoolStore): Promise<boolean> {
  const { data, error } = await client.rpc("discover_v2_tm_budget_available", {
    p_utc_day: new Date().toISOString().slice(0, 10),
    p_limit: DAILY_LIMIT,
  });
  if (error) throw new Error("tm_budget_unavailable");
  return data === true;
}

async function fetchPage(client: TicketmasterPoolStore, request: PoolRequest, page: number, totalDeadline: number): Promise<{ events: TicketmasterPoolEvent[]; total: number }> {
  if (!await claimBudget(client)) throw new Error("tm_budget_exhausted");
  const remaining = totalDeadline - Date.now();
  if (remaining <= 0) throw new Error("tm_deadline");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(CALL_TIMEOUT_MS, remaining));
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const response = await fetch(`${supabaseUrl}/functions/v1/ticketmaster-events`, {
      method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({
        city: request.anchor.name,
        stateCode: request.anchor.stateCode,
        countryCode: request.anchor.countryCode,
        latFallback: request.anchor.lat, lngFallback: request.anchor.lng,
        radiusFallback: request.anchor.radiusKm,
        segmentMode: "all", localStartEndDateTime: request.localStartEndDateTime,
        sort: "date,asc", page, size: PAGE_SIZE,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(response.status === 429 ? "tm_rate_limited" : "tm_unavailable");
    return { events: Array.isArray(payload.events) ? payload.events : [], total: Number(payload.meta?.totalResults ?? 0) };
  } finally { clearTimeout(timer); }
}

async function buildPool(client: TicketmasterPoolStore, request: PoolRequest): Promise<TicketmasterPool> {
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  const first = await fetchPage(client, request, 0, deadline);
  const pageCount = Math.min(MAX_PAGES, Math.ceil(first.total / PAGE_SIZE));
  const items = [...first.events];
  let partial = false;
  let poolError: string | null = null;
  for (let page = 1; page < pageCount; page += 2) {
    const pair = [page, page + 1].filter((value) => value < pageCount);
    const settled = await Promise.allSettled(pair.map((value) => fetchPage(client, request, value, deadline)));
    for (const result of settled) {
      if (result.status === "fulfilled") items.push(...result.value.events);
      else {
        partial = true;
        if (!poolError) poolError = result.reason instanceof Error ? result.reason.message : "tm_unavailable";
      }
    }
    if (Date.now() >= deadline) { partial = true; break; }
  }
  const deduped = [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 1_000);
  return {
    items: deduped,
    ...ticketmasterPoolMetadata(deduped, first.total, partial, request.timezone),
    partial,
    error: poolError,
    fromCache: false,
  };
}

async function readL2(client: TicketmasterPoolStore, key: string): Promise<{ pool: TicketmasterPool; at: number } | null> {
  const { data, error } = await client.from("discover_merged_events_cache")
    .select("response,fetched_at,expires_at").eq("cache_key", key).maybeSingle();
  if (error || !data?.response || data.response.contract !== "tm_pool_v1") return null;
  const at = Date.parse(data.fetched_at);
  if (!Number.isFinite(at) || Date.now() - at > STALE_MS || Date.parse(data.expires_at) <= Date.now()) return null;
  const pool = data.response.pool as TicketmasterPool;
  return pool && Array.isArray(pool.items) ? { pool, at } : null;
}

async function writeL2(client: TicketmasterPoolStore, key: string, pool: TicketmasterPool, at: number): Promise<void> {
  const { error } = await client.from("discover_merged_events_cache").upsert({
    cache_key: key,
    response: { contract: "tm_pool_v1", pool: { ...pool, fromCache: false } },
    fetched_at: new Date(at).toISOString(),
    expires_at: new Date(at + STALE_MS).toISOString(),
  }, { onConflict: "cache_key" });
  if (error) console.warn("[discover-v2] Ticketmaster L2 write failed:", error.message);
}

function runInBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else void task;
}

function refreshPool(client: TicketmasterPoolStore, request: PoolRequest, key: string): Promise<TicketmasterPool> {
  const active = builds.get(key);
  if (active) return active;
  const build = buildPool(client, request).then(async (pool) => {
    const at = Date.now();
    cache.set(key, { pool, at });
    await writeL2(client, key, pool, at);
    return pool;
  }).finally(() => builds.delete(key));
  builds.set(key, build);
  return build;
}

export async function resolveTicketmasterPool(client: TicketmasterPoolStore, request: PoolRequest): Promise<TicketmasterPool> {
  const key = poolKey(request);
  let existing = cache.get(key) ?? null;
  if (existing && Date.now() - existing.at <= FRESH_MS) return { ...existing.pool, fromCache: true };
  if (!existing) {
    existing = await readL2(client, key);
    if (existing) cache.set(key, existing);
    if (existing && Date.now() - existing.at <= FRESH_MS) return { ...existing.pool, fromCache: true };
  }
  if (existing && Date.now() - existing.at <= STALE_MS) {
    try {
      if (!await budgetAvailable(client)) {
        return { ...existing.pool, error: "tm_budget_exhausted", fromCache: true };
      }
    } catch {
      return { ...existing.pool, error: "tm_budget_unavailable", fromCache: true };
    }
    runInBackground(refreshPool(client, request, key).catch(() => undefined));
    return { ...existing.pool, fromCache: true };
  }
  try {
    return await refreshPool(client, request, key);
  } catch (error) {
    return { items: [], poolCoverageEnd: null, capped: false, partial: true, error: error instanceof Error ? error.message : "tm_unavailable", fromCache: false };
  }
}

export function resetTicketmasterPoolForTests(): void {
  cache.clear();
  builds.clear();
}
