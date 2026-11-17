/*
 * #4453 PR 4 (design platform + Voyage) — the implementor's regression suite.
 *
 * MINGLA-INVARIANT: I-SITES-DESIGN-KEYS-ONE-LIST | issue #4453 | DESIGN_KEYS == renderers == stylesheets == Studio design enum == Core brand_site_design_keys() (SC-D1 parity test below + the pg17 test).
 * MINGLA-INVARIANT: I-SITES-DEFAULTS-AA | issue #4453 | every gallery-generation design's default text pairs pass WCAG AA (4.5:1 small, 3:1 large), measured on the token values (contrast test below).
 *
 * - SC-D1 parity: design keys, renderers, stylesheets, Studio enum, Core fixture and migration agree.
 * - Library parity: the runtime library is exactly site-contracts SHARED_LAYOUTS; every voyage
 *   variant has a renderer and a Studio enum value.
 * - Field parity (§3.3): every shared layout draws every content field its block defines.
 * - Chrome (v2.1 §1.4): header capacity and "More", one aria-current, phone menu, footer Pages column.
 * - SC-D7: a stored voyage site (no shared header) keeps voyage's own chrome and its photo-card
 *   structure (snapshot); a new composition gets the shared chrome.
 * - SC-D3 contrast, SC-D5 fonts and origins, SC-D6 JS budget.
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { renderToStaticMarkup } from "react-dom/server";
import { availabilityKey, availabilityRequestFor } from "../../contracts/generated/availability.ts";
import { describe, expect, it, vi } from "vitest";
import { BLOCK_CATALOG, type BlockType, type FieldSpec } from "../../contracts/generated/blocks.ts";
import { assertArtifactV2, type ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import {
  DESIGN_KEYS, DESIGNS, HEADER_INLINE_CAPACITY, MOTION_BUDGET, MOTION_PROFILE_NUMBERS, SHARED_LAYOUTS, VOYAGE,
  compositionVariant,
} from "../../contracts/generated/designs.ts";
import { assertRichText } from "../../contracts/generated/richText.ts";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { W5, w5EndedTrips } from "../../contracts/w5Content.fixture";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { homePage, resolveSitePath, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import { preloadDigests } from "../../components/v2/FontFaces";
import { DESIGN_RENDERERS, SHARED_STYLESHEET } from "../registry";
import { VOYAGE_BLOCK_VARIANTS } from "../voyage/voyageBlocks";
import { VoyagePage } from "../voyage/VoyagePage";
import { SHARED_BLOCK_LAYOUTS } from "./library";
import { activeIndex, SharedFooter, SharedHeader } from "./chrome/SharedChrome";
import type { SharedContext } from "./parts";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));

const ROOT = path.resolve(process.cwd(), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;

async function liveFor(artifact: ArtifactV2): Promise<LiveOfferings> {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
}

/* ---------------- SC-D1 parity ---------------- */

describe("#4453 SC-D1 design keys are one list", () => {
  it("DESIGN_KEYS == renderers == stylesheets on disk", () => {
    expect(Object.keys(DESIGN_RENDERERS).sort()).toEqual([...DESIGN_KEYS].sort());
    for (const key of DESIGN_KEYS) {
      expect(fs.existsSync(path.join(process.cwd(), "public", DESIGN_RENDERERS[key].stylesheet(DESIGNS[key].version)))).toBe(true);
    }
    expect(fs.existsSync(path.join(process.cwd(), "public", SHARED_STYLESHEET))).toBe(true);
  });

  it("DESIGN_KEYS == Studio's design enum (every CREATE/ADD VALUE across its migrations)", () => {
    const dir = path.join(ROOT, "mingla-site-cms/src/migrations");
    const sql = fs.readdirSync(dir).filter((file) => file.endsWith(".ts")).map((file) => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");
    const values = new Set<string>();
    for (const match of sql.matchAll(/"enum_site_settings_design" AS ENUM\(([^)]*)\)/g)) for (const v of match[1]!.matchAll(/'([^']+)'/g)) values.add(v[1]!);
    for (const match of sql.matchAll(/"enum_site_settings_design" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'/g)) values.add(match[1]!);
    expect([...values].sort()).toEqual([...DESIGN_KEYS].sort());
  });

  it("DESIGN_KEYS == the pg17 fixture == Core's brand_site_design_keys() in the newest migration that defines it", () => {
    const fixture = read("supabase/migrations/__tests__/issue_4453_design_keys.fixture.sql");
    expect(fixture).toContain(`ARRAY[${DESIGN_KEYS.map((key) => `'${key}'`).join(",")}]::text[]`);
    const dir = path.join(ROOT, "supabase/migrations");
    const latest = fs.readdirSync(dir).filter((file) => file.endsWith(".sql")).sort().reverse()
      .map((file) => fs.readFileSync(path.join(dir, file), "utf8"))
      .find((sql) => sql.includes("FUNCTION public.brand_site_design_keys()"))!;
    const body = /brand_site_design_keys\(\)[\s\S]*?SELECT ARRAY\[([^\]]*)\]::text\[\]/.exec(latest)!;
    expect([...body[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...DESIGN_KEYS]);
  });
});

/* ---------------- library parity ---------------- */

describe("#4453 §3.3 the shared block library", () => {
  it("draws exactly site-contracts SHARED_LAYOUTS", () => {
    const runtime = Object.fromEntries(Object.entries(SHARED_BLOCK_LAYOUTS).map(([type, layouts]) => [type, Object.keys(layouts!)]));
    expect(runtime).toEqual(SHARED_LAYOUTS);
  });

  it("voyage keeps every stored layout first and draws every variant it offers", () => {
    for (const [type, variants] of Object.entries(VOYAGE.variants)) {
      expect(Object.keys(VOYAGE_BLOCK_VARIANTS[type as BlockType] ?? {}), type).toEqual([...variants]);
    }
    // Stored first entries (SC-D7): the layouts voyage drew before #4453.
    expect(VOYAGE.variants.hero[0]).toBe("cover-bottom-search");
    expect(VOYAGE.variants.offering_grid[0]).toBe("photo-card");
    expect(VOYAGE.variants.testimonials[0]).toBe("quote-wall");
    // New compositions take the gallery picks.
    expect(compositionVariant(VOYAGE, "hero")).toBe("fullbleed");
    expect(compositionVariant(VOYAGE, "offering_grid")).toBe("poster");
  });

  it("every variant voyage offers is a value of Studio's enum on the live AND version tables", () => {
    const dir = path.join(ROOT, "mingla-site-cms/src/migrations");
    const sql = fs.readdirSync(dir).filter((file) => file.endsWith(".ts")).map((file) => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");
    for (const [type, variants] of Object.entries(VOYAGE.variants)) {
      for (const table of [`enum_pages_blocks_${type}_variant`, `enum__pages_v_blocks_${type}_variant`]) {
        const values = new Set<string>();
        for (const m of sql.matchAll(new RegExp(`"${table}" AS ENUM\\(([^)]*)\\)`, "g"))) for (const v of m[1]!.matchAll(/'([^']+)'/g)) values.add(v[1]!);
        for (const m of sql.matchAll(new RegExp(`"${table}" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'`, "g"))) values.add(m[1]!);
        for (const variant of variants) expect(values.has(variant), `${table} ${variant}`).toBe(true);
      }
    }
  });
});

/* ---------------- field parity ---------------- */

/** A block of `type` with a unique, findable value in every content field (lists get two rows). */
/* #4453 milestone 5 — a live booking answer for a sentinel availability or ticket-tiers block. */
function sentinelBooking(block: Record<string, unknown>): NonNullable<LiveOfferings["booking"]> {
  const ask = availabilityRequestFor({ ...block, type: "availability", source: "venue_slots" });
  const eventId = String(block.offering_id ?? "").toLowerCase();
  const href = "https://host.usemingla.com/b/sentinel/v/kitchen?tab=book&date=2026-11-20&time=18:00&party=2";
  return {
    availability: new Map(ask ? [[availabilityKey(ask), { generated_at: "2026-11-16T12:00:00Z", timezone: "Africa/Lagos", source: "venue_slots" as const, title: "Kitchen",
      days: [{ local_date: "2026-11-20", slots: [{ label: "18:00", start_local: "2026-11-20T18:00", state: "open" as const, left: 6, price_minor: null, currency: null, href }] }] }]] : []),
    ticketTiers: new Map([[eventId, { generated_at: "2026-11-16T12:00:00Z",
      event: { id: eventId, title: "Night", start_at: "2099-12-01T19:00:00Z", end_at: null, timezone: "Africa/Lagos", status: "scheduled" as const, public_url: "https://host.usemingla.com/e/sentinel/night" },
      tiers: [{ id: "00000000-0000-4000-8000-000000000999", name: "General", price_minor: 1200, currency: "USD", is_free: false, state: "on_sale" as const, sale_starts_at: null,
        href: `https://host.usemingla.com/checkout/${eventId}?seed=00000000-0000-4000-8000-000000000999:1` }] }]]),
    targets: new Map(),
    rating: null,
  };
}

function sentinelBlock(type: BlockType, artifact: ArtifactV2): { block: Record<string, unknown>; expected: string[] } {
  const expected: string[] = [];
  let n = 0;
  const media = artifact.media.filter((item) => !/\.(mp4|webm|mov)$/i.test(item.url));
  const value = (spec: FieldSpec, key: string): unknown => {
    n += 1;
    switch (spec.kind) {
      case "text": {
        const v = `Q${n}Z`;
        expected.push(v);
        return v;
      }
      // #4453 combined branch: a button link (the booking lock's action_href)
      // is drawn exactly like a link, so its label must be drawn too.
      case "href":
      case "action_href": {
        const v = `https://example.invalid/h${n}`;
        expected.push(v);
        return v;
      }
      case "media_url": {
        const v = media[n % media.length]!.url;
        expected.push(v);
        return v;
      }
      case "media_list":
        return media.slice(0, 5).map((item) => {
          expected.push(item.url);
          return { id: item.id, url: item.url, alt: item.alt, width: item.width, height: item.height };
        });
      case "rich_text": {
        const v = `R${n}Z`;
        expected.push(v);
        return { type: "doc", children: [{ type: "paragraph", children: [{ type: "text", text: v }] }] };
      }
      case "list":
        // #4453 milestone 5 — a list with a higher floor (how-it-works steps) gets its minimum.
        return Array.from({ length: Math.max(2, spec.min) }, () => 0).map(() => Object.fromEntries(Object.entries(spec.item).flatMap(([k, s]) => {
          const v = value(s, k);
          return v === undefined ? [] : [[k, v]];
        })));
      case "integer":
        return key === "price_minor" ? 1200 : Math.min(Math.max(spec.min, 6), spec.max);
      case "currency":
        return "USD";
      case "uuid":
        return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      case "boolean":
        return false;
      case "enum":
      case "icon":
      case "slug":
      case "video_url":
      case "email":
      case "timezone":
      case "city_timezone":
      case "mingla_href":
      case "number":
        return undefined; // behaviour, not drawn content.
      default: {
        // A new field kind must be classified here (drawn or not), never silently skipped:
        // an unclassified button-link kind is how a shared layout's labels went unchecked.
        const unclassified: never = spec;
        throw new Error(`sentinelBlock: unclassified field kind ${JSON.stringify(unclassified)}`);
      }
    }
  };
  const block: Record<string, unknown> = { type };
  for (const [key, spec] of Object.entries(BLOCK_CATALOG[type].fields) as Array<[string, FieldSpec]>) {
    const before = expected.length;
    const v = value(spec, key);
    if (v === undefined) continue;
    // Alternative forms a block holds one OR the other of; each form is drawn by its own case below.
    if ((type === "offering_grid" && key === "offerings") || (type === "testimonials" && ["testimonial_ids"].includes(key)) ||
      (type === "offering_history" && ["offering_ids", "linked_offering_ids"].includes(key)) ||
      (type === "menu_board" && key === "venue_id") || (type === "offering_grid" && key === "offering_ids")) {
      expected.splice(before);
      continue;
    }
    block[key] = v;
  }
  if (type === "offering_history") {
    // The runs name real ended trips so the ledger draws them.
    block.series = [{ label: "Q900Z", offering_ids: [{ id: W5.tripEnded2 }, { id: W5.tripEnded3 }] }];
    const drop = expected.filter((v) => /^Q\d+Z$/.test(v) && !Object.values(block).some((f) => f === v));
    for (const v of drop) expected.splice(expected.indexOf(v), 1);
    expected.push("Q900Z");
  }
  if (type === "offering_grid") block.mode = "upcoming"; // only ended trips exist: the designed empty state (Draft preview only) draws empty_text and its button.
  if (type === "rich_text") assertRichText(block.body);
  return { block, expected };
}

describe("#4453 §3.3 every shared layout draws every field its block defines", async () => {
  const artifact = voyageSyntheticArtifact();
  const live = await liveFor(artifact);
  const page = homePage(artifact)!;
  const ctx: SharedContext = { artifact, page, live, forms, analytics: { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id } };
  for (const [type, layouts] of Object.entries(SHARED_BLOCK_LAYOUTS) as Array<[BlockType, Record<string, React.ComponentType<never>>]>) {
    for (const [variant, Layout] of Object.entries(layouts)) {
      it(`${type}:${variant}`, () => {
        const { block, expected } = sentinelBlock(type, artifact);
        // #4453 milestone 5 (§5.2) — a caption names one of the gallery's own photographs.
        if (type === "gallery" && Array.isArray(block.captions) && Array.isArray(block.images)) (block.captions as Array<Record<string, unknown>>).forEach((row, i) => { row.media_id = (block.images as Array<{ id: string }>)[i]?.id; });
        const Component = Layout as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
        // #4453 — an empty upcoming grid is drawn only in a Draft preview (left out of the public site).
        const baseCtx = type === "offering_grid" ? { ...ctx, analytics: { ...ctx.analytics, publicationId: "preview-sentinel" } } : ctx;
        // #4453 milestone 5 — the live booking layouts draw only with live data: give them Core's answer for this block.
        const drawCtx = type === "availability" || type === "ticket_tiers" ? { ...baseCtx, live: { ...baseCtx.live!, booking: sentinelBooking(block) } } : baseCtx;
        const html = renderToStaticMarkup(<Component block={{ ...block, variant, ...(type === "availability" ? { source: "venue_slots" } : {}) }} index={0} ctx={drawCtx} />);
        // §5.2 binding limits: mosaic draws the first 5 pictures, stagger the first 3 (pinned up to 10).
        const take = type === "gallery" ? { mosaic: 5, stagger: 3, pinned: 10 }[variant] ?? 12 : Infinity;
        const media = expected.filter((v) => v.startsWith("/media/") && Array.isArray(block.images));
        const allowed = new Set(media.slice(take));
        // #4453 milestone 7b — "Keep exploring" as a list draws no pictures (spec v2.1 §1.3: the cards layout does).
        if (type === "page_links" && variant === "list") for (const v of expected) if (v.startsWith("/media/")) allowed.add(v);
        const missing = expected.filter((v) => !allowed.has(v) && !html.includes(v.replaceAll("&", "&amp;")));
        expect(missing, `${type}:${variant} drops ${missing.join(", ")}`).toEqual([]);
        expect(html).not.toMatch(/mingla:\/\//);
      });
    }
  }

  it("offering_grid's original form (titles frozen at publish) is drawn too", () => {
    const Poster = SHARED_BLOCK_LAYOUTS.offering_grid!.poster!;
    const html = renderToStaticMarkup(<Poster
      block={{ type: "offering_grid", variant: "poster", offerings: [{ id: W5.tripEnded1, label: "Frozen trip", summary: "Frozen summary", url: "https://host.usemingla.com/t/x" }] }} index={0} ctx={ctx} />);
    for (const v of ["Frozen trip", "Frozen summary", "https://host.usemingla.com/t/x"]) expect(html).toContain(v);
  });

  it("testimonials from the site's confirmed reviews are drawn by every layout", () => {
    for (const [variant, Layout] of Object.entries(SHARED_BLOCK_LAYOUTS.testimonials!)) {
      const html = renderToStaticMarkup(<Layout block={{ type: "testimonials", variant, from_collection: true }} index={0} ctx={ctx} />);
      expect(artifact.collections.testimonials.length).toBeGreaterThan(0);
      for (const review of artifact.collections.testimonials) expect(html, variant).toContain(review.reviewer);
    }
  });

  it("the switcher marks its buttons aria-pressed, and every review is in the page without JavaScript", () => {
    const Switcher = SHARED_BLOCK_LAYOUTS.testimonials!.switcher!;
    const html = renderToStaticMarkup(<Switcher block={{ type: "testimonials", variant: "switcher", from_collection: true }} index={0} ctx={ctx} />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toMatch(/data-voice="\d+"[^>]*hidden/);
  });
});

/* ---------------- chrome ---------------- */

describe("#4453 v2.1 §1.4 the shared header and footer", () => {
  const items = ["Trips", "Stays", "Rooms", "Dining", "Spa", "Events", "Gift ideas", "Contact"].map((label) => ({ label, href: `/${label.toLowerCase().replace(" ", "-")}` }));

  it("folds items beyond capacity under a More disclosure (aria-expanded), container queries only", () => {
    for (const variant of ["glass", "center", "pill"] as const) {
      const html = renderToStaticMarkup(<SharedHeader variant={variant} items={items} path="/rooms/sea-view" logo={null} siteName="Fixture" cta={{ label: "Reserve", href: "https://host.usemingla.com/b/fixture" }} place="Fixture City" />);
      expect(html).toContain(`data-cap="${HEADER_INLINE_CAPACITY[variant]}"`);
      expect(html).toContain('aria-expanded="false"');
      expect(html).toContain(">More<");
      // Every item is in the More list from (capacity - 1) on, for the 1100–1279 px band.
      const more = html.slice(html.indexOf('id="mg-more-list"'));
      expect((more.match(/data-i="/g) ?? []).length).toBe(items.length - (HEADER_INLINE_CAPACITY[variant] - 1));
    }
    const css = fs.readFileSync(path.join(process.cwd(), "public", SHARED_STYLESHEET), "utf8");
    expect(css).toContain("@container mghd (min-width: 1100px)");
    expect(css).toContain("@container mghd (min-width: 1280px)");
  });

  it("lights exactly one top-level item: the longest prefix; Home lights nothing; the wordmark is Home", () => {
    expect(activeIndex(items, "/rooms/sea-view")).toBe(2);
    expect(activeIndex(items, "/")).toBe(-1);
    expect(activeIndex([{ label: "A", href: "/a" }, { label: "AB", href: "/a/b" }], "/a/b/c")).toBe(1);
    const html = renderToStaticMarkup(<SharedHeader variant="pill" items={items.slice(0, 4)} path="/rooms/sea-view" logo={null} siteName="Fixture" cta={null} />);
    const nav = html.slice(html.indexOf('<nav'), html.indexOf("</nav>"));
    expect((nav.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-label="Fixture, home"');
  });

  it("the phone menu is a modal dialog listing Home first, numbered, with the primary action and Mingla's line", () => {
    const html = renderToStaticMarkup(<SharedHeader variant="glass" items={items} path="/" logo={null} siteName="Fixture" cta={{ label: "Reserve", href: "https://host.usemingla.com/b/fixture" }} place="Fixture City" />);
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-label="Menu" hidden=""/);
    const menu = html.slice(html.indexOf('id="mg-phone-menu"'));
    expect(menu.indexOf(">Home<")).toBeLessThan(menu.indexOf(">Trips<"));
    expect(menu).toContain("Booked through Mingla");
    expect(menu).toContain("Fixture City");
  });

  it("the footer derives a Pages column (Home + menu, at most 8) unless the owner set columns, and always credits Mingla", () => {
    const artifact = voyageSyntheticArtifact();
    artifact.footer = { location: "Fixture City" };
    const html = renderToStaticMarkup(<SharedFooter variant="giant" artifact={artifact} items={items} />);
    expect(html).toContain(">Pages<");
    expect((html.slice(html.indexOf(">Pages<"), html.indexOf(">Mingla<")).match(/<li>/g) ?? []).length).toBe(8);
    expect(html).toContain("Powered by Mingla");
    expect(html).toContain('class="mg-giant"');
    artifact.footer = { columns: [{ heading: "Owner column", links: [{ label: "X", href: "/x" }] }] };
    const owned = renderToStaticMarkup(<SharedFooter variant="columns" artifact={artifact} items={items} />);
    expect(owned).toContain("Owner column");
    expect(owned).not.toContain(">Pages<");
  });
});

/* ---------------- SC-D7 + new composition ---------------- */

describe("#4453 SC-D7 stored voyage sites render as before; new compositions get the shared chrome", async () => {
  const stored = voyageSyntheticArtifact();
  const live = await liveFor(stored);
  const render = (artifact: ArtifactV2) => {
    const resolved = resolveSitePath(artifact, "/trips");
    const page = resolved.kind === "page" ? (resolved.page as ArtifactPage) : homePage(artifact)!;
    return renderToStaticMarkup(<VoyagePage artifact={artifact} page={page} live={live} forms={forms} nonce="n" notFound={false} />);
  };
  /** The tag/class tree of the photo-card grid section (text and attributes other than class dropped). */
  const structure = (html: string) => {
    const start = html.search(/<section class="band[^"]*"[^>]*data-offering-source/);
    const section = html.slice(start, html.indexOf("</section>", start) + 10);
    return [...section.matchAll(/<\/?([a-z0-9]+)(?:[^>]*?class="([^"]*)")?[^>]*>/g)].map((m) => `${m[0].startsWith("</") ? "/" : ""}${m[1]}${m[2] ? `.${m[2]}` : ""}`).join(" ");
  };

  it("a stored site keeps voyage's own header and footer, and its photo-card structure", () => {
    assertArtifactV2(stored);
    // #4453 — the fixture's grid is empty, which only a Draft preview draws (left out publicly).
    const html = render({ ...stored, publication_id: `preview-${stored.publication_id}` });
    expect(html).not.toContain('data-mg-header=""');
    expect(html).not.toContain("mg-foot");
    expect(html).not.toContain('data-mg-look="gallery"');
    expect(structure(html)).toMatchSnapshot();
  });

  it("a stored site validates and draws; a new composition with glass + giant validates and draws the shared chrome", () => {
    const fresh = voyageSyntheticArtifact();
    fresh.navigation.header_variant = "glass";
    fresh.footer.footer_variant = "giant";
    assertArtifactV2(fresh);
    const html = render(fresh);
    expect(html).toContain('data-mg-header=""');
    expect(html).toContain("mg-foot--giant");
    expect(html).toContain('data-mg-look="gallery"');
    // The photo-card block itself is untouched by the chrome.
    expect(structure(html)).toBe(structure(render(stored)));
  });

  it("refuses a chrome layout the design does not offer", () => {
    const wrong = voyageSyntheticArtifact();
    wrong.navigation.header_variant = "center";
    expect(() => assertArtifactV2(wrong)).toThrow("ARTIFACT_NAVIGATION_MISMATCH");
    const atelierLike = voyageSyntheticArtifact();
    atelierLike.footer.footer_variant = "columns";
    expect(() => assertArtifactV2(atelierLike)).toThrow("ARTIFACT_FOOTER_MISMATCH");
  });
});

/* ---------------- SC-D3 contrast ---------------- */

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
/** `fg` at `alpha` over `bg` (both hex). */
function over(fg: string, alpha: number, bg: string): string {
  return `#${[1, 3, 5].map((i) => Math.round(Number.parseInt(fg.slice(i, i + 2), 16) * alpha + Number.parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}
const rgbHex = (triple: string) => `#${triple.split(" ").map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;

describe("#4453 SC-D3 I-SITES-DEFAULTS-AA voyage's defaults pass WCAG AA on every surface they draw", () => {
  const c = VOYAGE.tokens.colors;
  const canvas = c.canvas, sunken = c.surface_sunken, surface = c.surface, deep = c.surface_deep;
  const label = c.accent.ramp[700]!;
  // The darkest the hero copy zone gets on a pure white photo: the scrim at 70% (blocks-1.css).
  const photoWorst = over(rgbHex(c.scrim_rgb), 0.7, "#ffffff");
  const small: Array<[string, string, string]> = [
    ["body on canvas", c.ink_body, canvas], ["body on tinted band", c.ink_body, sunken], ["body on surface", c.ink_body, surface],
    ["quiet on canvas", c.ink_quiet, canvas], ["quiet on tinted band", c.ink_quiet, sunken], ["quiet on surface", c.ink_quiet, surface],
    ["accent label on canvas", label, canvas], ["accent label on tinted band", label, sunken], ["accent label on surface", label, surface],
    ["accent ink on accent fill", c.accent_ink, c.accent.ramp[400]!], ["button ink on action", surface, c.action],
    ["band ink on band", c.ink_on_dark_body, deep], ["band label on band", c.highlight_on_dark, deep],
    ["band muted (72%) on band", over(c.ink_on_dark_body, 0.72, deep), deep],
    ["photo text on the scrim's copy zone", c.ink_on_photo_body, photoWorst],
  ];
  for (const [name, fg, bg] of small) it(`${name} ≥ 4.5:1`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
  it("headings and the italic accent ≥ 3:1 on canvas and bands", () => {
    for (const bg of [canvas, sunken]) {
      expect(contrast(c.ink_strong, bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(c.highlight.ramp[600]!, bg)).toBeGreaterThanOrEqual(3);
    }
  });
  it("the gallery's own voyage label (#2a7fb0) would fail, which is why accent 700 is darker", () => {
    expect(contrast("#2a7fb0", sunken)).toBeLessThan(4.5);
  });
  /*
   * §3.8 — Haven's roles, fixed here for PR 6a (Haven itself ships there):
   * accent-label #a2622f → #955a2b, accent fill under accent-ink #b06e3c →
   * #a16537, muted #587170 → #546c6b. Its canvas / band / surface are the
   * gallery's (#eef2f0, #e2e9e6, #f8faf9).
   */
  it("haven's corrected roles pass on every haven surface", () => {
    const haven = { bg: "#eef2f0", alt: "#e2e9e6", surface: "#f8faf9", label: "#955a2b", accent: "#a16537", accentInk: "#f8faf9", muted: "#546c6b" };
    for (const bg of [haven.bg, haven.alt, haven.surface]) {
      expect(contrast(haven.label, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(haven.muted, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(haven.accentInk, haven.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#a2622f", haven.alt)).toBeLessThan(4.5);
  });
});

/* ---------------- motion budget ---------------- */

describe("#4453 §3.5 motion profiles hold the budget", () => {
  for (const [profile, n] of Object.entries(MOTION_PROFILE_NUMBERS)) {
    it(profile, () => {
      expect(n.stagger_ms).toBeLessThanOrEqual(MOTION_BUDGET.max_stagger_ms);
      expect(n.stagger_cap).toBeLessThanOrEqual(MOTION_BUDGET.max_stagger_steps);
      expect(n.hero_settle_ms).toBeLessThanOrEqual(MOTION_BUDGET.max_hero_settle_ms);
      expect(n.hero_scale).toBeGreaterThanOrEqual(MOTION_BUDGET.hero_scale_range[0]);
      expect(n.hero_scale).toBeLessThanOrEqual(MOTION_BUDGET.hero_scale_range[1]);
      expect(n.hero_drift_pct).toBeLessThanOrEqual(MOTION_BUDGET.max_hero_drift_pct);
    });
  }
  it("the shared stylesheet animates only transform, opacity and (hero) clip-path, and pins at most one section", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "public", SHARED_STYLESHEET), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const frames of css.matchAll(/@keyframes [\w-]+ \{([\s\S]*?\})\s*\}/g)) {
      const props = [...frames[1]!.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      for (const prop of props) expect(["transform", "opacity", "clip-path"]).toContain(prop);
    }
    expect((css.match(/view-timeline-name/g) ?? []).length).toBeLessThanOrEqual(MOTION_BUDGET.max_pinned_sections);
  });
});

/* ---------------- SC-D5 fonts and origins, SC-D6 JS ---------------- */

describe("#4453 SC-D5 font budget and no off-origin requests at visit time", () => {
  /*
   * Measured 2026-11-16 from Google's css2 API (the publish pipeline's own
   * source), latin subset, woff2. All three faces are variable fonts: one
   * file per style serves every weight.
   */
  const LATIN_WOFF2_BYTES: Readonly<Record<string, number>> = { "Bricolage Grotesque": 41_236, "DM Sans": 36_980, "JetBrains Mono": 31_340 };

  it("voyage: ≤ 4 families, ≤ 8 latin files, display + body ≤ 180 KB, every face in the catalogue", () => {
    const slots = [VOYAGE.fonts.display, VOYAGE.fonts.body, VOYAGE.fonts.accent, VOYAGE.fonts.label ?? null].filter((slot) => slot !== null);
    const families = new Set(slots.map((slot) => slot!.family));
    expect(families.size).toBeLessThanOrEqual(4);
    expect(families.size).toBeLessThanOrEqual(8); // variable: one latin file per family
    for (const family of families) expect(LATIN_WOFF2_BYTES[family], family).toBeTypeOf("number");
    expect(LATIN_WOFF2_BYTES[VOYAGE.fonts.display.family]! + LATIN_WOFF2_BYTES[VOYAGE.fonts.body.family]!).toBeLessThanOrEqual(180 * 1024);
    const catalogue = read("packages/site-contracts/src/googleFontsCatalog.ts");
    for (const family of families) expect(catalogue).toContain(`["${family}",`);
  });

  it("preloads at most 2 files (display regular + body regular)", () => {
    const artifact = voyageSyntheticArtifact();
    expect(preloadDigests(artifact).length).toBeLessThanOrEqual(2);
  });

  it("a voyage page, the shared stylesheet and voyage's stylesheet request nothing from another origin", async () => {
    const artifact = voyageSyntheticArtifact();
    artifact.navigation.header_variant = "glass";
    artifact.footer.footer_variant = "giant";
    const home = homePage(artifact)!;
    home.blocks = (Object.keys(VOYAGE.picks) as BlockType[]).map((type) => {
      const { block } = sentinelBlock(type, artifact);
      return { ...block, type, variant: compositionVariant(VOYAGE, type) } as never;
    });
    const html = renderToStaticMarkup(<VoyagePage artifact={artifact} page={home} live={await liveFor(artifact)} forms={forms} nonce="n" notFound={false} />);
    const fetched = [
      ...[...html.matchAll(/<(?:img|script|source|video|iframe|link)\b[^>]*?\s(?:src|poster|href)="([^"]+)"/g)].map((m) => m[1]!),
      ...[...html.matchAll(/srcSet="([^"]+)"|srcset="([^"]+)"/g)].flatMap((m) => (m[1] ?? m[2])!.split(",").map((part) => part.trim().split(" ")[0]!)),
    ];
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.filter((url) => !url.startsWith("/") && !url.startsWith("#"))).toEqual([]);
    for (const file of [SHARED_STYLESHEET, "/designs/voyage/1.css"]) {
      const css = fs.readFileSync(path.join(process.cwd(), "public", file), "utf8");
      expect([...css.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]).filter((url) => !url!.startsWith("data:") && !url!.startsWith("/"))).toEqual([]);
      expect(css).not.toMatch(/@import/);
    }
  });
});

describe("#4453 SC-D6 the JavaScript this PR adds stays in budget", () => {
  /*
   * Upper bound: the gzipped SOURCE (comments and types included) of every
   * client module PR 4 adds. The bundler's output is smaller. Motion module
   * ≤ 6 KB, everything added ≤ 25 KB.
   */
  const gz = (file: string) => gzipSync(fs.readFileSync(path.join(process.cwd(), file))).length;
  it("motion module ≤ 6 KB gzipped; all client code added ≤ 25 KB gzipped", () => {
    const motion = gz("src/designs/shared/motion.ts") + gz("src/designs/shared/MotionRoot.tsx");
    const all = motion + gz("src/designs/shared/interactive.tsx") + gz("src/designs/shared/chrome/HeaderClient.tsx");
    expect(motion).toBeLessThanOrEqual(6 * 1024);
    expect(all).toBeLessThanOrEqual(25 * 1024);
  });
  it("adds no runtime dependency (no GSAP, D2)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["next", "react", "react-dom"]);
    for (const file of ["src/designs/shared/motion.ts", "src/designs/shared/interactive.tsx", "src/designs/shared/chrome/HeaderClient.tsx"]) {
      expect(fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/gsap|ScrollTrigger/i);
    }
  });
});

/* ---------------- the shared stylesheet is token-driven ---------------- */

describe("#4453 the shared stylesheet names no colour and touches only design pages", () => {
  const css = fs.readFileSync(path.join(process.cwd(), "public", SHARED_STYLESHEET), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("has no colour literal and reads no token directly (only the --mg-* roles a design maps)", () => {
    expect(css.match(/#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d|(?<![-\w])(?:white|black)(?![-\w])/gi) ?? []).toEqual([]);
    expect(css).not.toMatch(/var\(--c-/);
  });
  it("every --mg-* colour role it reads is mapped by voyage", () => {
    const voyage = fs.readFileSync(path.join(process.cwd(), "public/designs/voyage/1.css"), "utf8");
    const mapped = new Set([...voyage.matchAll(/(--mg-[a-z0-9-]+):/g)].map((m) => m[1]));
    const own = new Set([...css.matchAll(/(--mg-[a-z0-9-]+):/g)].map((m) => m[1]));
    const read = new Set([...css.matchAll(/var\((--mg-[a-z0-9-]+)\)/g)].map((m) => m[1])); // no fallback: must be mapped
    expect([...read].filter((name) => !mapped.has(name) && !own.has(name))).toEqual([]);
  });
});
