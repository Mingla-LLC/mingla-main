/*
 * #4453 milestone 9, tester's adversarial angles on the detail resolver
 * (a different angle from offeringDetail.issue4453.implementor.test.tsx):
 * open-redirect attempts through the slug-change 308, id and slug guessing
 * across kinds and brands, hidden and cancelled offerings reached by id or an
 * old slug, path tricks (case, encoding, extra segments, dot segments), the
 * ended page's noindex and empty JSON-LD, ratings never in JSON-LD, and the
 * Book action refusing anything that is not a canonical Mingla page.
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


const RIVAL_TRIP_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";

describe("#4453 M9 tester: the 308 never leaves the site", () => {
  it.each([
    "//evil.example/x", "/\\evil.example", "https://evil.example", "..", "../../admin", "%2F%2Fevil.example",
    "evil.example/x", " island-week", "island-week?x=1", "javascript:alert(1)",
  ])("a feed row whose current slug is %j never becomes a redirect location", async (slug) => {
    const artifact = artifactFor();
    artifact.offerings_snapshot = [{ ...trip, slug: "island-week-old" }];
    feed.offerings = [{ ...trip, slug }];
    const viaOld = await resolve("trips/island-week-old", artifact);
    const viaId = await resolve(`trips/${TRIP_ID}`, artifact);
    for (const result of [viaOld, viaId]) {
      if (result?.kind === "redirect") {
        expect(result.location).toMatch(/^\/[a-z0-9]/i);
        expect(result.location.startsWith("//")).toBe(false);
        expect(result.location).not.toMatch(/[:\\?#\s]|\.\./);
      }
    }
  });

  it("the id and the old slug redirect only to the same site's current path (308)", async () => {
    const viaId = await resolve(`trips/${TRIP_ID.toUpperCase()}`);
    expect(viaId).toEqual({ kind: "redirect", location: "/trips/island-week", status: 308 });
    expect(await resolve("trips/island-week-old")).toEqual({ kind: "redirect", location: "/trips/island-week", status: 308 });
  });

  it("no redirect for a hidden or cancelled offering reached by its id or an old slug", async () => {
    const artifact = artifactFor();
    artifact.offerings_snapshot = [{ ...hiddenTrip, slug: "quiet-old" }, { ...cancelled, slug: "off-old" }];
    expect(await resolve(`trips/${hiddenTrip.id}`, artifact)).toBeNull();
    expect(await resolve("trips/quiet-old", artifact)).toBeNull();
    expect(await resolve(`trips/${cancelled.id}`, artifact)).toBeNull();
    expect(await resolve("trips/off-old", artifact)).toBeNull();
  });
});

describe("#4453 M9 tester: guessing across kinds, brands and path shapes is a 404", () => {
  it.each([
    `rooms/${TRIP_ID}`, `events/${TRIP_ID}`, `experiences/island-week`, `trips/${ROOM_ID}`,
    `trips/${RIVAL_TRIP_ID}`, "trips/Island-Week", "trips/island-week%20", "trips/island%2Dweek",
    "trips/island-week/", "trips//island-week", "trips/./island-week", "trips/island-week/..", "Trips/island-week",
  ])("%s", async (path) => {
    const result = await resolve(path);
    expect(result === null || (result.kind === "redirect" && result.location === "/trips/island-week")).toBe(true);
    expect(result?.kind).not.toBe("detail");
  });

  it("an old snapshot slug that now belongs to another kind does not cross kinds", async () => {
    const artifact = artifactFor();
    artifact.offerings_snapshot = [{ ...event, slug: "harbour-old" }];
    expect(await resolve("trips/harbour-old", artifact)).toBeNull();
  });
});

describe("#4453 M9 tester: ended pages, JSON-LD and the Book action", () => {
  it("an ended trip is a noindex page with no JSON-LD item and no Book action", async () => {
    const view = await detailView("trips/last-summer");
    expect(view.ended).toBe(true);
    expect((await framePage("trips/last-summer")).seo?.noindex).toBe(true);
    expect(detailItem(artifactFor(), view, "https://example.test")).toBeNull();
    expect(detailAction(artifactFor(), view)).toBeNull();
  });

  it("no detail JSON-LD ever carries a rating, review or aggregate, for any kind", async () => {
    for (const path of ["trips/island-week", `rooms/${ROOM_ID}`, "events/harbourside", "experiences/pottery"]) {
      const view = await detailView(path);
      const json = JSON.stringify(detailItem(artifactFor(), view, "https://example.test"));
      expect(json).not.toMatch(/rating|review/i);
    }
  });

  it.each([
    "https://evil.example/t/fixture-brand/island-week",
    "http://host.usemingla.com/t/fixture-brand/island-week",
    "https://host.usemingla.com.evil.example/t/fixture-brand/island-week",
    "https://www.opentable.com/r/fixture",
    "javascript:alert(1)",
  ])("a feed row whose public_url is %j gets no Book action", async (url) => {
    feed.offerings = [{ ...trip, public_url: url }];
    const resolved = await resolve("trips/island-week");
    if (resolved?.kind === "detail") expect(detailAction(artifactFor(), resolved.detail)).toBeNull();
  });
});

/*
 * #4453 M9 retest (tester, after rework c97f3a5ff1): the Book action is scoped
 * to THIS brand. Every case runs on an artifact that names its brand, so it
 * fails if detailAction stops passing artifactActionScope(artifact).
 */
describe("#4453 M9 retest: Book only to this brand's own Mingla route", () => {
  function scoped(slug = "fixture-brand"): ArtifactV2 {
    const artifact = artifactFor();
    artifact.action_scope = { brand_slug: slug };
    return artifact;
  }
  async function actionFor(url: string, artifact = scoped()) {
    feed.offerings = [{ ...trip, public_url: url }];
    const view = await detailView("trips/island-week", artifact);
    return detailAction(artifact, view);
  }

  it("this brand's own trip and room routes still get Book", async () => {
    expect(await actionFor(trip.public_url)).toEqual({ href: trip.public_url, label: "Book this trip" });
    // The same brand spelled in capitals is still this brand (slugs compare case-insensitively).
    expect((await actionFor("https://host.usemingla.com/t/FIXTURE-BRAND/island-week"))?.label).toBe("Book this trip");
  });

  it.each([
    ["another brand", "https://host.usemingla.com/t/rival-brand/island-week"],
    ["another brand in capitals", "https://host.usemingla.com/t/RIVAL-BRAND/island-week"],
    ["a longer slug that starts with this one", "https://host.usemingla.com/t/fixture-brand-evil/island-week"],
    ["a shorter slug this one starts with", "https://host.usemingla.com/t/fixture/island-week"],
    ["an encoded slash in the brand", "https://host.usemingla.com/t/fixture-brand%2Frival-brand/island-week"],
    ["an encoded slash before this brand", "https://host.usemingla.com/t/rival-brand%2F..%2Ffixture-brand/island-week"],
    ["a dot segment out of this brand", "https://host.usemingla.com/t/fixture-brand/../../t/rival-brand/island-week"],
    ["an encoded dot segment", "https://host.usemingla.com/t/fixture-brand/%2e%2e/%2e%2e/e/rival-brand/x"],
    ["another brand's room", `https://host.usemingla.com/b/rival-brand/v/lagoon?tab=stay&room=${ROOM_ID}`],
    ["another brand's page", "https://host.usemingla.com/b/rival-brand"],
    ["the marketing host", "https://usemingla.com/t/fixture-brand/island-week"],
    ["the admin host", "https://admin.usemingla.com/t/fixture-brand/island-week"],
    ["a business host", "https://business.usemingla.com/t/fixture-brand/island-week"],
    ["a trailing-dot host", "https://host.usemingla.com./t/fixture-brand/island-week"],
    ["a non-default port", "https://host.usemingla.com:8443/t/fixture-brand/island-week"],
    ["userinfo hiding another host", "https://host.usemingla.com@evil.example/t/fixture-brand/island-week"],
    ["plain http", "http://host.usemingla.com/t/fixture-brand/island-week"],
    ["a checkout for an event this site does not sell", "https://host.usemingla.com/checkout/cccccccc-cccc-4ccc-8ccc-000000000001"],
  ])("%s gets no Book action", async (_label, url) => {
    expect(await actionFor(url)).toBeNull();
  });

  it("the rendered page carries no link to another brand's route", async () => {
    const artifact = scoped();
    feed.offerings = [{ ...trip, public_url: "https://host.usemingla.com/t/rival-brand/island-week" }];
    const html = renderToStaticMarkup(
      <SiteDocument artifact={artifact} detail={await detailView("trips/island-week", artifact)} page={await framePage("trips/island-week", artifact)} />,
    );
    expect(html).not.toContain("rival-brand");
    expect(html).not.toContain("Book this trip");
  });

  it("a site for the rival brand refuses this brand's route the same way", async () => {
    expect(await actionFor(trip.public_url, scoped("rival-brand"))).toBeNull();
  });
});

describe("#4453 M9 retest: an Event's JSON-LD location is real data or nothing", () => {
  function withAddress(address: string | undefined): ArtifactV2 {
    const artifact = artifactFor();
    artifact.footer = { ...artifact.footer, address };
    return artifact;
  }

  it("a blank destination falls back to the site address; blank both leaves location out", async () => {
    feed.offerings = [{ ...event, destination_text: "   " }];
    const view = await detailView("events/harbourside");
    const site = withAddress("  12 Marina Road, Lagos  ");
    expect(detailItem(site, view, "https://example.test")?.location).toEqual({ "@type": "Place", name: site.brand.display_name, address: "12 Marina Road, Lagos" });
    const item = detailItem(withAddress("   "), view, "https://example.test");
    expect(item?.["@type"]).toBe("Event");
    expect(item).not.toHaveProperty("location");
  });

  it("no detail or listing JSON-LD ever emits VirtualLocation or a location the data does not hold", async () => {
    feed.offerings = [{ ...event, destination_text: null }, { ...undatedSession, start_at: event.start_at, destination_text: null }];
    for (const address of [undefined, "12 Marina Road, Lagos"]) {
      const artifact = withAddress(address);
      for (const path of ["events/harbourside", "experiences/pottery"]) {
        const view = await detailView(path, artifact);
        const json = JSON.stringify(pageStructuredData({ artifact, page: await framePage(path, artifact), origin: "https://example.test", detail: view }));
        expect(json).not.toContain("VirtualLocation");
        expect(json).not.toContain("Lofoten");
        if (!address) expect(json).not.toMatch(/"location"/);
      }
    }
  });
});
