/*
 * #2829 W10 — what pages tell search engines and link previews (lib/seo.ts)
 * and the schema.org data they carry (lib/structuredData.ts), built only from
 * the artifact and Mingla's feed:
 *  - titles: "{page title} – {site name}", home "{site name} – {tagline}",
 *    an owner-typed SEO title exactly as typed;
 *  - description fallback order; canonical, Open Graph and Twitter on the
 *    current main address with the page's own picture as an absolute URL;
 *  - JSON-LD: Organization + WebSite everywhere; BreadcrumbList on nested and
 *    destination/story pages; FAQPage where questions are; Article on
 *    stories; Event for upcoming trips/events on live grids with offers on
 *    the EXISTING Mingla page (A1.2), SoldOut/Cancelled honest, no guessed
 *    price; nothing that could close the script element survives.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { w5Artifact, W5 } from "../contracts/w5Content.fixture";
import type { SiteOffering } from "../contracts/generated/offerings.ts";
import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { resolveSitePath, type ArtifactPage } from "./pageRouting";
import { buildPageMetadata, pageDescription, pageTitle, shortDescription } from "./seo";
import { majorAmount, pageStructuredData, serializeJsonLd } from "./structuredData";
import type { LiveOfferings, OfferingCard } from "./offeringCards";
import type { CollectionEntry } from "./siteCollections";

const ORIGIN = "https://young.sites.usemingla.com";
type Graph = { "@context": string; "@graph": Array<Record<string, unknown>> };

function artifact(): ArtifactV2 {
  const value = w5Artifact({ storiesAtRoot: true });
  value.brand = { ...value.brand, display_name: "Young & Stamped", short_description: "Empowering young adults to see the world" };
  value.seo = { canonical_url: ORIGIN };
  value.pages.push(
    { path: "faqs", title: "FAQs", enabled: true, kind: "standard", blocks: [{ type: "faq", variant: "neutral", items: [{ question: "Is it safe?", answer: "Yes </script><b>really</b>" }, { question: "Visa?", answer: "Depends." }] }] as never },
    { path: "about-us", title: "About us", enabled: true, kind: "standard", blocks: [], seo: { description: "Who we are." } },
    { path: "about-us/team", title: "Team", enabled: true, kind: "standard", blocks: [] },
    { path: "trips", title: "Upcoming Trips", enabled: true, kind: "collection_index", collection: "trips", blocks: [{ type: "offering_grid", variant: "neutral", kind: "all", mode: "upcoming" }] as never },
  );
  return value;
}

function at(value: ArtifactV2, path: string): { page: ArtifactPage; entry?: CollectionEntry } {
  const resolved = resolveSitePath(value, path);
  if (resolved.kind === "page") return { page: resolved.page };
  if (resolved.kind === "entry") return { page: resolved.page, entry: resolved.entry };
  throw new Error(`no page at ${path}`);
}

function offering(over: Partial<SiteOffering>): SiteOffering {
  return {
    id: W5.tripEnded1, kind: "trip", slug: "bali", title: "Bali Escape", summary: "Ten days of temples.", cover: null,
    destination_text: "Bali, Indonesia", start_at: "2099-06-20T10:00:00.000Z", end_at: "2099-06-30T10:00:00.000Z",
    timezone: "Asia/Makassar", status: "scheduled", bookings_closed: false, capacity: 12, spots_left: 4, group_minimum: null,
    min_price_minor: 249900, currency: "USD", has_free_tier: false, public_url: "https://host.usemingla.com/t/young/bali",
    waitlist_enabled: false, installments_available: true, ...over,
  };
}

function live(offerings: SiteOffering[]): LiveOfferings {
  const cards = new Map<string, OfferingCard>(offerings.map((row) => [row.id, { coverUrl: `/om/${"t".repeat(43)}/c768` } as OfferingCard]));
  return { source: "live", offerings, cards, now: new Date("2026-10-27T12:00:00Z"), filters: { where: null, from: null, to: null } };
}

const graphOf = (value: ArtifactV2, path: string, feed?: LiveOfferings) => {
  const { page, entry } = at(value, path);
  return pageStructuredData({ artifact: value, page, entry, live: feed, origin: ORIGIN }) as Graph;
};
const ofType = (graph: Graph, type: string) => graph["@graph"].filter((node) => node["@type"] === type);

describe("#2829 W10 titles and descriptions", () => {
  const value = artifact();
  it("home is '{site name} – {tagline}'; a page is '{page title} – {site name}'", () => {
    expect(pageTitle(value, at(value, "").page)).toBe("Young & Stamped – Empowering young adults to see the world");
    expect(pageTitle(value, at(value, "about-us").page)).toBe("About us – Young & Stamped");
    expect(pageTitle(value, at(value, "first-light").page)).toBe("First light – Young & Stamped");
  });
  it("an SEO title the owner typed is used exactly as typed; no tagline means just the name", () => {
    const typed = artifact();
    typed.pages.find((page) => page.path === "about-us")!.seo = { title: "Meet the crew" };
    expect(pageTitle(typed, at(typed, "about-us").page)).toBe("Meet the crew");
    typed.brand = { display_name: "Young & Stamped" };
    expect(pageTitle(typed, at(typed, "").page)).toBe("Young & Stamped");
  });
  it("description: page SEO → entry summary/excerpt → site description", () => {
    expect(pageDescription(value, at(value, "about-us").page)).toBe("Who we are.");
    const story = at(value, "first-light");
    expect(pageDescription(value, story.page, story.entry)).toBe("An early start.");
    const place = at(value, "places/harbour-coast");
    expect(pageDescription(value, place.page, place.entry)).toBe("A short summary of the coast.");
    expect(pageDescription(value, at(value, "faqs").page)).toBe("Empowering young adults to see the world");
    expect(shortDescription("word ".repeat(100))!.length).toBeLessThanOrEqual(301);
  });
  it("canonical, Open Graph and Twitter on the main address with the page's own picture", () => {
    const place = at(value, "places/harbour-coast");
    const meta = buildPageMetadata({ artifact: value, page: place.page, entry: place.entry, origin: ORIGIN, noindex: false });
    expect(meta.alternates?.canonical).toBe(`${ORIGIN}/places/harbour-coast`);
    const og = meta.openGraph as { url: string; images: Array<{ url: string }>; type: string; title: string };
    expect(og.url).toBe(`${ORIGIN}/places/harbour-coast`);
    expect(og.images[0]!.url.startsWith(`${ORIGIN}/media/`)).toBe(true);
    expect(og.title).toBe("Harbour Coast – Young & Stamped");
    expect((meta.twitter as { card: string }).card).toBe("summary_large_image");
    expect(meta.robots).toEqual({ index: true, follow: true });
    const home = buildPageMetadata({ artifact: value, page: at(value, "").page, origin: ORIGIN, noindex: true });
    expect(home.alternates?.canonical).toBe(`${ORIGIN}/`);
    expect(home.robots).toEqual({ index: false, follow: true });
    const story = at(value, "first-light");
    expect((buildPageMetadata({ artifact: value, page: story.page, entry: story.entry, origin: ORIGIN, noindex: false }).openGraph as { type: string }).type).toBe("article");
  });
});

describe("#2829 W10 structured data", () => {
  const value = artifact();
  it("Organization and WebSite on every page; no breadcrumb on a top-level page", () => {
    for (const path of ["", "about-us", "faqs", "trips"]) {
      const graph = graphOf(value, path);
      expect(graph["@context"]).toBe("https://schema.org");
      const org = ofType(graph, "Organization")[0]!;
      expect(org.name).toBe("Young & Stamped");
      expect(org.url).toBe(`${ORIGIN}/`);
      expect(ofType(graph, "WebSite")[0]!.url).toBe(`${ORIGIN}/`);
    }
    expect(ofType(graphOf(value, "about-us"), "BreadcrumbList")).toHaveLength(0);
  });
  it("BreadcrumbList on nested pages and entries (root stories under their collection page)", () => {
    const nested = ofType(graphOf(value, "about-us/team"), "BreadcrumbList")[0]!;
    expect((nested.itemListElement as Array<{ name: string; item: string; position: number }>).map((row) => [row.position, row.name, row.item])).toEqual([
      [1, "Home", `${ORIGIN}/`], [2, "About us", `${ORIGIN}/about-us`], [3, "Team", `${ORIGIN}/about-us/team`],
    ]);
    const story = ofType(graphOf(value, "first-light"), "BreadcrumbList")[0]!;
    expect((story.itemListElement as Array<{ name: string }>).map((row) => row.name)).toEqual(["Home", "Journal", "First light"]);
    const place = ofType(graphOf(value, "places/harbour-coast"), "BreadcrumbList")[0]!;
    expect((place.itemListElement as Array<{ name: string }>).map((row) => row.name)).toEqual(["Home", "Places", "Harbour Coast"]);
  });
  it("FAQPage carries every question with its answer as plain text", () => {
    const faq = ofType(graphOf(value, "faqs"), "FAQPage")[0]!;
    const items = faq.mainEntity as Array<{ "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }>;
    expect(items.map((row) => row.name)).toEqual(["Is it safe?", "Visa?"]);
    expect(items[0]!.acceptedAnswer).toEqual({ "@type": "Answer", text: "Yes </script><b>really</b>" });
    expect(ofType(graphOf(value, "about-us"), "FAQPage")).toHaveLength(0);
  });
  it("Article on a story: headline, date, image, author and publisher", () => {
    const article = ofType(graphOf(value, "first-light"), "Article")[0]!;
    expect(article.headline).toBe("First light");
    expect(article.datePublished).toBe("2026-03-02");
    expect(article.mainEntityOfPage).toBe(`${ORIGIN}/first-light`);
    expect((article.author as { name: string }).name).toBe("Young & Stamped");
    expect(ofType(graphOf(value, "places/harbour-coast"), "Article")).toHaveLength(0);
  });
  it("Event for each upcoming trip on a live grid, offers on the EXISTING Mingla page", () => {
    const feed = live([
      offering({}),
      offering({ id: W5.tripEnded2, slug: "albania", title: "Albania", spots_left: 0, min_price_minor: null, has_free_tier: false, currency: "EUR" }),
      offering({ id: W5.tripEnded3, slug: "old", title: "Old trip", status: "ended", start_at: "2024-01-01T00:00:00Z", end_at: "2024-01-05T00:00:00Z" }),
    ]);
    const events = ofType(graphOf(value, "trips", feed), "Event");
    expect(events.map((row) => row.name)).toEqual(["Bali Escape", "Albania"]);
    const bali = events[0]!;
    expect(bali.url).toBe("https://host.usemingla.com/t/young/bali");
    expect(bali.eventStatus).toBe("https://schema.org/EventScheduled");
    expect(bali.startDate).toBe("2099-06-20T10:00:00.000Z");
    expect(bali.location).toEqual({ "@type": "Place", name: "Bali, Indonesia", address: "Bali, Indonesia" });
    expect(bali.offers).toEqual({ "@type": "Offer", url: "https://host.usemingla.com/t/young/bali", availability: "https://schema.org/InStock", price: "2499.00", priceCurrency: "USD" });
    expect(bali.image).toEqual([`${ORIGIN}/om/${"t".repeat(43)}/c768`]);
    // Sold out says so; a missing price is left out, never guessed.
    expect(events[1]!.offers).toEqual({ "@type": "Offer", url: "https://host.usemingla.com/t/young/bali", availability: "https://schema.org/SoldOut" });
    expect(ofType(graphOf(value, "trips"), "Event")).toHaveLength(0);
  });
  it("a picked cancelled trip is EventCancelled; past grids and experiences carry no Event", () => {
    const cancelled = artifact();
    cancelled.pages.find((page) => page.path === "trips")!.blocks = [{ type: "offering_grid", variant: "neutral", mode: "upcoming", offering_ids: [{ id: W5.tripEnded1 }] }] as never;
    const events = ofType(graphOf(cancelled, "trips", live([offering({ status: "cancelled" })])), "Event");
    expect(events[0]!.eventStatus).toBe("https://schema.org/EventCancelled");
    const past = artifact();
    past.pages.find((page) => page.path === "trips")!.blocks = [{ type: "offering_grid", variant: "neutral", mode: "past" }] as never;
    expect(ofType(graphOf(past, "trips", live([offering({})])), "Event")).toHaveLength(0);
    expect(ofType(graphOf(value, "trips", live([offering({ kind: "experience" })])), "Event")).toHaveLength(0);
  });
  it("minor units follow the currency's precision", () => {
    expect(majorAmount(249900, "USD")).toBe("2499.00");
    expect(majorAmount(5000, "JPY")).toBe("5000");
    expect(majorAmount(1000, "nope")).toBeNull();
  });
  it("the serialized JSON can't close the script element or start markup, and parses back exactly", () => {
    const graph = graphOf(value, "faqs");
    const text = serializeJsonLd(graph);
    expect(text).not.toMatch(/<|>|&/);
    expect(text).toContain("\\u003c/script\\u003e");
    expect(JSON.parse(text)).toEqual(graph);
    expect(serializeJsonLd({ a: "\u2028\u2029" })).toBe('{"a":"\\u2028\\u2029"}');
  });
});

describe("#2829 W10 the page carries both", () => {
  it("the catch-all route builds its metadata from lib/seo.ts and prints the JSON-LD with the CSP nonce", () => {
    const page = fs.readFileSync(path.resolve(process.cwd(), "src/app/[[...path]]/page.tsx"), "utf8");
    expect(page).toContain("return buildPageMetadata({");
    expect(page).toContain('<script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: structured }} />');
    expect(page).toContain("serializeJsonLd(pageStructuredData(");
  });
});
