/*
 * #2829 AD-6 (T-W4, SC-17) — the live offerings feed: 60 s per-site cache,
 * stale-while-revalidate, and the publication snapshot when Core cannot be
 * reached. A site never fails because Core is slow, and the feed is only ever
 * read for the site Core resolved (S-1).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./coreGateway", () => ({ signedCorePost: vi.fn() }));
const observations: string[] = [];
vi.mock("./observability", () => ({ emitPublicObservation: (o: { metric: string }) => observations.push(o.metric) }));

import { clearOfferingsCache, FEED_FRESH_MS, FEED_STALE_MAX_MS, siteOfferings, type FeedFetcher } from "./offeringsFeed";
import type { SiteOffering } from "../contracts/generated/offerings.ts";

const SITE = { site_id: "aaaaaaaa-1111-4111-8111-111111111111" };
const offering = (title: string): SiteOffering => ({
  id: "11111111-1111-4111-8111-111111111111", kind: "trip", slug: "bali", title, summary: null, cover: null,
  destination_text: null, start_at: null, end_at: null, timezone: null, status: "scheduled", bookings_closed: false,
  capacity: null, spots_left: null, group_minimum: null, min_price_minor: null, currency: null, has_free_tier: false,
  public_url: "https://host.usemingla.com/t/b/bali", waitlist_enabled: false, installments_available: false,
});
const artifact = { site_id: SITE.site_id, offerings_snapshot: [offering("From the snapshot")] };

beforeEach(() => {
  clearOfferingsCache();
  observations.length = 0;
});

describe("#2829 siteOfferings", () => {
  it("serves the live feed and caches it for 60 s", async () => {
    let clock = 1_000_000;
    const fetcher = vi.fn<FeedFetcher>().mockResolvedValue([offering("Live")]);
    const first = await siteOfferings(SITE, artifact, { fetcher, now: () => clock });
    expect(first).toEqual({ source: "live", offerings: [offering("Live")] });
    clock += FEED_FRESH_MS - 1;
    await siteOfferings(SITE, artifact, { fetcher, now: () => clock });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("after 60 s serves the cached copy and refreshes once in the background", async () => {
    let clock = 1_000_000;
    const fetcher = vi.fn<FeedFetcher>().mockResolvedValueOnce([offering("Old")]).mockResolvedValueOnce([offering("New")]);
    await siteOfferings(SITE, artifact, { fetcher, now: () => clock });
    clock += FEED_FRESH_MS + 1;
    const stale = await siteOfferings(SITE, artifact, { fetcher, now: () => clock });
    expect(stale.offerings[0]!.title).toBe("Old");
    await siteOfferings(SITE, artifact, { fetcher, now: () => clock });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fresh = await siteOfferings(SITE, artifact, { fetcher, now: () => clock });
    expect(fresh.offerings[0]!.title).toBe("New");
  });

  it("falls back to the publication snapshot when Core is unreachable, and says so in the logs", async () => {
    const fetcher = vi.fn<FeedFetcher>().mockRejectedValue(new Error("CORE_DOWN"));
    const view = await siteOfferings(SITE, artifact, { fetcher });
    expect(view).toEqual({ source: "snapshot", offerings: artifact.offerings_snapshot });
    expect(observations).toContain("public.offerings.snapshot_served");
  });

  it("past the stale window a failed refresh also falls back to the snapshot", async () => {
    let clock = 1_000_000;
    const fetcher = vi.fn<FeedFetcher>().mockResolvedValueOnce([offering("Old")]).mockRejectedValue(new Error("CORE_DOWN"));
    await siteOfferings(SITE, artifact, { fetcher, now: () => clock });
    clock += FEED_STALE_MAX_MS + 1;
    expect((await siteOfferings(SITE, artifact, { fetcher, now: () => clock })).source).toBe("snapshot");
  });

  it("refuses an artifact that belongs to another site", async () => {
    await expect(siteOfferings(SITE, { ...artifact, site_id: "bbbbbbbb-2222-4222-8222-222222222222" }, { fetcher: vi.fn() }))
      .rejects.toThrow("SITE_SCOPE_MISMATCH");
  });

  it("reads Core through the site-bound signed gateway", async () => {
    const { signedCorePost } = await import("./coreGateway");
    vi.mocked(signedCorePost).mockResolvedValue(Response.json({
      ok: true,
      data: { generated_at: "2026-10-26T00:00:00.000Z", brand: { slug: "b", currency: "USD", payment_rails: "stripe" }, offerings: [offering("Live")] },
    }));
    const view = await siteOfferings(SITE, artifact);
    expect(view.source).toBe("live");
    expect(signedCorePost).toHaveBeenCalledWith({
      edgeFunction: "brand-site-runtime-resolve",
      path: `/internal/v1/sites/${SITE.site_id}/offerings`,
      site: SITE,
      body: { site_id: SITE.site_id },
    });
  });
});
