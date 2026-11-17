/*
 * #4453 milestone 9 (spec v2.1 §1.2, §1.3, N1) — offering detail pages.
 *
 * MINGLA-INVARIANT: I-SITES-DETAIL-BOOKS-ON-MINGLA | issue #4453 | a detail page's one booking action is the feed row's public_url (a canonical Mingla page passing isMinglaActionHref); no price, count or date on it comes from anything but the feed or brand_site_offering_detail; with SITES_DETAIL_PAGES off there is no detail route and cards link to Mingla.
 *
 * Pins: routing (step 3b) and 404 for unknown, cancelled, hidden and
 * another brand's offerings; the redirect when a slug changes; flag on and
 * off (cards and routes); the hand-off target; SEO (title, description,
 * canonical, social image, noindex when ended) and JSON-LD per kind with no
 * rating; the sitemap; ROUTE_COLLISION; and every design drawing a detail page.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const feed = vi.hoisted(() => ({ detailPages: true, offerings: [] as unknown[], source: "live" as "live" | "snapshot" }));
vi.mock("./offeringsFeed", () => ({
  siteOfferings: async () => ({ source: feed.source, offerings: feed.offerings, detailPages: feed.detailPages }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/trips/island-week", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
vi.mock("./config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 7).toString("base64"), videoCdnHosts: [] }) }));

import { DESIGN_KEYS } from "../contracts/generated/designs.ts";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import type { SiteOffering } from "../contracts/generated/offerings.ts";
import { DEFAULT_SITE_ROUTES, isSiteRoutes, findPathCollisions } from "../contracts/generated/routes.ts";
import { findOfferingRouteCollisions, offeringDetailPath, parseOfferingDetail } from "../contracts/generated/offeringDetail.ts";
import { isMinglaActionHref } from "../contracts/generated/safety.ts";
import { galleryArtifact } from "../designs/shared/galleryDesigns.fixture";
import { detailAction } from "../designs/shared/blocks/Detail";
import { SiteDocument } from "../components/v2/SiteDocument";
import { clearOfferingDetailCache, cut, detailSitemapPaths, resolveOfferingDetail, type DetailFetcher, type OfferingDetailView } from "./offeringDetail";
import { loadLiveOfferings, offeringFilters } from "./offeringCards";
import { buildPageMetadata } from "./seo";
import { detailItem, pageStructuredData, serializeJsonLd } from "./structuredData";

const NOW = new Date("2026-11-16T12:00:00Z");
const DAY = 86_400_000;
const SITE = { site_id: "" };
const TRIP_ID = "bbbbbbbb-bbbb-4ccc-8ddd-000000000901";
const ROOM_ID = "bbbbbbbb-bbbb-4ccc-8ddd-000000000902";

function offering(over: Partial<SiteOffering> & Pick<SiteOffering, "id" | "kind" | "slug" | "title">): SiteOffering {
  return {
    summary: "Seven days on the ridges, staying in fishermen's cabins on the water and walking to the views most people only see in photos.",
    cover: { path: "event_covers/fixture/lofoten.jpg", type: "image" },
    destination_text: "Lofoten, Norway",
    start_at: new Date(NOW.getTime() + 30 * DAY).toISOString(),
    end_at: new Date(NOW.getTime() + 36 * DAY).toISOString(),
    timezone: "Europe/Oslo",
    status: "scheduled",
    bookings_closed: false,
    capacity: 12,
    spots_left: 4,
    group_minimum: null,
    min_price_minor: 149000,
    currency: "GBP",
    has_free_tier: false,
    public_url: over.kind === "stay"
      ? `https://host.usemingla.com/b/fixture-brand/v/lagoon?tab=stay&room=${over.id}`
      : `https://host.usemingla.com/${over.kind === "trip" ? "t" : over.kind === "event" ? "e" : "exp"}/fixture-brand/${over.slug}`,
    waitlist_enabled: false,
    installments_available: false,
    ...over,
  } as SiteOffering;
}

const trip = offering({ id: TRIP_ID, kind: "trip", slug: "island-week", title: "Lofoten Peaks" });
const room = offering({ id: ROOM_ID, kind: "stay", slug: ROOM_ID, title: "Lagoon Room", start_at: null, end_at: null, timezone: null, destination_text: "Lagoon Stay", spots_left: null, min_price_minor: 12500000, currency: "NGN" });
const event = offering({ id: "bbbbbbbb-bbbb-4ccc-8ddd-000000000903", kind: "event", slug: "harbourside", title: "Harbourside Night", spots_left: 40 });
const ended = offering({ id: "bbbbbbbb-bbbb-4ccc-8ddd-000000000904", kind: "trip", slug: "last-summer", title: "Last Summer", start_at: new Date(NOW.getTime() - 40 * DAY).toISOString(), end_at: new Date(NOW.getTime() - 35 * DAY).toISOString(), status: "ended" });
const cancelled = offering({ id: "bbbbbbbb-bbbb-4ccc-8ddd-000000000905", kind: "trip", slug: "called-off", title: "Called Off", status: "cancelled" });
const soldOut = offering({ id: "bbbbbbbb-bbbb-4ccc-8ddd-000000000906", kind: "trip", slug: "full-up", title: "Full Up", spots_left: 0, waitlist_enabled: false });
const hiddenTrip = offering({ id: "bbbbbbbb-bbbb-4ccc-8ddd-000000000907", kind: "trip", slug: "kept-quiet", title: "Kept Quiet" });
const undatedSession = offering({ id: "bbbbbbbb-bbbb-4ccc-8ddd-000000000908", kind: "experience", slug: "pottery", title: "Pottery", start_at: null, end_at: null });

const tripExtras = {
  offering_id: TRIP_ID, kind: "trip",
  days: [{ day: 1, title: "Leknes to Hamnøy", summary: "Transfer, kit check and an evening walk" }, { day: 2, title: "Reinebringen", summary: null }],
  included: ["Two guides", "Every breakfast"], stay: null, photos: [],
};
const roomExtras = {
  offering_id: ROOM_ID, kind: "stay", days: [], included: [],
  stay: { kind: "room", max_guests: 4, max_adults: 4, max_children: 2, amenities: ["Wi-Fi"], accessibility: ["Step-free entrance"] },
  photos: [{ path: "brand_covers/fixture/room-2.jpg", alt: "The bed" }],
};
const fetcher: DetailFetcher = async (_site, kind) => (kind === "trip" ? tripExtras : kind === "stay" ? roomExtras : null);

function artifactFor(key = "voyage" as (typeof DESIGN_KEYS)[number]): ArtifactV2 {
  const artifact = galleryArtifact(key);
  artifact.offerings_snapshot = [{ ...trip, slug: "island-week-old" }];
  artifact.site_display = { hidden_offering_ids: [hiddenTrip.id] } as ArtifactV2["site_display"];
  return artifact;
}

async function resolve(path: string, artifact = artifactFor()) {
  return resolveOfferingDetail({ site: { site_id: artifact.site_id }, artifact, path, now: NOW, fetcher });
}

async function framePage(path: string, artifact = artifactFor()) {
  const resolved = await resolve(path, artifact);
  if (resolved?.kind !== "detail") throw new Error(`no detail at ${path}`);
  return resolved.page;
}

async function detailView(path: string, artifact = artifactFor()): Promise<OfferingDetailView> {
  const resolved = await resolve(path, artifact);
  if (resolved?.kind !== "detail") throw new Error(`no detail at ${path}`);
  return resolved.detail;
}

beforeEach(() => {
  clearOfferingDetailCache();
  feed.detailPages = true;
  feed.source = "live";
  feed.offerings = [trip, room, event, ended, cancelled, soldOut, hiddenTrip, undatedSession];
});

describe("#4453 M9 routing (step 3b)", () => {
  it("renders an upcoming trip at /{trips base}/{slug} and a room at the default rooms base", async () => {
    const tripPage = await resolve("trips/island-week");
    expect(tripPage?.kind).toBe("detail");
    if (tripPage?.kind !== "detail") return;
    expect(tripPage.page.title).toBe("Lofoten Peaks");
    expect(tripPage.detail.extras?.days).toHaveLength(2);
    expect(tripPage.detail.parent.href).toBe("/trips");
    const roomPage = await resolve(`rooms/${ROOM_ID}`);
    expect(roomPage?.kind === "detail" && roomPage.detail.extras?.stay?.max_guests).toBe(4);
    expect(offeringDetailPath(DEFAULT_SITE_ROUTES, room)).toBe(`rooms/${ROOM_ID}`);
  });

  it("404s an unknown slug, a cancelled or hidden offering, the wrong base, and another brand's offering (never in this site's feed)", async () => {
    expect(await resolve("trips/nowhere")).toBeNull();
    expect(await resolve("trips/called-off")).toBeNull();
    expect(await resolve("trips/kept-quiet")).toBeNull();
    expect(await resolve("events/island-week")).toBeNull();
    expect(await resolve("trips/island-week/extra")).toBeNull();
    feed.offerings = [room];
    expect(await resolve("trips/island-week")).toBeNull();
  });

  it("308s an old slug (the publish-time snapshot) and the offering's id to its current address", async () => {
    expect(await resolve("trips/island-week-old")).toEqual({ kind: "redirect", location: "/trips/island-week", status: 308 });
    expect(await resolve(`trips/${TRIP_ID}`)).toEqual({ kind: "redirect", location: "/trips/island-week", status: 308 });
  });

  it("flag off (or Core unreachable, the snapshot): no detail route, and every card links to Mingla", async () => {
    feed.detailPages = false;
    expect(await resolve("trips/island-week")).toBeNull();
    const artifact = artifactFor();
    const off = await loadLiveOfferings({ site_id: artifact.site_id }, artifact, offeringFilters(undefined), NOW);
    expect([...off.cards.values()].every((card) => card.detailHref === null)).toBe(true);
    expect(off.cards.get(TRIP_ID)?.href).toBe(trip.public_url);
    feed.detailPages = true;
    feed.source = "snapshot";
    const on = await loadLiveOfferings({ site_id: artifact.site_id }, artifact, offeringFilters(undefined), NOW);
    expect(on.cards.get(TRIP_ID)?.detailHref).toBe("/trips/island-week");
    expect(on.cards.get(TRIP_ID)?.href).toBe(trip.public_url);
    expect(on.cards.get(cancelled.id)?.detailHref).toBeNull();
    expect(on.cards.get(hiddenTrip.id)?.detailHref).toBeNull();
  });

  it("an owner's own rooms base is honoured; an old artifact without one still validates", () => {
    expect(isSiteRoutes(DEFAULT_SITE_ROUTES)).toBe(true);
    expect(isSiteRoutes({ ...DEFAULT_SITE_ROUTES, stays: "suites" })).toBe(true);
    expect(isSiteRoutes({ ...DEFAULT_SITE_ROUTES, stays: "book" })).toBe(false);
    expect(offeringDetailPath({ ...DEFAULT_SITE_ROUTES, stays: "suites" }, room)).toBe(`suites/${ROOM_ID}`);
    expect(findPathCollisions({ pages: [], routes: { ...DEFAULT_SITE_ROUTES, stays: "trips" } })).toHaveLength(1);
  });
});

describe("#4453 M9 states and the hand-off (SC-DP1, SC-DP2)", () => {
  it("ended: says so, lists other upcoming items, noindex, no booking action", async () => {
    const view = await detailView("trips/last-summer");
    expect(view.ended).toBe(true);
    const resolved = await resolve("trips/last-summer");
    expect(resolved?.kind === "detail" && resolved.page.seo?.noindex).toBe(true);
    const html = renderToStaticMarkup(<SiteDocument artifact={artifactFor()} page={resolved?.kind === "detail" ? resolved.page : undefined} detail={view} />);
    expect(html).toContain("This trip has ended.");
    expect(html).toContain("Upcoming trips");
    expect(html).not.toContain(`href="${ended.public_url}"`);
  });

  it("the one booking action is the feed's public_url and passes the booking lock; sold out shows the status instead", async () => {
    const view = await detailView("trips/island-week");
    const action = detailAction(view);
    expect(action?.href).toBe(trip.public_url);
    expect(isMinglaActionHref(action?.href, null, "booking")).toBe(true);
    const full = await detailView("trips/full-up");
    expect(detailAction(full)).toBeNull();
    const html = renderToStaticMarkup(<SiteDocument artifact={artifactFor()} detail={full} page={await framePage("trips/full-up")} />);
    expect(html).toContain("Sold out");
    expect(html).not.toContain("Book this trip");
    // A feed row whose page is not a canonical Mingla page gets no action at all.
    expect(detailAction({ ...view, offering: { ...view.offering, public_url: "https://evil.example/t/x" } })).toBeNull();
  });

  it("every price, date and count on the page is the feed row's (the extras carry none)", async () => {
    const view = await detailView("trips/island-week");
    const html = renderToStaticMarkup(<SiteDocument artifact={artifactFor()} detail={view} page={await framePage("trips/island-week")} />);
    expect(html).toContain(view.card.price!.replace(/^From /, ""));
    expect(html).toContain(view.card.dates);
    expect(html).toContain("4 places left");
    expect(parseOfferingDetail({ ...tripExtras, min_price_minor: 1 }, { id: TRIP_ID, kind: "trip" })).toBeNull();
  });
});

describe("#4453 M9 SEO and JSON-LD (SC-S1)", () => {
  it("title, description (summary cut to 160), self-canonical and the cover as the social image", async () => {
    const artifact = artifactFor();
    const resolved = await resolve("trips/island-week", artifact);
    if (resolved?.kind !== "detail") throw new Error("no detail");
    const meta = buildPageMetadata({ artifact, page: resolved.page, origin: "https://far-field.example", noindex: false, detailCover: { url: resolved.detail.card.coverUrl, alt: "Lofoten Peaks" } });
    expect((meta.title as { absolute: string }).absolute).toMatch(/^Lofoten Peaks .+/);
    expect(meta.description).toBe(cut(trip.summary!, 160));
    expect(String(meta.description).length).toBeLessThanOrEqual(160);
    expect(meta.alternates?.canonical).toBe("https://far-field.example/trips/island-week");
    expect(JSON.stringify(meta.openGraph)).toContain("https://far-field.example/om/");
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("TouristTrip, Event, LodgingBusiness and Product from live data, never a rating; nothing for an ended offering", async () => {
    const artifact = artifactFor();
    const origin = "https://far-field.example";
    const tripLd = detailItem(artifact, await detailView("trips/island-week", artifact), origin)!;
    expect(tripLd["@type"]).toBe("TouristTrip");
    expect(tripLd.offers).toMatchObject({ "@type": "Offer", url: trip.public_url, price: "1490.00", priceCurrency: "GBP" });
    expect(tripLd.url).toBe(`${origin}/trips/island-week`);
    expect((await detailView("events/harbourside", artifact)).offering.kind).toBe("event");
    expect(detailItem(artifact, await detailView("events/harbourside", artifact), origin)!["@type"]).toBe("Event");
    const stay = detailItem(artifact, await detailView(`rooms/${ROOM_ID}`, artifact), origin)!;
    expect(stay["@type"]).toBe("LodgingBusiness");
    expect((stay.makesOffer as Record<string, unknown>).itemOffered).toMatchObject({ "@type": "HotelRoom", name: "Lagoon Room" });
    expect(detailItem(artifact, await detailView("experiences/pottery", artifact), origin)!["@type"]).toBe("Product");
    expect(detailItem(artifact, await detailView("trips/last-summer", artifact), origin)).toBeNull();
    const resolved = await resolve("trips/island-week", artifact);
    if (resolved?.kind !== "detail") throw new Error("no detail");
    const graph = serializeJsonLd(pageStructuredData({ artifact, page: resolved.page, live: resolved.live, origin, detail: resolved.detail }));
    expect(graph).not.toMatch(/Rating/);
    expect(graph).toContain("BreadcrumbList");
  });

  it("the sitemap lists open details only (not ended, cancelled or hidden), and none while the flag is off", async () => {
    const artifact = artifactFor();
    const paths = await detailSitemapPaths({ site_id: artifact.site_id }, artifact, NOW);
    expect(paths).toContain("trips/island-week");
    expect(paths).toContain(`rooms/${ROOM_ID}`);
    expect(paths).toContain("trips/full-up");
    expect(paths).not.toContain("trips/last-summer");
    expect(paths).not.toContain("trips/called-off");
    expect(paths).not.toContain("trips/kept-quiet");
    feed.detailPages = false;
    expect(await detailSitemapPaths({ site_id: artifact.site_id }, artifact, NOW)).toEqual([]);
  });
});

describe("#4453 M9 ROUTE_COLLISION (SC-DP3)", () => {
  it("a live page at a live offering's detail address collides; an ended or cancelled one does not", () => {
    const offerings = [trip, ended, cancelled];
    expect(findOfferingRouteCollisions({ paths: ["", "trips", "trips/island-week"], routes: DEFAULT_SITE_ROUTES, offerings, now: NOW })).toHaveLength(1);
    expect(findOfferingRouteCollisions({ paths: ["trips/last-summer", "trips/called-off"], routes: DEFAULT_SITE_ROUTES, offerings, now: NOW })).toEqual([]);
  });
});

describe("#4453 M9 every design draws a detail page", () => {
  it.each(DESIGN_KEYS)("%s: one h1, crumbs back to the listing, the booking card with the Mingla action, its stylesheet", async (key) => {
    const artifact = artifactFor(key);
    const resolved = await resolve("trips/island-week", artifact);
    if (resolved?.kind !== "detail") throw new Error("no detail");
    const html = renderToStaticMarkup(<SiteDocument artifact={artifact} page={resolved.page} live={resolved.live} detail={resolved.detail} />);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('class="mg-dtl"');
    expect(html).toContain("Lofoten Peaks");
    expect(html).toContain("Day by day");
    expect(html).toContain("Two guides");
    expect(html).toContain(`href="${trip.public_url}"`);
    expect(html).toContain("Booked and paid through Mingla");
    expect(html).toContain("Back to");
    expect(html).toContain("/designs/_shared/detail-1.css");
    expect(html).toContain("/designs/_shared/blocks-2.css");
    const roomPage = await resolve(`rooms/${ROOM_ID}`, artifact);
    if (roomPage?.kind !== "detail") throw new Error("no room");
    const roomHtml = renderToStaticMarkup(<SiteDocument artifact={artifact} page={roomPage.page} live={roomPage.live} detail={roomPage.detail} />);
    expect(roomHtml).toContain("Sleeps up to 4");
    expect(roomHtml).toContain("Book this room");
    expect(roomHtml).toMatch(/\/om\/[A-Za-z0-9_-]{43}\/original\?d=stay%3A/);
  });
});
