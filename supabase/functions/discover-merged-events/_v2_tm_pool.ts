interface TicketmasterPoolEvent {
  id: string;
  eventName: string;
  venueName: string;
  image: string;
  localDate: string;
  localTime: string | null;
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

const FRESH_MS = 6 * 60 * 60 * 1_000;
const STALE_MS = 24 * 60 * 60 * 1_000;
const TOTAL_DEADLINE_MS = 4_000;
const CALL_TIMEOUT_MS = 2_500;
const MAX_PAGES = 5;
const PAGE_SIZE = 200;
const DAILY_LIMIT = 2_500;
const cache = new Map<string, { pool: TicketmasterPool; at: number }>();
const builds = new Map<string, Promise<TicketmasterPool>>();
let budgetDay = "";
let budgetCalls = 0;

function localDay(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function poolKey(request: PoolRequest): string {
  return JSON.stringify({
    city: request.anchor.name?.trim().toLowerCase() ?? null,
    state: request.anchor.stateCode,
    country: request.anchor.countryCode,
    lat: request.anchor.lat.toFixed(2), lng: request.anchor.lng.toFixed(2),
    radius: request.anchor.radiusKm, tz: request.timezone,
    day: localDay(request.timezone), segmentMode: "all", horizonDays: 120,
  });
}

function claimBudget(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== budgetDay) { budgetDay = day; budgetCalls = 0; }
  if (budgetCalls >= DAILY_LIMIT) return false;
  budgetCalls += 1;
  return true;
}

async function fetchPage(request: PoolRequest, page: number, totalDeadline: number): Promise<{ events: TicketmasterPoolEvent[]; total: number }> {
  if (!claimBudget()) throw new Error("tm_budget_exhausted");
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

async function buildPool(request: PoolRequest): Promise<TicketmasterPool> {
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  const first = await fetchPage(request, 0, deadline);
  const pageCount = Math.min(MAX_PAGES, Math.ceil(first.total / PAGE_SIZE));
  const items = [...first.events];
  let partial = false;
  for (let page = 1; page < pageCount; page += 2) {
    const pair = [page, page + 1].filter((value) => value < pageCount);
    const settled = await Promise.allSettled(pair.map((value) => fetchPage(request, value, deadline)));
    for (const result of settled) {
      if (result.status === "fulfilled") items.push(...result.value.events);
      else partial = true;
    }
    if (Date.now() >= deadline) { partial = true; break; }
  }
  const deduped = [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 1_000);
  return { items: deduped, capped: partial || first.total > deduped.length, partial, error: null, fromCache: false };
}

export async function resolveTicketmasterPool(request: PoolRequest): Promise<TicketmasterPool> {
  const key = poolKey(request);
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at <= FRESH_MS) return { ...existing.pool, fromCache: true };
  if (budgetCalls >= DAILY_LIMIT && existing && Date.now() - existing.at <= STALE_MS) return { ...existing.pool, error: "tm_budget_exhausted", fromCache: true };
  const active = builds.get(key);
  if (active) return active;
  const build = buildPool(request).then((pool) => { cache.set(key, { pool, at: Date.now() }); return pool; }).catch((error) => {
    if (existing && Date.now() - existing.at <= STALE_MS) return { ...existing.pool, error: error instanceof Error ? error.message : "tm_unavailable", fromCache: true };
    return { items: [], capped: false, partial: true, error: error instanceof Error ? error.message : "tm_unavailable", fromCache: false };
  }).finally(() => builds.delete(key));
  builds.set(key, build);
  return build;
}
