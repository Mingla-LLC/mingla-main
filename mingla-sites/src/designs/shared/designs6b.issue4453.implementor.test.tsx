// @vitest-environment jsdom
/*
 * #4453 PR 6b (designs: Journal, Grid, Terra) — the implementor's regression suite.
 *
 * MINGLA-INVARIANT: I-SITES-DESIGN-KEYS-ONE-LIST | issue #4453 | DESIGN_KEYS == renderers == stylesheets == Studio design enum == Core brand_site_design_keys() (6b adds journal, grid, terra).
 * MINGLA-INVARIANT: I-SITES-DEFAULTS-AA | issue #4453 | every gallery design's default text pairs pass WCAG AA (4.5:1 small, 3:1 large) on every surface it draws (6b: Journal, Grid, Terra; their bands are covered by I-SITES-BAND-INK in rework6a).
 * MINGLA-INVARIANT: I-SITES-FONT-AXES | issue #4453 | a design slot's variable-font axes (wdth, opsz, SOFT, WONK) sit inside its family's axes (FONT_AXES); a wdth range is carried on its faces as font-stretch and emitted on @font-face; every gallery design's first-view fonts and whole page font total stay ≤ 180 KB and ≤ 24 @font-face entries.
 *
 * - SC-D1 parity: the three keys have a renderer, a stylesheet, a Studio enum value (design, header and
 *   every layout, live and version tables) and a Core entry; Ari's declared designs stay atelier + voyage.
 * - §3.3: each renderer map is exactly its `variants`; the gallery picks and signature layouts lead; every
 *   signature layout draws every field its block defines; signature headers are offered only by their design.
 * - SC-D2: a full Home validates and renders; structure snapshot pinned (375 and 1440 share one markup).
 * - SC-D3: contrast for every role each design draws (bands: rework6a I-SITES-BAND-INK).
 * - SC-D4: reduced motion, `motion: none` and Save-Data animate nothing; signature motion is gated; the
 *   hero's finite animations sit on elements the 12-at-once cap counts.
 * - SC-D5: font budget (first view and page total), the 24-entry publish limit, catalogue faces, variable axes, no off-origin requests.
 * - Phone menu: portalled to <body> in every header each design offers, covering the viewport.
 * - Brand overrides: an owner's colours, fonts and heading case reach every new design's page.
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BLOCK_CATALOG, type BlockType, type FieldSpec } from "../../contracts/generated/blocks.ts";
import { assertArtifactV2, type ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import {
  ARI_DESIGN_KEYS, DESIGN_KEYS, DESIGNS, GRID, HEADER_INLINE_CAPACITY, HEADER_VARIANTS, JOURNAL, NOCTURNE, SHARED_LAYOUTS, TERRA,
  compositionVariant, type DesignDefinition, type HeaderVariant,
} from "../../contracts/generated/designs.ts";
import { FONT_AXES, MAX_FONT_ASSETS, assertFontAssets, assertFontSlots, type FontAxes } from "../../contracts/generated/fontSlots.ts";
import { resolveTokens } from "../../contracts/generated/tokens.ts";
import { ariVariants } from "../../contracts/generated/ariToolSchemas.ts";
import { w5EndedTrips } from "../../contracts/w5Content.fixture";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { homePage, sitePages, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import { fontFacesCss, preloadDigests } from "../../components/v2/FontFaces";
import { tokenStyleCss } from "../../components/v2/TokenStyle";
import { DESIGN_RENDERERS, SHARED_STYLESHEET } from "../registry";
import { JOURNAL_BLOCK_VARIANTS } from "../journal/JournalPage";
import { GRID_BLOCK_VARIANTS } from "../grid/GridPage";
import { TERRA_BLOCK_VARIANTS } from "../terra/TerraPage";
import { JOURNAL_SIGNATURE_BLOCKS } from "../journal/blocks/JournalBlocks";
import { GRID_SIGNATURE_BLOCKS } from "../grid/blocks/GridBlocks";
import { TERRA_SIGNATURE_BLOCKS } from "../terra/blocks/TerraBlocks";
import { motionAttributes } from "./library";
import { galleryArtifact, galleryUpcomingTrips } from "./galleryDesigns.fixture";
import type { SharedContext } from "./parts";
import { MAX_ANIMATING_AT_ONCE } from "./motion";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
// A cover's /om token is signed with the runtime key (test value only).
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 7).toString("base64"), videoCdnHosts: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(process.cwd(), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const css = (file: string) => fs.readFileSync(path.join(process.cwd(), "public", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
const NEW: readonly DesignDefinition[] = [JOURNAL, GRID, TERRA];
const MAPS = { journal: JOURNAL_BLOCK_VARIANTS, grid: GRID_BLOCK_VARIANTS, terra: TERRA_BLOCK_VARIANTS } as const;
const SIGNATURES = { journal: JOURNAL_SIGNATURE_BLOCKS, grid: GRID_SIGNATURE_BLOCKS, terra: TERRA_SIGNATURE_BLOCKS } as const;

async function liveFor(artifact: ArtifactV2): Promise<LiveOfferings> {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
}

function studioEnum(table: string): Set<string> {
  const dir = path.join(ROOT, "mingla-site-cms/src/migrations");
  const sql = fs.readdirSync(dir).filter((file) => file.endsWith(".ts")).map((file) => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");
  const values = new Set<string>();
  for (const m of sql.matchAll(new RegExp(`"${table}" AS ENUM\\(([^)]*)\\)`, "g"))) for (const v of m[1]!.matchAll(/'([^']+)'/g)) values.add(v[1]!);
  for (const m of sql.matchAll(new RegExp(`"${table}" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'`, "g"))) values.add(m[1]!);
  return values;
}

function render(artifact: ArtifactV2, page?: ArtifactPage, live?: LiveOfferings): string {
  const { Page } = DESIGN_RENDERERS[artifact.design.key as keyof typeof DESIGN_RENDERERS];
  return renderToStaticMarkup(<Page artifact={artifact} page={page ?? (homePage(artifact) as ArtifactPage)} live={live} forms={forms} nonce="n" notFound={false} />);
}

/* ---------------- SC-D1 ---------------- */

describe("#4453 6b SC-D1 journal, grid and terra are design keys everywhere", () => {
  it("DESIGN_KEYS lists all eight, each new one with a renderer, the shared stylesheet and its own stylesheet", () => {
    // #4453 6c appended pop, sunset and pulse (designs6c pins the whole list).
    expect(DESIGN_KEYS.slice(0, 8)).toEqual(["atelier", "voyage", "nocturne", "haven", "maison", "journal", "grid", "terra"]);
    for (const design of NEW) {
      const renderer = DESIGN_RENDERERS[design.key];
      expect(renderer.sharedStylesheet).toBe(SHARED_STYLESHEET);
      expect(fs.existsSync(path.join(process.cwd(), "public", renderer.stylesheet(design.version)))).toBe(true);
    }
  });

  it("Studio's design enum, header enum and every layout's enum (live and version) hold them", () => {
    for (const table of ["enum_site_settings_design", "enum__site_settings_v_version_design"]) {
      for (const design of NEW) expect(studioEnum(table).has(design.key), `${table} ${design.key}`).toBe(true);
    }
    for (const table of ["enum_navigation_header_variant", "enum__navigation_v_version_header_variant"]) {
      for (const header of HEADER_VARIANTS) expect(studioEnum(table).has(header), `${table} ${header}`).toBe(true);
    }
    for (const design of NEW) {
      for (const [type, variants] of Object.entries(design.variants)) {
        for (const table of [`enum_pages_blocks_${type}_variant`, `enum__pages_v_blocks_${type}_variant`]) {
          const values = studioEnum(table);
          for (const variant of variants) expect(values.has(variant), `${design.key} ${table} ${variant}`).toBe(true);
        }
      }
    }
    const nav = read("mingla-site-cms/src/collections/Navigation.ts");
    expect(nav).toContain('"journal-mast": "Masthead (Journal)"');
    expect(nav).toContain('"grid-bar": "Ruled bar (Grid)"');
  });

  it("Core: the 6b migration replaces only brand_site_design_keys() with the eight keys, after 6a", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const sql = read("supabase/migrations/20280807034453_issue_4453_design_keys_6b.sql");
    expect(sql).toContain("SELECT ARRAY['atelier','voyage','nocturne','haven','maison','journal','grid','terra']::text[]");
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(sql).not.toMatch(/ALTER TABLE|DROP |INSERT |UPDATE |DELETE /);
    const prefixes = fs.readdirSync(dir).filter((file) => /^\d{14}_/.test(file)).map((file) => file.slice(0, 14)).sort();
    expect(prefixes).toContain("20280807034453");
    expect(read("supabase/migrations/__tests__/issue_4453_design_keys.fixture.sql")).toContain("ARRAY['atelier','voyage','nocturne','haven','maison','journal','grid','terra',");
  });

  it("Ari's frozen #3355 declarations name only atelier and voyage (PR 7's design pass offers the rest)", () => {
    expect(ARI_DESIGN_KEYS).toEqual(["atelier", "voyage"]);
    for (const layout of ["journal-front", "grid-index", "terra-pebble"]) expect(ariVariants("hero")).not.toContain(layout);
    expect(ariVariants("newsletter_signup")).not.toContain("journal-coupon");
    expect(read("supabase/functions/_shared/agentSiteTools.ts")).toContain("enum: [...ARI_DESIGN_KEYS]");
  });
});

/* ---------------- §3.3 layouts ---------------- */

describe("#4453 6b §3.3 each design draws exactly the layouts it offers", () => {
  for (const design of NEW) {
    it(`${design.key}: renderer map == variants; picks lead; every shared layout offered`, () => {
      const map = MAPS[design.key as keyof typeof MAPS];
      for (const [type, variants] of Object.entries(design.variants) as Array<[BlockType, readonly string[]]>) {
        expect(Object.keys(map[type]), `${design.key} ${type}`).toEqual([...variants]);
        expect(variants[0], `${design.key} ${type} default`).toBe(compositionVariant(design, type));
        const shared = SHARED_LAYOUTS[type];
        if (!shared) expect(variants).toEqual(["neutral"]);
        else for (const layout of shared) expect(variants).toContain(layout);
      }
    });
  }

  it("the gallery maps: hero, offerings, cards, gallery, history, reviews, newsletter, chrome and motion per design", () => {
    const row = (d: DesignDefinition) => [d.variants.hero[0], d.variants.offering_grid[0], d.variants.feature_cards[0], d.variants.gallery[0], d.variants.offering_history[0], d.variants.testimonials[0], d.variants.newsletter_signup[0], d.chrome.header[0], d.chrome.footer[0], d.motion.profile];
    expect(row(JOURNAL)).toEqual(["journal-front", "journal-columns", "numbered", "journal-essay", "ledger-count", "journal-letters", "journal-coupon", "journal-mast", "giant", "cinematic"]);
    expect(row(GRID)).toEqual(["grid-index", "list", "tiles", "mosaic", "ledger-count", "wall", "photo", "grid-bar", "giant", "bold"]);
    expect(row(TERRA)).toEqual(["terra-pebble", "cards", "tiles", "mosaic", "ledger-count", "rail", "photo", "center", "giant", "calm"]);
    expect([JOURNAL, GRID, TERRA].map((d) => d.label)).toEqual(["Journal", "Grid", "Terra"]);
  });

  it("the signature headers are offered only by their own design, with a capacity the header CSS handles", () => {
    for (const design of Object.values(DESIGNS)) {
      expect(design.chrome.header.includes("journal-mast"), design.key).toBe(design.key === "journal");
      expect(design.chrome.header.includes("grid-bar"), design.key).toBe(design.key === "grid");
    }
    // blocks-1.css folds items at data-cap 6 and 4 only.
    for (const header of HEADER_VARIANTS) expect([4, 6]).toContain(HEADER_INLINE_CAPACITY[header]);
    const wrong = galleryArtifact("terra");
    wrong.navigation.header_variant = "journal-mast";
    expect(() => assertArtifactV2(wrong)).toThrow();
  });
});

/** A block of `type` with a findable value in every drawn content field (lists get two rows). */
function sentinelBlock(type: BlockType, artifact: ArtifactV2): { block: Record<string, unknown>; expected: string[] } {
  const expected: string[] = [];
  let n = 0;
  const media = artifact.media.filter((item) => !/\.(mp4|webm|mov)$/i.test(item.url));
  const value = (spec: FieldSpec, key: string): unknown => {
    n += 1;
    switch (spec.kind) {
      case "text": { const v = `Q${n}Z`; expected.push(v); return v; }
      case "href":
      case "action_href": { const v = `https://example.invalid/h${n}`; expected.push(v); return v; }
      case "media_url": { const v = media[n % media.length]!.url; expected.push(v); return v; }
      case "media_list":
        return media.slice(0, 4).map((item) => { expected.push(item.url); return { id: item.id, url: item.url, alt: item.alt, width: item.width, height: item.height }; });
      case "list":
        return [0, 1].map(() => Object.fromEntries(Object.entries(spec.item).flatMap(([k, s]) => { const v = value(s, k); return v === undefined ? [] : [[k, v]]; })));
      case "integer": return key === "price_minor" ? 1200 : spec.max;
      case "currency": return "USD";
      case "number": return key === "latitude" ? 6.5 : 3.4;
      case "boolean": return false;
      case "mingla_href": { const v = `https://host.usemingla.com/b/fixture/v/${n}`; expected.push(v); return v; }
      case "rich_text": { const v = `R${n}Z`; expected.push(v); return { type: "doc", children: [{ type: "paragraph", children: [{ type: "text", text: v }] }] }; }
      case "enum": return spec.values[0];
      case "uuid": case "icon": case "slug": case "video_url": case "email": case "timezone": case "city_timezone":
        return undefined;
      default: {
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
    if (type === "offering_grid" && ["offerings", "offering_ids"].includes(key)) { expected.splice(before); continue; }
    // #4453 milestone 7b — fact badges are drawn by the shared hero layouts only (HERO_LAYOUTS_WITH_FACTS; the builder drops them elsewhere).
    if (type === "hero" && key === "fact_badges") { expected.splice(before); continue; }
    block[key] = v;
  }
  if (type === "offering_grid") block.mode = "upcoming";
  return { block, expected };
}

describe("#4453 6b §3.3 every signature layout draws every field its block defines", async () => {
  for (const design of NEW) {
    const artifact = galleryArtifact(design.key);
    const live = await liveFor(artifact);
    const page = homePage(artifact)!;
    const ctx: SharedContext = { artifact, page, live, forms, analytics: { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id } };
    for (const [type, byVariant] of Object.entries(SIGNATURES[design.key as keyof typeof SIGNATURES])) {
      for (const [variant, Layout] of Object.entries(byVariant as Record<string, React.ComponentType<never>>)) {
        it(`${design.key} ${type}:${variant}`, () => {
          expect(design.variants[type as BlockType][0]).toBe(variant);
          const { block, expected } = sentinelBlock(type as BlockType, artifact);
          // #4453 milestone 5 (§5.2) — a caption names one of the gallery's own photographs.
          if (type === "gallery" && Array.isArray(block.captions) && Array.isArray(block.images)) (block.captions as Array<Record<string, unknown>>).forEach((row, i) => { row.media_id = (block.images as Array<{ id: string }>)[i]?.id; });
          const Component = Layout as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
          // #4453 (milestone 3) — the sentinel grid is empty (only ended trips): its designed empty state,
          // with every field, is drawn in a Draft preview; publicly the section is left out.
          const drawCtx = type === "offering_grid" ? { ...ctx, analytics: { ...ctx.analytics, publicationId: "preview-sentinel" } } : ctx;
          const html = renderToStaticMarkup(<Component block={{ ...block, variant }} index={0} ctx={drawCtx} />);
          if (type === "offering_grid") expect(renderToStaticMarkup(<Component block={{ ...block, variant }} index={0} ctx={ctx} />)).toBe("");
          const missing = expected.filter((v) => !html.includes(v.replaceAll("&", "&amp;")));
          expect(missing, `${type}:${variant} drops ${missing.join(", ")}`).toEqual([]);
          expect(html).not.toMatch(/mingla:\/\//);
        });
      }
    }
  }
});

/* ---------------- SC-D2 Home renders; structure snapshot ---------------- */

/** The tag/class tree of the page's main content (text and non-class attributes dropped). */
function structure(html: string): string {
  const start = html.indexOf('<main id="main"');
  const main = html.slice(start, html.indexOf("</main>", start) + 7);
  return [...main.matchAll(/<\/?([a-z0-9]+)(?:[^>]*?class="([^"]*)")?[^>]*>/g)].map((m) => `${m[0].startsWith("</") ? "/" : ""}${m[1]}${m[2] ? `.${m[2]}` : ""}`).join("\n");
}

/** The header's tag/class tree (the signature headers are part of the design). */
function headerStructure(html: string): string {
  const start = html.indexOf("<header");
  const header = html.slice(start, html.indexOf("</header>", start) + 9);
  return [...header.matchAll(/<\/?([a-z0-9]+)(?:[^>]*?class="([^"]*)")?[^>]*>/g)].map((m) => `${m[0].startsWith("</") ? "/" : ""}${m[1]}${m[2] ? `.${m[2]}` : ""}`).join("\n");
}

describe("#4453 6b SC-D2 each design's Home validates and renders on fixture data", async () => {
  for (const design of NEW) {
    const artifact = galleryArtifact(design.key);
    const live = await liveFor(artifact);
    it(`${design.key}: validates, draws its chrome, one h1, and its structure is pinned (375 and 1440 share one markup)`, () => {
      assertArtifactV2(artifact);
      const html = render(artifact, undefined, live);
      expect(html).toContain(`mg-hd--${design.chrome.header[0]}`);
      expect(html).toContain(`mg-foot--${design.chrome.footer[0]}`);
      expect(html).toContain('data-mg-look="gallery"');
      expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
      expect(html).toContain("Wake up");
      // The fixture's upcoming grid is empty (I-SITES-NO-PUBLIC-EMPTY-STATE): the public Home leaves it out,
      // a Draft preview draws it; both structures are pinned.
      const preview = render({ ...artifact, publication_id: `preview-${artifact.publication_id}` }, undefined, live);
      expect(html).not.toContain("Trips from the house");
      expect(preview).toContain("Trips from the house");
      expect(structure(html)).toMatchSnapshot();
      expect(structure(preview)).toMatchSnapshot();
      expect(headerStructure(html)).toMatchSnapshot();
    });
  }

  it("Journal's masthead carries the place line; Grid's bar numbers its items for sight only", () => {
    const journal = render(galleryArtifact("journal"));
    const place = galleryArtifact("journal").footer.location!;
    expect(place).toBeTruthy();
    expect(journal).toContain(`<div class="jr-dateline"><div class="mg-wrap"><p>${place}</p></div></div>`);
    const grid = render(galleryArtifact("grid"));
    expect(grid).toMatch(/<small class="gr-n" aria-hidden="true">01<\/small>/);
    expect(render(galleryArtifact("terra"))).not.toMatch(/gr-n|jr-dateline/);
  });

  it("every page of the fixture site renders on each design (about, contact, journal, places, trips, FAQ)", async () => {
    for (const design of NEW) {
      const artifact = galleryArtifact(design.key);
      const live = await liveFor(artifact);
      const pages = sitePages(artifact);
      expect(pages.length).toBeGreaterThanOrEqual(6);
      for (const page of pages) expect(render(artifact, page, live), `${design.key} ${page.key}`).toContain('<main id="main"');
    }
  });

  it("refuses a block layout a design does not offer (another design's signature)", () => {
    const wrong = galleryArtifact("grid");
    (homePage(wrong)!.blocks[0] as unknown as { variant: string }).variant = "terra-pebble";
    expect(() => assertArtifactV2(wrong)).toThrow();
  });

  it("the contact form on each design posts its page path, never an href", () => {
    for (const design of NEW) {
      const artifact = galleryArtifact(design.key);
      const page = sitePages(artifact).find((candidate) => candidate.blocks.some((block) => String(block.type) === "contact_form"))!;
      const html = render(artifact, page);
      expect(html, design.key).toContain(`name="page" value="${page.path}"`);
      expect(page.path).not.toMatch(/^\//);
    }
  });
});

/* ---------------- SC-D3 contrast ---------------- */

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
function over(fg: string, alpha: number, bg: string): string {
  return `#${[1, 3, 5].map((i) => Math.round(Number.parseInt(fg.slice(i, i + 2), 16) * alpha + Number.parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}
const rgbHex = (triple: string) => `#${triple.split(" ").map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;

/** Each design's label role (the --mg-label its stylesheet maps), its button ink and its large italic word. */
const ROLES = {
  journal: { label: 400, button: "canvas", italic: ["highlight", 600] },
  grid: { label: 700, button: "canvas", italic: ["highlight", 600] },
  terra: { label: 700, button: "surface", italic: ["accent", 400] },
} as const;

describe("#4453 6b SC-D3 I-SITES-DEFAULTS-AA every role each design draws passes AA", () => {
  for (const design of NEW) {
    const c = design.tokens.colors;
    const roles = ROLES[design.key as keyof typeof ROLES];
    const label = c.accent.ramp[roles.label]!;
    const surfaces: Array<[string, string]> = [["canvas", c.canvas], ["tinted band", c.surface_sunken], ["surface", c.surface]];
    const photoWorst = over(rgbHex(c.scrim_rgb), 0.7, "#ffffff");
    const small: Array<[string, string, string]> = [
      ...surfaces.flatMap(([name, bg]): Array<[string, string, string]> => [
        [`body on ${name}`, c.ink_body, bg], [`quiet on ${name}`, c.ink_quiet, bg], [`label on ${name}`, label, bg], [`headings on ${name}`, c.ink_strong, bg],
      ]),
      ["accent ink on accent fill", c.accent_ink, c.accent.ramp[400]!],
      ["button ink on action", c[roles.button], c.action],
      ["band ink on band", c.ink_on_dark_body, c.surface_deep], ["band label on band", c.highlight_on_dark, c.surface_deep],
      ["band muted on band", over(c.ink_on_dark_body, 0.72, c.surface_deep), c.surface_deep],
      ["photo text on the scrim's copy zone", c.ink_on_photo_body, photoWorst],
      ["photo quiet on the scrim's copy zone", c.ink_on_photo_quiet, photoWorst],
    ];
    for (const [name, fg, bg] of small) it(`${design.key}: ${name} ≥ 4.5:1`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
    it(`${design.key}: the large italic accent word ≥ 3:1 on the page`, () => {
      const [role, step] = roles.italic;
      const ramp = (role === "accent" ? c.accent.ramp : c.highlight.ramp) as Record<number, string>;
      expect(contrast(ramp[step]!, c.canvas)).toBeGreaterThanOrEqual(3);
    });
  }

  it("grid: a hovered button turns red with BLACK ink (the canvas ink on red would fail)", () => {
    const c = GRID.tokens.colors;
    expect(contrast(c.canvas, c.accent.ramp[400]!)).toBeLessThan(4.5);
    expect(contrast(c.accent_ink, c.accent.ramp[400]!)).toBeGreaterThanOrEqual(4.5);
    expect(css("/designs/grid/1.css")).toContain('[data-design="grid"] .mg-page .mg-btn:hover { color: var(--c-accent-ink); }');
  });

  it("terra: the ticker's ink on its sage ribbon, and the label sprig colour, pass", () => {
    const c = TERRA.tokens.colors;
    expect(contrast(c.ink_strong, c.highlight.ramp[200]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("no new stylesheet forces capitals on a heading (the owner's heading case wins)", () => {
    for (const design of NEW) {
      for (const rule of css(`/designs/${design.key}/1.css`).matchAll(/([^{}]*\b(?:h1|h2|h3|mg-h1|mg-giant)\b[^{}]*)\{([^}]*text-transform:\s*uppercase[^}]*)\}/g)) {
        throw new Error(`${design.key}: a heading rule forces uppercase: ${rule[1]!.trim()}`);
      }
    }
  });
});

/* ---------------- SC-D4 motion ---------------- */

describe("#4453 6b SC-D4 reduced motion, motion: none and Save-Data animate nothing", () => {
  for (const design of NEW) {
    it(`${design.key}: none and Save-Data draw data-motion=none; the page is complete at rest`, () => {
      expect(motionAttributes(design, "none")["data-motion"]).toBe("none");
      expect(motionAttributes(design, "design", true)["data-motion"]).toBe("none");
      const artifact = galleryArtifact(design.key);
      artifact.tokens.motion = "none";
      const html = render(artifact);
      expect(html).toContain('data-motion="none"');
      expect(html).not.toMatch(/\shidden=""[^>]*data-mg-rise|style="[^"]*opacity:\s*0/);
    });

    it(`${design.key}: every animation runs only with motion on and no reduced-motion preference, on transform / opacity / clip-path; nothing but the Journal masthead is sticky`, () => {
      const sheet = css(`/designs/${design.key}/1.css`);
      for (const rule of sheet.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(?!none)[^;}]+/g)) {
        expect(rule[1], rule[0]).toContain('[data-motion="on"]');
        expect(sheet.slice(0, rule.index).lastIndexOf("@media (prefers-reduced-motion: no-preference)"), rule[0]).toBeGreaterThan(-1);
      }
      for (const frames of sheet.matchAll(/@keyframes [\w-]+ \{([\s\S]*?\})\s*\}/g)) {
        for (const prop of [...frames[1]!.matchAll(/([a-z-]+):/g)].map((m) => m[1])) expect(["transform", "opacity", "clip-path"]).toContain(prop);
      }
      expect(sheet).not.toMatch(/view-timeline-name/);
      // The pinned-section budget is the shared gallery's; a masthead whose menu row stays in view is chrome.
      const sticky = [...sheet.matchAll(/([^{}]+)\{[^{}]*position:\s*sticky/g)].map((m) => m[1]!.trim());
      expect(sticky).toEqual(design.key === "journal" ? ['[data-design="journal"] .mg-page .mg-hd--journal-mast'] : []);
    });
  }

  it("the hero's finite signature animations sit on elements the 12-at-once cap counts (lines and [data-mg-hero-bg]); Terra's turning blob is the only infinite one", () => {
    // Grid wipes its picture in: the wiped element is the hero picture the cap holds a slot for.
    expect(css("/designs/grid/1.css")).toMatch(/\.mg-scope\[data-motion="on"\] \.gr-img \{ animation: gr-wipe/);
    const grid = render(galleryArtifact("grid"));
    expect(grid).toMatch(/class="gr-img mg-ph" data-mg-hero-bg=""/);
    expect(css("/designs/terra/1.css")).toMatch(/\.tr-blob \{ animation: tr-turn 90s linear infinite;/);
    // Journal draws its rules with a scroll-driven timeline only (never at load).
    expect(css("/designs/journal/1.css")).toMatch(/animation: jr-rule linear both; animation-timeline: view\(\)/);
    for (const design of NEW) {
      const html = render(galleryArtifact(design.key));
      const hero = html.slice(html.indexOf("data-mg-hero"), html.indexOf("</section>", html.indexOf("data-mg-hero")));
      const movers = (hero.match(/class="mg-ln"|data-mg-hero-bg=""/g) ?? []).length;
      expect(movers, design.key).toBeGreaterThan(0);
      expect(movers, design.key).toBeLessThanOrEqual(MAX_ANIMATING_AT_ONCE);
    }
  });
});

/* ---------------- SC-D5 fonts and origins ---------------- */

describe("#4453 6b SC-D5 font budget, variable axes and no off-origin requests", () => {
  /*
   * Every latin woff2 file a gallery design's page can load, measured
   * 2026-11-16 by running the publish pipeline itself (resolveSiteFonts
   * against Google's css2 API, with each design's axes). Variable families
   * are one file per style (all weights); IBM Plex Mono is static (one file
   * per weight). `firstView` are the display and body files (§3.6).
   */
  const BUDGET: Readonly<Record<string, { files: Readonly<Record<string, number>>; firstView: readonly string[] }>> = {
    nocturne: { files: { "Bodoni Moda/normal": 25_804, "Bodoni Moda/italic": 30_220, "Archivo/normal": 90_096 }, firstView: ["Bodoni Moda/normal", "Archivo/normal"] },
    haven: { files: { "Cormorant/normal": 35_280, "Cormorant/italic": 38_076, "Manrope/normal": 24_436 }, firstView: ["Cormorant/normal", "Manrope/normal"] },
    maison: { files: { "Italiana/normal": 10_164, "Newsreader/normal": 58_152, "Newsreader/italic": 64_500, "Jost/normal": 26_588 }, firstView: ["Italiana/normal", "Newsreader/normal"] },
    // Fraunces with opsz 9..144 (Journal) and with opsz plus SOFT 100 / WONK 1 pinned (Terra): different files.
    journal: { files: { "Fraunces/normal": 67_388, "Fraunces/italic": 81_704, "Libre Franklin/normal": 30_884 }, firstView: ["Fraunces/normal", "Libre Franklin/normal"] },
    grid: { files: { "Hanken Grotesk/normal": 34_664, "IBM Plex Mono/500": 10_056, "IBM Plex Mono/700": 10_128 }, firstView: ["Hanken Grotesk/normal"] },
    terra: { files: { "Fraunces/normal": 62_120, "Fraunces/italic": 79_180, "Figtree/normal": 20_184 }, firstView: ["Fraunces/normal", "Figtree/normal"] },
  };
  const filesOf = (design: DesignDefinition): Set<string> => new Set([design.fonts.display, design.fonts.body, design.fonts.accent, design.fonts.label ?? null]
    .filter((slot) => slot !== null && slot.source === "google")
    .flatMap((slot) => (slot!.family === "IBM Plex Mono" ? slot!.weights.map((w) => `${slot!.family}/${w}`) : [`${slot!.family}/normal`, ...(slot!.italic ? [`${slot!.family}/italic`] : [])])));
  const catalogue = read("packages/site-contracts/src/googleFontsCatalog.ts");
  const KB180 = 180 * 1024;

  for (const key of Object.keys(BUDGET)) {
    const design = DESIGNS[key as keyof typeof DESIGNS];
    it(`${key}: ≤ 4 families, ≤ 8 latin files, first view (display + body) AND the page's whole font total ≤ 180 KB, ≤ 24 @font-face entries, every face in the catalogue, ≤ 2 preloads`, () => {
      const budget = BUDGET[key]!;
      const files = filesOf(design);
      expect([...files].sort(), key).toEqual(Object.keys(budget.files).sort());
      expect(new Set([...files].map((file) => file.split("/")[0])).size).toBeLessThanOrEqual(4);
      expect(files.size).toBeLessThanOrEqual(8);
      const sum = (names: Iterable<string>) => [...names].reduce((total, name) => total + budget.files[name]!, 0);
      expect(sum(budget.firstView), `${key} first view`).toBeLessThanOrEqual(KB180);
      expect(sum(files), `${key} page total`).toBeLessThanOrEqual(KB180);
      // The publish limit: one @font-face per weight × style × kept subset (latin, latin-ext).
      const faces = new Set<string>();
      for (const slot of [design.fonts.display, design.fonts.body, design.fonts.accent, design.fonts.label ?? null]) {
        if (!slot || slot.source !== "google") continue;
        for (const weight of slot.weights) for (const style of slot.italic ? ["normal", "italic"] : ["normal"]) faces.add(`${slot.family}|${weight}|${style}`);
      }
      expect(faces.size * 2, `${key} @font-face entries`).toBeLessThanOrEqual(MAX_FONT_ASSETS);
      for (const slot of [design.fonts.display, design.fonts.body, design.fonts.accent, design.fonts.label ?? null]) {
        if (!slot) continue;
        const row = new RegExp(`\\["${slot.family}","[a-z-]+",\\[([\\d,]*)\\],\\[([\\d,]*)\\]`).exec(catalogue);
        expect(row, slot.family).not.toBeNull();
        const weights = row![1]!.split(",").map(Number);
        for (const weight of slot.weights) expect(weights, `${slot.family} ${weight}`).toContain(weight);
        if (slot.italic) expect(row![2], `${slot.family} italic`).not.toBe("");
      }
      expect(preloadDigests(galleryArtifact(design.key)).length).toBeLessThanOrEqual(2);
    });
  }

  for (const design of NEW) {
    it(`${design.key}: the page and its stylesheet request nothing from another origin`, async () => {
      const artifact = galleryArtifact(design.key);
      const html = render(artifact, undefined, await liveFor(artifact));
      const fetched = [
        ...[...html.matchAll(/<(?:img|script|source|video|iframe|link)\b[^>]*?\s(?:src|poster|href)="([^"]+)"/g)].map((m) => m[1]!),
        ...[...html.matchAll(/srcSet="([^"]+)"|srcset="([^"]+)"/g)].flatMap((m) => (m[1] ?? m[2])!.split(",").map((part) => part.trim().split(" ")[0]!)),
      ];
      expect(fetched.length).toBeGreaterThan(0);
      expect(fetched.filter((url) => !url.startsWith("/") && !url.startsWith("#"))).toEqual([]);
      const sheet = css(`/designs/${design.key}/1.css`);
      expect([...sheet.matchAll(/url\(\s*["']?([^"')]+)/g)].map((m) => m[1]).filter((url) => !url!.startsWith("data:") && !url!.startsWith("/"))).toEqual([]);
      expect(sheet).not.toMatch(/@import|@font-face/);
    });
  }

  it("I-SITES-FONT-AXES: every design axis sits inside its family's axes; the gallery's axes are the ones drawn", () => {
    expect(FONT_AXES.Archivo).toEqual({ wdth: [62, 125] });
    expect(FONT_AXES.Fraunces).toEqual({ opsz: [9, 144], SOFT: [0, 100], WONK: [0, 1] });
    for (const design of Object.values(DESIGNS)) {
      for (const slot of [design.fonts.display, design.fonts.body, design.fonts.accent, design.fonts.label ?? null]) {
        if (!slot?.axes) continue;
        for (const [tag, range] of Object.entries(slot.axes) as Array<[keyof FontAxes, readonly [number, number]]>) {
          const family = FONT_AXES[slot.family]?.[tag];
          expect(family, `${design.key} ${slot.family} ${tag}`).toBeDefined();
          expect(range[0]).toBeGreaterThanOrEqual(family![0]);
          expect(range[1]).toBeLessThanOrEqual(family![1]);
        }
      }
    }
    expect(NOCTURNE.fonts.body.axes).toEqual({ wdth: [62, 125] });
    // Journal: the high-contrast optical size; Terra: optical size with the soft, wonky instance pinned.
    for (const slot of [JOURNAL.fonts.display, JOURNAL.fonts.accent!]) expect(slot.axes).toEqual({ opsz: [9, 144] });
    for (const slot of [TERRA.fonts.display, TERRA.fonts.accent!]) expect(slot.axes).toEqual({ opsz: [9, 144], SOFT: [100, 100], WONK: [1, 1] });
    // One family, one axis set per design (two slots of one family share their files).
    for (const design of Object.values(DESIGNS)) {
      const byFamily = new Map<string, string>();
      for (const slot of [design.fonts.display, design.fonts.body, design.fonts.accent, design.fonts.label ?? null]) {
        if (!slot) continue;
        const axes = JSON.stringify(slot.axes ?? {});
        expect(byFamily.get(slot.family) ?? axes, `${design.key} ${slot.family}`).toBe(axes);
        byFamily.set(slot.family, axes);
      }
    }
  });

  it("I-SITES-FONT-AXES: Nocturne's Archivo faces and @font-face carry font-stretch; Fraunces' faces carry none (opsz is automatic, SOFT/WONK are in the file)", () => {
    const artifact = galleryArtifact("nocturne");
    assertArtifactV2(artifact);
    const archivo = artifact.font_assets.filter((asset) => asset.family === "Archivo");
    expect(archivo.length).toBeGreaterThan(0);
    for (const asset of archivo) expect(asset.stretch).toBe("62% 125%");
    expect(fontFacesCss(artifact)).toMatch(/font-family:"Archivo";font-style:normal;font-weight:400;font-stretch:62% 125%;font-display:swap/);
    expect(fontFacesCss(artifact)).not.toMatch(/"Bodoni Moda"[^}]*font-stretch/);
    for (const key of ["journal", "terra"] as const) {
      const fraunces = galleryArtifact(key);
      assertArtifactV2(fraunces);
      expect(fontFacesCss(fraunces), key).not.toMatch(/font-stretch/);
      expect(css(`/designs/${key}/1.css`), key).not.toMatch(/font-optical-sizing:\s*none/);
    }
    const nocturne = css("/designs/nocturne/1.css");
    expect(nocturne).toContain("font-stretch: 62%");
    expect(nocturne).toContain("font-stretch: 125%");
  });

  it("the artifact contract refuses malformed axes or stretch, an unknown axis, and axes on a system face", () => {
    const slots = structuredClone(galleryArtifact("terra").fonts);
    assertFontSlots(slots);
    for (const bad of [{ wdth: [125, 62] }, { wdth: [62] }, { wdth: [10, 125] }, { opsz: ["9", "144"] }, { GRAD: [0, 100] }, {}, [62, 125]]) {
      const copy = structuredClone(slots) as unknown as { display: { axes: unknown } };
      copy.display.axes = bad;
      expect(() => assertFontSlots(copy), JSON.stringify(bad)).toThrow(/ARTIFACT_FONTS_MISMATCH:display/);
    }
    const system = structuredClone(slots) as unknown as { body: Record<string, unknown> };
    system.body = { family: "Arial", source: "system", weights: [400], italic: false, axes: { wdth: [62, 125] } };
    expect(() => assertFontSlots(system)).toThrow(/ARTIFACT_FONTS_MISMATCH:body/);
    const nocturne = galleryArtifact("nocturne");
    const assets = structuredClone(nocturne.font_assets);
    assertFontAssets(assets, nocturne.fonts);
    for (const bad of ["62%", "62% 125%;x", "calc(1px) 2%"]) {
      const copy = structuredClone(assets);
      (copy[0] as { stretch?: string }).stretch = bad;
      expect(() => assertFontAssets(copy, nocturne.fonts), bad).toThrow(/ARTIFACT_FONT_ASSETS_MISMATCH:0/);
    }
  });
});

/* ---------------- phone menu ---------------- */

describe("#4453 6b the phone menu covers the viewport in every header each design offers", () => {
  for (const design of NEW) {
    for (const header of design.chrome.header) {
      it(`${design.key} (${header}): the dialog is portalled to <body>, lists every page, and closes on Escape`, async () => {
        document.body.innerHTML = "";
        const host = document.createElement("div");
        document.body.append(host);
        const root = createRoot(host);
        const artifact = galleryArtifact(design.key);
        artifact.navigation.header_variant = header as HeaderVariant;
        assertArtifactV2(artifact);
        const { Page } = DESIGN_RENDERERS[design.key];
        await act(async () => root.render(<Page artifact={artifact} page={homePage(artifact) as ArtifactPage} forms={forms} nonce="n" notFound={false} />));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        expect(host.querySelector(`.mg-hd--${header}`)).not.toBeNull();
        const dialog = document.getElementById("mg-phone-menu")!;
        expect(dialog.parentElement).toBe(document.body);
        expect(dialog.closest("header")).toBeNull();
        await act(async () => (document.querySelector(".mg-menu-btn") as HTMLButtonElement).click());
        expect(dialog.hidden).toBe(false);
        expect(dialog.querySelectorAll(".mg-pmenu__list > li > a").length).toBeGreaterThanOrEqual(4);
        await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
        expect(dialog.hidden).toBe(true);
        await act(async () => root.unmount());
      });
    }
  }

  it("the menu box is the shared fixed, inset-0 layer above every design's grain and grid", () => {
    expect(css(SHARED_STYLESHEET)).toMatch(/\.mg-pmenu \{ position: fixed; inset: 0; z-index: 90;/);
    for (const key of ["journal", "terra"]) expect(css(`/designs/${key}/1.css`)).toMatch(/\.mg-page::after \{[^}]*z-index: 70; pointer-events: none;/);
    // Grid's column lines sit under the page's content (never over a field or a picture), above its paper.
    expect(css("/designs/grid/1.css")).toMatch(/\.mg-page::before \{[^}]*z-index: 0; pointer-events: none;/);
    expect(css("/designs/grid/1.css")).toContain('[data-design="grid"] .mg-page > :is(.mg-main, .mg-foot) { position: relative; z-index: 1; }');
  });
});

/* ---------------- brand overrides ---------------- */

describe("#4453 6b a brand's own look reaches every new design", () => {
  const OWNER = { canvas: "#203040", ink_strong: "#fafafa", ink_body: "#f0f0f0", seed: "#348e5c" };
  for (const design of NEW) {
    it(`${design.key}: owner colours, owner fonts and heading case none are what the page's tokens carry, and the stylesheet reads only tokens`, () => {
      const artifact = galleryArtifact(design.key);
      artifact.tokens = resolveTokens(design.tokens, { colors: { canvas: OWNER.canvas, ink_strong: OWNER.ink_strong, ink_body: OWNER.ink_body, accent: { seed: OWNER.seed } }, heading_case: "none" });
      artifact.fonts = { ...artifact.fonts, display: { family: "Lora", source: "google", weights: [400, 700], italic: false }, body: { family: "Inter", source: "google", weights: [400, 600], italic: false } };
      artifact.font_assets = [];
      artifact.font_fallbacks = [];
      assertArtifactV2(artifact);
      const style = tokenStyleCss(artifact).toLowerCase();
      expect(style).toContain(`--c-canvas:${OWNER.canvas}`);
      expect(style).toContain(`--c-ink-strong:${OWNER.ink_strong}`);
      expect(style).toContain("--display-case:none");
      expect(style).toMatch(/--font-display:"lora"/);
      expect(style).toMatch(/--font-body:"inter"/);
      const map = css(`/designs/${design.key}/1.css`);
      const roles = /:root\[data-design="[a-z]+"\] \{([^}]*)\}/.exec(map)![1]!;
      for (const [, name, value] of roles.matchAll(/(--mg-(?:bg|bg-alt|surface|ink|heading|body|muted|accent|accent-ink|label|band|band-ink|band-label|btn|btn-ink|btn-hover|hero-ink)):\s*([^;]+);/g)) {
        expect(value, `${design.key} ${name}`).toMatch(/^var\(--c-/);
      }
      expect(render(artifact)).toContain("Wake up");
    });
  }
});

/* ---------------- I-SITES-NO-PUBLIC-EMPTY-STATE (milestone 3) ---------------- */

describe("#4453 6b an empty upcoming grid is left out of the public site on Journal, Grid and Terra (I-SITES-NO-PUBLIC-EMPTY-STATE)", async () => {
  const grid = { type: "offering_grid", kind: "trip", mode: "upcoming", heading: "Upcoming trips", empty_text: "New dates soon." };
  for (const design of NEW) {
    const artifact = galleryArtifact(design.key);
    // Only ended trips: every upcoming grid is empty.
    const live = await liveFor(artifact);
    const page = homePage(artifact)!;
    const publicCtx: SharedContext = { artifact, page, live, forms, analytics: { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id } };
    const previewCtx: SharedContext = { ...publicCtx, analytics: { ...publicCtx.analytics, publicationId: "preview-4453" } };
    it(`${design.key}: every offering_grid layout it offers renders nothing publicly, the owner's hint in a Draft preview`, () => {
      const map = MAPS[design.key as keyof typeof MAPS].offering_grid;
      expect(Object.keys(map)).toEqual([...design.variants.offering_grid]);
      for (const [variant, Layout] of Object.entries(map)) {
        const Component = Layout as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
        expect(renderToStaticMarkup(<Component block={{ ...grid, variant }} index={0} ctx={publicCtx} />), variant).toBe("");
        expect(renderToStaticMarkup(<Component block={{ ...grid, variant }} index={0} ctx={previewCtx} />), variant).toContain("New dates soon.");
      }
      expect(render(artifact, undefined, live)).not.toContain("Trips from the house");
    });
  }
});

/* ---------------- offering covers ---------------- */

describe("#4453 6b Journal's columns draw a trip's cover, and leave no plate for a trip without one", async () => {
  const artifact = galleryArtifact("journal");
  const offerings = [...galleryUpcomingTrips(NOW), ...w5EndedTrips()];
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering as never, NOW, "en"));
  const live: LiveOfferings = { source: "live", offerings: offerings as never, cards, now: NOW, filters: offeringFilters(undefined) };
  it("the Home's journal-columns grid: the covered trip's picture from the site's own /om route, the coverless one an empty (hidden) plate, both bookable on Mingla", () => {
    const html = render(artifact, undefined, live);
    const grid = html.slice(html.indexOf('class="mg-blk jr-offers'), html.indexOf("</section>", html.indexOf('class="mg-blk jr-offers')));
    expect(grid).toContain("Trips from the house");
    const articles = grid.split('<article class="jr-art"').slice(1);
    expect(articles).toHaveLength(2);
    expect(articles[0]).toContain("Island Week");
    expect(articles[0]).toMatch(/<div class="mg-ph"><img src="\/om\/[^"]+\/original" alt="" loading="lazy" decoding="async"\/><\/div>/);
    expect(articles[1]).toContain("Bay and Back");
    expect(articles[1]).toContain('<div class="mg-ph"></div>');
    for (const article of articles) expect(article).toMatch(/href="https:\/\/host\.usemingla\.com\/t\/fixture-brand\/fixture-upcoming-\d"/);
    expect(grid.match(/src="([^"]+)"/g)!.every((src) => src.startsWith('src="/'))).toBe(true);
    expect(structure(html)).toMatchSnapshot();
  });
});

/* ---------------- found on the production build ---------------- */

describe("#4453 6b production-build findings", () => {
  it("the centred header keeps its menu button on a phone (Nocturne's sat at 438-486 px on a 375 px screen with real fonts)", () => {
    const shared = css(SHARED_STYLESHEET);
    // #4453 milestone 5 — later phone blocks (the booking layouts) follow it; read the one holding the fix.
    const phone = shared.slice(shared.lastIndexOf("@media (max-width: 720px)", shared.lastIndexOf(".mg-hd--center .mg-hd__bar { display: flex;")));
    expect(phone).toContain("[data-design] .mg-hd--center .mg-hd__bar { display: flex; justify-content: space-between; gap: 10px; }");
    expect(phone).toContain("[data-design] .mg-hd--center .mg-mark { min-width: 0; flex: 0 1 auto; overflow: hidden; justify-self: auto; }");
    expect(phone).toContain("[data-design] .mg-hd--center .mg-hd__end { flex: none; }");
    // It is added after (and so wins over) the base centred grid in the same layer.
    expect(shared.lastIndexOf(".mg-hd--center .mg-hd__bar { display: flex;")).toBeGreaterThan(shared.indexOf(".mg-hd--center .mg-hd__bar { display: grid;"));
  });

  it("Journal's masthead gives the hidden menu row back below 1100 px, and a long name never covers the controls", () => {
    const journal = css("/designs/journal/1.css");
    const narrow = journal.slice(journal.indexOf("@media (max-width: 1099px)"));
    expect(narrow).toContain('[data-design="journal"] .mg-hd--journal-mast .mg-nav { display: none; }');
    expect(narrow).toMatch(/\.mg-hd--journal-mast \.mg-mark \{[^}]*min-width: 0; overflow: hidden;/);
  });

  it("an offering with no cover leaves no empty plate in Journal's columns", () => {
    expect(css("/designs/journal/1.css")).toContain('[data-design="journal"] .jr-art .mg-ph:empty { display: none; }');
  });
});
