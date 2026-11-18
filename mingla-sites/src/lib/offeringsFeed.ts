import { parseOfferingsFeed, type SiteOffering } from "../contracts/generated/offerings.ts";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { signedCorePost, type SiteBinding } from "./coreGateway";
import { emitPublicObservation } from "./observability";

/*
 * #2829 AD-6 — a site's offerings, LIVE from Mingla.
 *
 * Mingla stays the only source of truth: spots left, sold out, cancellations,
 * new and ended trips show up without a republish. Each site's feed is cached
 * for 60 s; after that the cached copy is served while ONE refresh runs in the
 * background (stale-while-revalidate, up to 10 minutes). When Core cannot be
 * reached and nothing usable is cached, the page renders from the snapshot
 * frozen into its publication — a site never fails because Core is slow.
 * Every fallback is logged (no silent failure).
 */
export const FEED_FRESH_MS = 60_000;
export const FEED_STALE_MAX_MS = 10 * 60_000;
export const FEED_TIMEOUT_MS = 2_500;

export type SiteOfferingsView = {
  source: "live" | "snapshot";
  offerings: readonly SiteOffering[];
  /**
   * #4453 milestone 9 — SITES_DETAIL_PAGES, read by Core with the live feed.
   * The snapshot fallback is always off (cards link to Mingla, no detail
   * routes): a flag nobody could read fails closed.
   */
  detailPages: boolean;
};

type Entry = { offerings: SiteOffering[]; detailPages: boolean; fetchedAt: number; refreshing: Promise<void> | null };

const cache = new Map<string, Entry>();

/** Test hook: forget every cached feed. */
export function clearOfferingsCache(): void {
  cache.clear();
}

export type FeedFetcher = (site: SiteBinding) => Promise<SiteOffering[] | { offerings: SiteOffering[]; detailPages: boolean }>;

function feedResult(value: Awaited<ReturnType<FeedFetcher>>): { offerings: SiteOffering[]; detailPages: boolean } {
  return Array.isArray(value) ? { offerings: value, detailPages: false } : value;
}

/** Core's live feed for ONE resolved site (signed, site-bound). */
export const fetchCoreFeed: FeedFetcher = async (site) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await Promise.race([
      signedCorePost({
        edgeFunction: "brand-site-runtime-resolve",
        path: `/internal/v1/sites/${site.site_id}/offerings`,
        site,
        body: { site_id: site.site_id },
      }),
      new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("FEED_TIMEOUT")))),
    ]);
    if (!response.ok) throw new Error("FEED_UNAVAILABLE");
    const payload = await response.json() as { ok?: unknown; data?: unknown };
    if (payload?.ok !== true) throw new Error("FEED_UNAVAILABLE");
    const feed = parseOfferingsFeed(payload.data);
    return { offerings: feed.offerings, detailPages: feed.detail_pages === true };
  } finally {
    clearTimeout(timer);
  }
};

function observe(site: SiteBinding, metric: string, transition: string): void {
  emitPublicObservation({
    event: "mingla_sites_state",
    metric,
    request_id: crypto.randomUUID(),
    operation_id: null,
    site_id: site.site_id,
    publication_id: null,
    direction: "public_runtime",
    route: "/offerings",
    state_transition: transition,
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: null,
    status_code: null,
    version: "sites-v1",
  });
}

function refresh(site: SiteBinding, fetcher: FeedFetcher, now: () => number): Promise<void> {
  const entry = cache.get(site.site_id);
  if (entry?.refreshing) return entry.refreshing;
  const run = fetcher(site)
    .then((value) => {
      cache.set(site.site_id, { ...feedResult(value), fetchedAt: now(), refreshing: null });
    })
    .catch(() => {
      const current = cache.get(site.site_id);
      if (current) current.refreshing = null;
      observe(site, "public.offerings.refresh_failed", "feed_refresh->kept_cached");
    });
  if (entry) entry.refreshing = run;
  return run;
}

/**
 * The offerings a site shows right now. `site` is the object Core resolved
 * for this request's host (never a caller-supplied id); `artifact` supplies
 * the snapshot fallback and must belong to the same site.
 */
export async function siteOfferings(
  site: SiteBinding,
  artifact: Pick<ArtifactV2, "site_id" | "offerings_snapshot">,
  deps: { fetcher?: FeedFetcher; now?: () => number } = {},
): Promise<SiteOfferingsView> {
  if (artifact.site_id !== site.site_id) throw new Error("SITE_SCOPE_MISMATCH");
  const fetcher = deps.fetcher ?? fetchCoreFeed;
  const now = deps.now ?? Date.now;
  const entry = cache.get(site.site_id);
  const age = entry ? now() - entry.fetchedAt : Number.POSITIVE_INFINITY;
  if (entry && age < FEED_FRESH_MS) return { source: "live", offerings: entry.offerings, detailPages: entry.detailPages };
  if (entry && age < FEED_STALE_MAX_MS) {
    void refresh(site, fetcher, now);
    return { source: "live", offerings: entry.offerings, detailPages: entry.detailPages };
  }
  try {
    const { offerings, detailPages } = feedResult(await fetcher(site));
    cache.set(site.site_id, { offerings, detailPages, fetchedAt: now(), refreshing: null });
    return { source: "live", offerings, detailPages };
  } catch {
    cache.delete(site.site_id);
    observe(site, "public.offerings.snapshot_served", "feed_unavailable->snapshot_served");
    return { source: "snapshot", offerings: artifact.offerings_snapshot ?? [], detailPages: false };
  }
}
