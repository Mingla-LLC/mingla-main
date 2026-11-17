/*
 * #4453 milestone 7b — tester's adversarial suite (L3). Attacks the angles the
 * implementor's composer and design-pass tests do not reach, by running the
 * REAL `buildPublicationArtifact` and handing its bytes to the REAL public
 * artifact contract:
 *   - "Keep exploring" never links the page itself, Home, a disabled page, a
 *     page whose blocks all dropped, or an external menu link; `next` wraps;
 *     fewer than 2 candidates drops the block (never an empty section).
 *   - a facts table publishes only rows with BOTH a label and a value, and is
 *     absent when none has; hero fact badges are trimmed, capped at 3, need
 *     both lines, and never publish on a hero layout that does not draw them.
 *   - the design-pass claim key is per tenant AND per draft and fits the
 *     ledger's 64-character nonce column.
 *   - every per-format detail base is a legal, non-reserved base, distinct
 *     within its format and never the rooms base.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, Uint8Array>();
vi.mock("./config", () => ({ cmsConfig: () => ({ artifactBucket: "artifact-bucket" }) }));
vi.mock("./observability", async (importOriginal) => ({ ...(await importOriginal<object>()), emitCmsObservation: async () => {} }));
vi.mock("./gateway", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readCoreProjection: async () => ({ offerings: [], menu: [], menu_venue_id: null }),
}));
vi.mock("./objectStore", () => ({
  writeObject: async (bucket: string, key: string, bytes: Uint8Array) => { stored.set(`${bucket}:${key}`, bytes); },
  readObject: async (bucket: string, key: string) => {
    const value = stored.get(`${bucket}:${key}`);
    if (!value) throw new Error("STORAGE_UNAVAILABLE");
    return value;
  },
}));

import { buildPublicationArtifact, publicationDraftDigest } from "./artifactBuilder";
import { designPassClaimKey } from "./designPass";
import { shapeSiteCollections } from "./siteContent";
import { FORMAT_DETAIL_BASES } from "../contracts/generated/formats.ts";
import { DEFAULT_STAYS_BASE, isBasePath, isReservedSegment } from "../contracts/generated/routes.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000004453";
const SITE_ID = "00000000-0000-4000-8000-000000004454";
const tenant = { id: TENANT_ID, core_site_id: SITE_ID, core_brand_id: "00000000-0000-4000-8000-000000004455", primary_hostname: "pageset.sites.usemingla.com" };
const baseSettings = { id: "settings-1", tenant: TENANT_ID, display_name: "Page set", canonical_url: "https://pageset.sites.usemingla.com", seo_title: "Page set", seo_description: "x" };

type Doc = Record<string, unknown>;
const MEDIA_ID = "00000000-0000-4000-8000-000000004457";
const mediaRecord = { id: MEDIA_ID, tenant: TENANT_ID, state: "READY", width: 1440, height: 1440,
  rendition_manifest: { renditions: [{ width: 1440, target_width: 1440, digest: "c".repeat(64), key: `approved/${SITE_ID}/${MEDIA_ID}/1440.webp` }] } };
const TEXT = (body: string) => ({ blockType: "rich_text", body: { root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: body }] }] } } });
const page = (id: string, slug: string, blocks: Doc[], extra: Doc = {}) => ({
  id, tenant: TENANT_ID, slug, title: id, enabled: true, blocks, seo: { title: id, description: `${id} description` }, ...extra,
});

async function build(pages: Doc[], navItems: Doc[], design = "nocturne") {
  const settings = { ...baseSettings, design };
  const collections: Record<string, unknown[]> = {
    pages,
    navigation: [{ id: "nav-1", tenant: TENANT_ID, items: navItems }],
    footer: [{ id: "footer-1", tenant: TENANT_ID }],
    "site-settings": [settings],
    media: [mediaRecord],
  };
  const sourceDigest = await publicationDraftDigest({ pages, navigation: collections.navigation![0] as Doc, footer: collections.footer![0] as Doc, settings, media: [mediaRecord] });
  const req = { context: {}, payload: { find: async ({ collection }: { collection: string }) => ({ docs: collections[collection] ?? [] }) } } as never;
  const { artifact } = await buildPublicationArtifact(req, {
    tenant, operationId: "op-4453-m7b-tester", publicationId: "00000000-0000-4000-8000-000000004456",
    sourceRevisionId: "rev-m7b", sourceDigest, generatedAt: "2026-11-16T00:00:00Z",
  });
  const { assertArtifactV2 } = await import("../contracts/generated/artifactV2.ts");
  expect(() => assertArtifactV2(artifact)).not.toThrow();
  return artifact as unknown as { pages: Array<{ path: string; enabled?: boolean; blocks: Doc[] }> };
}
const blocksAt = (artifact: { pages: Array<{ path: string; blocks: Doc[] }> }, path: string) =>
  artifact.pages.find((entry) => entry.path === path)?.blocks ?? [];

const HOME = page("home", "", [{ blockType: "hero", heading: "Home", ctas: [], media: MEDIA_ID }, { blockType: "page_links", mode: "teaser" }], { role: "home" });
const nav = (...ids: string[]) => [
  { id: "n-home", label: "Home", target_type: "page", page: "home" },
  ...ids.map((pid) => ({ id: `n-${pid}`, label: pid.toUpperCase(), target_type: "page", page: pid })),
  { id: "n-shop", label: "Shop", target_type: "url", url: "https://shop.example" },
];

beforeEach(() => stored.clear());

describe("#4453 m7b tester — Keep exploring only links live, other, non-Home pages", () => {
  it("never links itself, Home, a disabled page, an emptied page or an external link", async () => {
    const artifact = await build([
      HOME,
      page("about", "about", [TEXT("About us"), { blockType: "page_links", mode: "next" }]),
      page("visit", "visit", [TEXT("Visit us"), { blockType: "page_links", mode: "teaser" }]),
      page("faq", "faq", [TEXT("Questions")]),
      page("hidden", "hidden", [TEXT("Off")], { enabled: false }),
      // every block drops (a menu with no items), so the page publishes disabled
      page("empty", "empty", [{ blockType: "menu_board", menus: [] }]),
    ], nav("about", "hidden", "empty", "visit", "faq"));
    const about = blocksAt(artifact, "about").find((block) => block.type === "page_links") as { items: Array<{ href: string; label: string; description?: string }> };
    expect(about, "about keeps its Keep exploring").toBeTruthy();
    const hrefs = about.items.map((item) => item.href);
    expect(hrefs).toEqual(["/visit", "/faq"]);
    for (const bad of ["/about", "/", "/hidden", "/empty", "https://shop.example"]) expect(hrefs).not.toContain(bad);
    expect(about.items[0]!.description).toBe("visit description");
    const visit = blocksAt(artifact, "visit").find((block) => block.type === "page_links") as { items: Array<{ href: string }> };
    expect(visit.items.map((item) => item.href), "a teaser never links its own page").toEqual(["/about", "/faq"]);
    const home = blocksAt(artifact, "").find((block) => block.type === "page_links") as { items: Array<{ href: string }> };
    expect(home.items.map((item) => item.href)).toEqual(["/about", "/visit", "/faq"]);
  });

  it("`next` wraps around the menu and takes at most 3", async () => {
    const artifact = await build([
      HOME,
      page("a", "a", [TEXT("a")]), page("b", "b", [TEXT("b")]), page("c", "c", [TEXT("c")]),
      page("d", "d", [TEXT("d"), { blockType: "page_links", mode: "next" }]), page("e", "e", [TEXT("e")]),
    ], nav("a", "b", "c", "d", "e"));
    const block = blocksAt(artifact, "d").find((entry) => entry.type === "page_links") as { items: Array<{ href: string }> };
    expect(block.items.map((item) => item.href)).toEqual(["/e", "/a", "/b"]);
  });

  it("drops the block (never an empty section) when fewer than 2 other pages are live", async () => {
    const artifact = await build([
      HOME,
      page("about", "about", [TEXT("About"), { blockType: "page_links", mode: "next" }]),
      page("visit", "visit", [TEXT("Visit")]),
      page("hidden", "hidden", [TEXT("Off")], { enabled: false }),
    ], nav("about", "visit", "hidden"));
    expect(blocksAt(artifact, "about").some((block) => block.type === "page_links")).toBe(false);
    expect(blocksAt(artifact, "").some((block) => block.type === "page_links")).toBe(true);
  });
});

describe("#4453 m7b tester — facts and badges publish only the owner's real data", () => {
  it("a facts row needs both a label and a value; an all-empty table is absent", async () => {
    const artifact = await build([
      page("home", "", [
        { blockType: "hero", heading: "Home", ctas: [], media: MEDIA_ID },
        { blockType: "facts_table", heading: "Good to know", items: [
          { label: "Check-in", value: " 3pm " }, { label: "Parking", value: "   " }, { label: "", value: "orphan" }, { label: "Pets", value: null },
        ] },
        { blockType: "facts_table", items: [{ label: "Wifi", value: "" }] },
      ], { role: "home" }),
    ], nav());
    const facts = blocksAt(artifact, "").filter((block) => block.type === "facts_table") as Array<{ items: Doc[] }>;
    expect(facts).toHaveLength(1);
    expect(facts[0]!.items).toEqual([{ label: "Check-in", value: "3pm" }]);
  });

  it("badges: trimmed, both lines required, at most 3, and absent on a hero that cannot draw them", async () => {
    const badges = [
      { big: " 12 ", small: "guests" }, { big: "4.9", small: "  " }, { big: "", small: "nights" },
      { big: "3", small: "guides" }, { big: "2", small: "pools" }, { big: "9", small: "rooms" },
    ];
    const drawn = await build([page("home", "", [{ blockType: "hero", variant: "fullbleed", heading: "H", ctas: [], media: MEDIA_ID, fact_badges: badges }], { role: "home" })], nav());
    expect((blocksAt(drawn, "")[0] as { fact_badges?: unknown }).fact_badges).toEqual([
      { big: "12", small: "guests" }, { big: "3", small: "guides" }, { big: "2", small: "pools" },
    ]);
    const blank = await build([page("home", "", [{ blockType: "hero", variant: "fullbleed", heading: "H", ctas: [], media: MEDIA_ID, fact_badges: [{ big: " ", small: "x" }] }], { role: "home" })], nav());
    expect("fact_badges" in (blocksAt(blank, "")[0] as Doc)).toBe(false);
    // Voyage's cover draws the booking bar but NOT badges: they never publish there
    const split = await build([page("home", "", [{ blockType: "hero", variant: "cover-bottom-search", heading: "H", ctas: [], media: MEDIA_ID, fact_badges: badges }], { role: "home" })], nav(), "voyage");
    expect((blocksAt(split, "")[0] as Doc).variant).toBe("cover-bottom-search");
    expect("fact_badges" in (blocksAt(split, "")[0] as Doc)).toBe(false);
  });
});

describe("#4453 m7b tester — design-pass claim and detail bases", () => {
  it("the claim key is per tenant and per draft, deterministic, and fits the 64-char nonce column", () => {
    const a = designPassClaimKey("tenant-a", null);
    expect(a).toBe(designPassClaimKey("tenant-a", null));
    expect(a).not.toBe(designPassClaimKey("tenant-b", null));
    expect(a).not.toBe(designPassClaimKey("tenant-a", "2026-11-16T00:00:00.000Z"));
    expect(designPassClaimKey("tenant-a", "2026-11-16T00:00:00.000Z")).not.toBe(designPassClaimKey("tenant-a", "2026-11-17T00:00:00.000Z"));
    // a Core replay nonce is a UUID; the claim can never take one's slot
    expect(a).not.toMatch(/^[0-9a-f-]{36}$/i);
    expect(a.length).toBeLessThanOrEqual(64);
  });

  it("every per-format detail base is legal, not reserved, distinct, and never the rooms base", () => {
    for (const [format, bases] of Object.entries(FORMAT_DETAIL_BASES)) {
      const values = Object.entries(bases);
      for (const [kind, base] of values) {
        expect(isBasePath(kind as never, base), `${format}.${kind}=${base}`).toBe(true);
        expect(isReservedSegment(base as string), `${format}.${kind}=${base} reserved`).toBe(false);
        expect(base, `${format}.${kind} vs rooms`).not.toBe(DEFAULT_STAYS_BASE);
      }
      expect(new Set(values.map(([, base]) => base)).size, `${format} bases distinct`).toBe(values.length);
    }
  });
});

/*
 * Tester finding P2-1 (m7b; latent: Studio's story editor has no upload feature today): a story's inline picture was never read before
 * m7b (richTextToAst drops upload nodes), so a story whose inline image was
 * still processing, failed its scan, or was deleted published fine. The new
 * fallback hands that picture to the builder's renderMedia, which THROWS
 * MEDIA_PROCESSING for anything not READY, and a publish is all-or-nothing:
 * one stale inline image now blocks the whole site. The renderer below is the
 * builder's own rule (artifactBuilder.ts renderMedia). Marked `it.fails` until
 * the fallback skips a picture it cannot render; then flip it to `it`.
 */
describe("#4453 m7b tester — a story's inline picture never blocks the site", () => {
  const READY = new Set(["m-ready"]);
  const builderRender = (mediaId: unknown, alt: string) => {
    const key = String(mediaId && typeof mediaId === "object" ? (mediaId as { id: string }).id : mediaId);
    if (!READY.has(key)) throw new Error("MEDIA_PROCESSING");
    return { id: key, url: `/media/${key}/1440.webp`, alt, width: 1440, height: 960 };
  };
  const story = (value: string) => ({
    id: "s1", slug: "one", title: "One", published_at: "2026-09-01T00:00:00.000Z", enabled: true,
    content: { root: { type: "root", children: [{ type: "paragraph", children: [{ type: "text", text: "Hi" }] }, { type: "upload", relationTo: "media", value: { id: value } }] } },
  });
  it("uses a READY inline picture", () => {
    const shaped = shapeSiteCollections({ destinations: [], stories: [story("m-ready")], categories: [], testimonials: [] } as never, builderRender as never);
    expect(shaped.stories[0]!.featured_image?.id).toBe("m-ready");
  });
  it.fails("P2-1: an inline picture that is not READY (processing, rejected or deleted) leaves the card photo-less instead of failing the publish", () => {
    const shaped = shapeSiteCollections({ destinations: [], stories: [story("m-processing")], categories: [], testimonials: [] } as never, builderRender as never);
    expect(shaped.stories[0]!.featured_image).toBeUndefined();
  });
});
