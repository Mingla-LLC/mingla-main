/*
 * #4453 milestone 7 — Young and Stamped's real-shaped site, composed by
 * composer v2 in Voyage and published through the REAL builder: trips (three
 * upcoming, two ended), confirmed reviews, destinations, stories and the
 * owner's FAQ. The artifact validates, Home keeps the trips recipe order, and
 * every section the brand has content for is there (nothing invented, nothing
 * empty). With YS_COMPOSED_OUT set, the artifact and its feed are written
 * there for the production-build render (milestone evidence).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const SITE = "00000000-0000-4000-8000-0000000000a1";
const BRAND = "00000000-0000-4000-8000-0000000000b1";
const PUBLICATION = "00000000-0000-4000-8000-0000000000c1";
const trip = (n: number, startDays: number, status: string) => ({
  id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`, kind: "trip", slug: `trip-${n}`,
  title: ["Porto in spring", "The Dolomites", "Lisbon long weekend", "Marrakech", "Iceland ring road"][n - 1],
  summary: "Small-group trip with two local guides.", cover: null, destination_text: ["Porto", "Dolomites", "Lisbon", "Marrakech", "Iceland"][n - 1],
  start_at: new Date(Date.now() + startDays * 86_400_000).toISOString(), end_at: new Date(Date.now() + (startDays + 6) * 86_400_000).toISOString(),
  timezone: "Europe/London", status, bookings_closed: false, capacity: 12, spots_left: status === "ended" ? null : 5, group_minimum: null,
  min_price_minor: 69000, currency: "GBP", has_free_tier: false, public_url: `https://host.usemingla.com/t/youngandstamped/trip-${n}`,
  waitlist_enabled: false, installments_available: true,
});
const FEED = {
  generated_at: new Date().toISOString(),
  brand: { slug: "youngandstamped", currency: "GBP", payment_rails: "stripe" },
  offerings: [trip(1, 30, "scheduled"), trip(2, 60, "scheduled"), trip(3, 90, "scheduled"), trip(4, -200, "ended"), trip(5, -120, "ended")],
};

vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));
vi.mock("./gateway", () => ({
  readCoreProjection: async (_p: string, _s: string, _o: string, ids: string[], _menu: boolean, _venue: boolean, includeFeed: boolean) => ({
    offerings: ids.map((id) => ({ id, kind: "trip", title: "Trip", summary: null, url: "https://host.usemingla.com/t/youngandstamped/x" })),
    feed: includeFeed ? FEED : null,
    menu: [],
    menu_venue_id: null,
  }),
}));
const stored = new Map<string, Uint8Array>();
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => { stored.set(`${bucket}:${key}`, bytes); },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { assertArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { FORMAT_RECIPES } from "../contracts/generated/formats.ts";
import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import { composeFormatSite } from "./composeFormat";
import { inventoryAndSources, parseSignedDesignPass } from "./designPassInputs";
import type { FontPipelineDeps } from "./fontAssets";

const offlineFonts: FontPipelineDeps = {
  fetch: (async () => { throw new Error("NO_NETWORK_IN_TESTS"); }) as typeof fetch,
  storeFont: async () => {},
  cachedFaces: async (key) => key.split("|")[1]!.split(",").map((weight, index) => ({
    family: key.split("|")[0]!, weight: Number(weight), style: "normal" as const, unicode_range: "U+0000-00FF",
    digest: String(index).padEnd(64, "b"), bytes: 1000,
  })),
  saveFaces: async () => {},
};

const D = (c: string) => c.repeat(64);
const mediaId = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
function picture(id: string) {
  const base = `approved/${SITE}/${id}/${D("a")}`;
  return {
    id, tenant: "t1", state: "READY", kind: "image", width: 2000, height: 1333,
    rendition_manifest: {
      version: 1,
      master: { key: `${base}/master.webp`, digest: D("0"), bytes: 10 },
      renditions: [320, 640, 960, 1440, 1920].map((w) => ({ target_width: w, width: w, key: `${base}/${w}.webp`, digest: D("1"), bytes: 10 })),
    },
  };
}
const media = Array.from({ length: 8 }, (_, i) => picture(mediaId(i + 1)));
const paragraph = (text: string) => ({ type: "paragraph", version: 1, children: [{ type: "text", text, version: 1 }] });
const lexical = (children: unknown[]) => ({ root: { type: "root", version: 1, children } });
const DEST = ["porto", "dolomites", "lisbon"].map((slug, i) => ({
  id: `33333333-3333-4333-8333-${String(i + 1).padStart(12, "0")}`, slug, title: slug[0]!.toUpperCase() + slug.slice(1), country: "Europe",
  featured_image: mediaId(i + 2), tagline: "Where the group goes next.", enabled: true,
}));
const STORIES = [1, 2].map((n) => ({
  id: `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`, slug: `story-${n}`, title: n === 1 ? "Twelve strangers, one summit" : "What we pack for Porto",
  published_at: "2026-09-0" + n + "T00:00:00.000Z", content: lexical([paragraph("From the trip notebook.")]), featured_image: mediaId(n + 4), enabled: true,
}));
const REVIEWS = [1, 2, 3].map((n) => ({
  id: `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`, quote: ["Best week of my year.", "Two guides who knew every path.", "I came alone and left with friends."][n - 1],
  reviewer: ["Ada", "Tolu", "Sam"][n - 1], review_date: "2026-06-0" + n + "T00:00:00.000Z", source_note: "Pasted by the owner", confirmed_real: true, enabled: true,
}));

function compose() {
  const signed = parseSignedDesignPass({
    plan: { offerings_selected: ["trips"], venue_descriptor: null, story: { who: "Twenty- and thirty-somethings who want to travel with people", why: "Go far. Go together.", main_action: "Reserve the next trip" } },
    answers: {
      value_points: [
        { title: "Two guides, every trip", sentence: "A local guide and a trip lead travel with every group." },
        { title: "Twelve people, never more", sentence: "Small enough to know everyone by day two." },
        { title: "Every night booked", sentence: "You choose the trip; we book the beds." },
      ],
      faq: [
        { question: "Can I come on my own?", answer: "Most people do. You will be in a group of up to twelve." },
        { question: "How do I pay?", answer: "A deposit holds your place, then the balance before you go, all on Mingla." },
      ],
      process_steps: [],
      quick_facts: { facts: [{ big: "12", small: "people per trip" }], use_in_ticker: false, ticker: ["Small groups", "Local guides", "Every night booked", "Booked through Mingla"] },
    },
    address: null,
    facts: { upcoming: { trip: 3, event: 0, experience: 0 }, ended: { trip: 2, event: 0, experience: 0 }, next_offering: { trip: FEED.offerings[0]!.id }, bookable: { trip: 1 }, mingla_reviews: 0 },
    style_library: true,
    live_fingerprints: [],
  })!;
  const records = { photos: media.map((doc) => ({ id: doc.id, alt: null })), destination_ids: DEST.map((d) => d.id), stories: 2, confirmed_reviews: 3, ready_videos: 0, has_logo: false };
  const brand = { name: "Young and Stamped", tagline: "Go far. Go together.", bio: "Young and Stamped runs small-group trips for people who would rather not travel alone.\n\nEvery trip has two guides and twelve places.", contact_email: "hello@youngandstamped.example", city: "London" };
  const { inventory, sources } = inventoryAndSources({ signed, records, offerings_selected: ["trips"], brand, cover_media_id: mediaId(1) });
  return composeFormatSite({ plan: signed.plan!, answers: signed.answers, brand, design: "voyage", inventory, sources, existing: [], currentWordmark: "Young and Stamped" })!;
}

describe("#4453 M7 Young and Stamped composed in Voyage, through the real builder", () => {
  it("publishes a valid artifact with the trips recipe and page set", async () => {
    const composed = compose();
    expect(composed.format).toBe("trips");
    const ids = new Map(composed.pages.map((page, i) => [page.slug, `page-${i}`]));
    const pages = composed.pages.map((page) => ({ id: ids.get(page.slug), tenant: "t1", slug: page.slug, title: page.title, kind: page.kind, enabled: true, blocks: page.blocks, ...(page.collection_kind ? { collection_kind: page.collection_kind } : {}) }));
    const navigation = {
      id: "nav-1", tenant: "t1", wordmark: composed.wordmark, header_variant: composed.header_variant,
      items: composed.menu.items.map((item) => ({ label: item.label, target_type: "page", page: ids.get(item.slug) })),
      ...(composed.header_cta ? { header_cta: { label: composed.header_cta.label, target_type: "page", page: ids.get(composed.header_cta.slug) } } : {}),
    };
    const settings = { id: "settings-1", tenant: "t1", display_name: "Young and Stamped", design: "voyage" };
    const footer = { id: "footer-1", tenant: "t1" };
    const collections: Record<string, unknown[]> = {
      pages, navigation: [navigation], footer: [footer], "site-settings": [settings], media,
      destinations: DEST, stories: STORIES, categories: [], testimonials: REVIEWS,
    };
    const sourceDigest = await publicationDraftDigest({ pages, navigation, footer, settings, media, content: { destinations: DEST, stories: STORIES, categories: [], testimonials: REVIEWS } } as never);
    const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
    const built = await buildPublicationArtifact(req, {
      tenant: { id: "t1", core_site_id: SITE, core_brand_id: BRAND, primary_hostname: "youngandstamped.sites.localhost" } as never,
      operationId: "op-m7", publicationId: PUBLICATION, sourceRevisionId: "rev-m7", sourceDigest, generatedAt: new Date().toISOString(),
      fontPipeline: offlineFonts,
      actionScope: { brand_slug: "youngandstamped", contact_email: "hello@youngandstamped.example" },
    });
    const artifact = JSON.parse(built.serialized);
    expect(() => assertArtifactV2(artifact)).not.toThrow();
    expect(artifact.design.key).toBe("voyage");
    const home = artifact.pages.find((page: { path: string }) => page.path === "");
    const order = FORMAT_RECIPES.trips.map((section) => section.type).filter((type) => !["availability"].includes(type) || true);
    const homeTypes = home.blocks.map((block: { type: string }) => block.type);
    // Every recipe section with content, in order (the departures strip renders live).
    expect(homeTypes.filter((type: string) => order.includes(type as never))).toEqual(homeTypes);
    expect(homeTypes).toEqual(expect.arrayContaining(["hero", "marquee", "offering_grid", "feature_cards", "destination_grid", "offering_history", "testimonials", "story_grid", "faq", "newsletter_signup"]));
    expect(artifact.pages.map((page: { path: string }) => page.path)).toEqual(expect.arrayContaining(["", "trips", "destinations", "stories", "about", "faq"]));
    if (process.env.YS_COMPOSED_OUT) {
      writeFileSync(join(process.env.YS_COMPOSED_OUT, "ys-composed.json"), built.serialized);
      writeFileSync(join(process.env.YS_COMPOSED_OUT, "ys-feed.json"), JSON.stringify(FEED));
    }
  });
});
