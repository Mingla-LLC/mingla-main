// @vitest-environment jsdom
/*
 * #4453 PR 6a (designs: Nocturne, Haven, Maison) — the implementor's regression suite.
 *
 * MINGLA-INVARIANT: I-SITES-DESIGN-KEYS-ONE-LIST | issue #4453 | DESIGN_KEYS == renderers == stylesheets == Studio design enum == Core brand_site_design_keys() (6a adds nocturne, haven, maison).
 * MINGLA-INVARIANT: I-SITES-DEFAULTS-AA | issue #4453 | every gallery design's default text pairs pass WCAG AA (4.5:1 small, 3:1 large) on every surface it draws.
 *
 * - SC-D1 parity: the three keys have a renderer, a stylesheet, a Studio enum value (design and every
 *   layout, live and version tables) and a Core entry; Ari's declared designs stay atelier + voyage (#3355).
 * - §3.3: each design's renderer map is exactly its `variants`; its picks lead; every layout it can draw
 *   that is not already covered by the shared-library parity test (the neutral layouts and Maison's
 *   signature layouts) draws every field its block defines.
 * - SC-D2: a full Home validates and renders on fixture data; its structure snapshot is pinned.
 * - SC-D3: contrast for every role each design draws.
 * - SC-D4: reduced motion, `motion: none` and Save-Data animate nothing; signature motion is gated.
 * - SC-D5: font budget, catalogue faces, and no request off the site's origin.
 * - Phone menu: in each design's header the menu is portalled to <body> and covers the viewport.
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
  ARI_DESIGN_KEYS, DESIGN_KEYS, DESIGNS, HAVEN, MAISON, NOCTURNE, SHARED_LAYOUTS, compositionVariant, type DesignDefinition,
} from "../../contracts/generated/designs.ts";
import { ariVariants } from "../../contracts/generated/ariToolSchemas.ts";
import { W5, w5EndedTrips } from "../../contracts/w5Content.fixture";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { homePage, sitePages, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import { preloadDigests } from "../../components/v2/FontFaces";
import { DESIGN_RENDERERS, SHARED_STYLESHEET } from "../registry";
import { NOCTURNE_BLOCK_VARIANTS } from "../nocturne/NocturnePage";
import { HAVEN_BLOCK_VARIANTS } from "../haven/HavenPage";
import { MAISON_BLOCK_VARIANTS } from "../maison/MaisonPage";
import { MAISON_SIGNATURE_BLOCKS } from "../maison/blocks/MaisonBlocks";
import { NEUTRAL_LAYOUTS } from "./GalleryPage";
import { motionAttributes } from "./library";
import { galleryArtifact } from "./galleryDesigns.fixture";
import type { SharedContext } from "./parts";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(process.cwd(), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const css = (file: string) => fs.readFileSync(path.join(process.cwd(), "public", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
const NEW: readonly DesignDefinition[] = [NOCTURNE, HAVEN, MAISON];
const MAPS = { nocturne: NOCTURNE_BLOCK_VARIANTS, haven: HAVEN_BLOCK_VARIANTS, maison: MAISON_BLOCK_VARIANTS } as const;

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

/* ---------------- SC-D1 ---------------- */

describe("#4453 6a SC-D1 nocturne, haven and maison are design keys everywhere", () => {
  it("DESIGN_KEYS lists them after atelier and voyage, each with a renderer, the shared stylesheet and its own stylesheet", () => {
    // #4453 6b appended journal, grid and terra (designs6b pins the whole list).
    expect(DESIGN_KEYS.slice(0, 5)).toEqual(["atelier", "voyage", "nocturne", "haven", "maison"]);
    for (const design of NEW) {
      const renderer = DESIGN_RENDERERS[design.key];
      expect(renderer.sharedStylesheet).toBe(SHARED_STYLESHEET);
      expect(fs.existsSync(path.join(process.cwd(), "public", renderer.stylesheet(design.version)))).toBe(true);
    }
  });

  it("Studio's design enum (live and version) and every layout's enum (live and version) hold them", () => {
    for (const table of ["enum_site_settings_design", "enum__site_settings_v_version_design"]) {
      for (const design of NEW) expect(studioEnum(table).has(design.key), `${table} ${design.key}`).toBe(true);
    }
    for (const design of NEW) {
      for (const [type, variants] of Object.entries(design.variants)) {
        for (const table of [`enum_pages_blocks_${type}_variant`, `enum__pages_v_blocks_${type}_variant`]) {
          const values = studioEnum(table);
          for (const variant of variants) expect(values.has(variant), `${design.key} ${table} ${variant}`).toBe(true);
        }
      }
    }
  });

  it("Core: the 6a migration replaced only brand_site_design_keys() with the five keys (6b's replaces it again), and nothing is applied by hand", () => {
    const sql = read("supabase/migrations/20280724104453_issue_4453_design_keys_6a.sql");
    expect(sql).toContain("SELECT ARRAY['atelier','voyage','nocturne','haven','maison']::text[]");
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(sql).not.toMatch(/ALTER TABLE|DROP |INSERT |UPDATE |DELETE /);
  });

  it("Ari's declared designs stay atelier and voyage until PR 7 (#3355 frozen declarations)", () => {
    expect(ARI_DESIGN_KEYS).toEqual(["atelier", "voyage"]);
    // The any-design variant enum Ari sees is exactly what atelier and voyage offer Ari.
    expect(ariVariants("hero")).not.toContain("maison-frame");
    expect(ariVariants("cta")).not.toContain("neutral");
    const tools = read("supabase/functions/_shared/agentSiteTools.ts");
    expect(tools).toContain("enum: [...ARI_DESIGN_KEYS]");
  });
});

/* ---------------- §3.3 layouts ---------------- */

describe("#4453 6a §3.3 each design draws exactly the layouts it offers", () => {
  for (const design of NEW) {
    it(`${design.key}: renderer map == variants; gallery picks lead; chrome and motion from the gallery`, () => {
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

  it("the gallery maps: hero, offerings, cards, gallery, reviews and chrome per design", () => {
    const row = (d: DesignDefinition) => [d.variants.hero[0], d.variants.offering_grid[0], d.variants.feature_cards[0], d.variants.gallery[0], d.variants.testimonials[0], d.chrome.header[0], d.chrome.footer[0], d.motion.profile];
    expect(row(NOCTURNE)).toEqual(["editorial", "list", "numbered", "pinned", "wall", "center", "giant", "cinematic"]);
    expect(row(HAVEN)).toEqual(["arch", "cards", "tiles", "stagger", "switcher", "pill", "columns", "calm"]);
    expect(row(MAISON)).toEqual(["maison-frame", "maison-rows", "tiles", "maison-plates", "wall", "center", "giant", "calm"]);
    expect(HAVEN.variants.hero).toEqual(["arch", "fullbleed", "editorial"]);
    expect(HAVEN.variants.testimonials).toEqual(["switcher", "rail", "wall"]);
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
    block[key] = v;
  }
  if (type === "offering_grid") block.mode = "upcoming";
  return { block, expected };
}

describe("#4453 6a §3.3 the neutral and Maison layouts draw every field their block defines", async () => {
  const artifact = galleryArtifact("maison");
  const live = await liveFor(artifact);
  const page = homePage(artifact)!;
  const ctx: SharedContext = { artifact, page, live, forms, analytics: { siteId: artifact.site_id, brandId: artifact.brand_id, publicationId: artifact.publication_id } };
  // Fields drawn by the runtime's own components inside a neutral section (already pinned by their own suites).
  const RUNTIME_OWNED: Partial<Record<BlockType, readonly string[]>> = {
    story_grid: ["intro"],
    contact_form: ["name_placeholder", "email_placeholder", "message_label", "message_placeholder", "success_text"],
    menu_preview: [],
  };
  const layouts: Array<[BlockType, string, React.ComponentType<never>]> = [
    ...Object.entries(NEUTRAL_LAYOUTS).map(([type, Layout]) => [type as BlockType, "neutral", Layout as React.ComponentType<never>] as [BlockType, string, React.ComponentType<never>]),
    ...Object.entries(MAISON_SIGNATURE_BLOCKS).flatMap(([type, byVariant]) => Object.entries(byVariant).map(([variant, Layout]) => [type as BlockType, variant, Layout as React.ComponentType<never>] as [BlockType, string, React.ComponentType<never>])),
  ];
  for (const [type, variant, Layout] of layouts) {
    it(`${type}:${variant}`, () => {
      const { block, expected } = sentinelBlock(type, artifact);
      const skipped = new Set((RUNTIME_OWNED[type] ?? []).map((key) => block[key]).filter((v): v is string => typeof v === "string"));
      const Component = Layout as unknown as React.ComponentType<{ block: Record<string, unknown>; index: number; ctx: SharedContext }>;
      const html = renderToStaticMarkup(<Component block={{ ...block, variant }} index={0} ctx={ctx} />);
      const missing = expected.filter((v) => !skipped.has(v) && !html.includes(v.replaceAll("&", "&amp;")));
      expect(missing, `${type}:${variant} drops ${missing.join(", ")}`).toEqual([]);
      expect(html).not.toMatch(/mingla:\/\//);
    });
  }
});

/* ---------------- SC-D2 Home renders; structure snapshot ---------------- */

/** The tag/class tree of the page's main content (text and non-class attributes dropped). */
function structure(html: string): string {
  const start = html.indexOf('<main id="main"');
  const main = html.slice(start, html.indexOf("</main>", start) + 7);
  return [...main.matchAll(/<\/?([a-z0-9]+)(?:[^>]*?class="([^"]*)")?[^>]*>/g)].map((m) => `${m[0].startsWith("</") ? "/" : ""}${m[1]}${m[2] ? `.${m[2]}` : ""}`).join("\n");
}

describe("#4453 6a SC-D2 each design's Home validates and renders on fixture data", async () => {
  for (const design of NEW) {
    const artifact = galleryArtifact(design.key);
    const live = await liveFor(artifact);
    it(`${design.key}: validates, draws the shared chrome, one h1, and its structure is pinned (375 and 1440 share one markup)`, () => {
      assertArtifactV2(artifact);
      const { Page } = DESIGN_RENDERERS[design.key];
      const html = renderToStaticMarkup(<Page artifact={artifact} page={homePage(artifact) as ArtifactPage} live={live} forms={forms} nonce="n" notFound={false} />);
      expect(html).toContain(`mg-hd--${design.chrome.header[0]}`);
      expect(html).toContain(`mg-foot--${design.chrome.footer[0]}`);
      expect(html).toContain('data-mg-look="gallery"');
      expect((html.match(/<h1\b/g) ?? []).length).toBe(1);
      expect(html).toContain("Wake up");
      expect(structure(html)).toMatchSnapshot();
    });
  }

  it("every page of the fixture site renders on each design (about, contact, journal, places, trips, FAQ)", async () => {
    for (const design of NEW) {
      const artifact = galleryArtifact(design.key);
      const live = await liveFor(artifact);
      const { Page } = DESIGN_RENDERERS[design.key];
      const pages = sitePages(artifact);
      expect(pages.length).toBeGreaterThanOrEqual(6);
      for (const page of pages) {
        const html = renderToStaticMarkup(<Page artifact={artifact} page={page} live={live} forms={forms} nonce="n" notFound={false} />);
        expect(html, `${design.key} ${page.key}`).toContain('<main id="main"');
      }
    }
  });

  it("refuses a block layout a design does not offer", () => {
    const wrong = galleryArtifact("haven");
    (homePage(wrong)!.blocks[0] as unknown as { variant: string }).variant = "maison-frame";
    expect(() => assertArtifactV2(wrong)).toThrow();
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

/** Each design's label role on its own surfaces (the --mg-label each stylesheet maps). */
const LABEL_STEP = { nocturne: 400, haven: 700, maison: 700 } as const;

describe("#4453 6a SC-D3 I-SITES-DEFAULTS-AA every role each design draws passes AA", () => {
  for (const design of NEW) {
    const c = design.tokens.colors;
    const label = c.accent.ramp[LABEL_STEP[design.key as keyof typeof LABEL_STEP]]!;
    const surfaces: Array<[string, string]> = [["canvas", c.canvas], ["tinted band", c.surface_sunken], ["surface", c.surface]];
    // The darkest a photo's copy zone gets under a pure white picture: the scrim at 70% (blocks-1.css).
    const photoWorst = over(rgbHex(c.scrim_rgb), 0.7, "#ffffff");
    const small: Array<[string, string, string]> = [
      ...surfaces.flatMap(([name, bg]): Array<[string, string, string]> => [
        [`body on ${name}`, c.ink_body, bg], [`quiet on ${name}`, c.ink_quiet, bg], [`label on ${name}`, label, bg], [`headings on ${name}`, c.ink_strong, bg],
      ]),
      ["accent ink on accent fill", c.accent_ink, c.accent.ramp[400]!],
      ["button ink on action", design.key === "haven" ? c.surface : c.canvas, c.action],
      ["band ink on band", c.ink_on_dark_body, c.surface_deep], ["band label on band", c.highlight_on_dark, c.surface_deep],
      ["band muted on band", design.key === "nocturne" ? c.ink_quiet : over(c.ink_on_dark_body, 0.72, c.surface_deep), c.surface_deep],
      ["photo text on the scrim's copy zone", c.ink_on_photo_body, photoWorst],
      ["photo quiet on the scrim's copy zone", c.ink_on_photo_quiet, photoWorst],
    ];
    for (const [name, fg, bg] of small) it(`${design.key}: ${name} ≥ 4.5:1`, () => expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5));
    it(`${design.key}: the italic accent word (highlight 600) ≥ 3:1 where it is drawn large`, () => {
      const bg = design.key === "nocturne" ? c.canvas : c.canvas;
      expect(contrast(c.highlight.ramp[600]!, bg)).toBeGreaterThanOrEqual(3);
    });
  }

  it("haven carries the platform milestone's fixes, and the gallery's own values would fail", () => {
    const c = HAVEN.tokens.colors;
    expect([c.accent.ramp[700], c.accent.ramp[400], c.ink_quiet]).toEqual(["#955a2b", "#a16537", "#546c6b"]);
    expect(contrast("#a2622f", c.surface_sunken)).toBeLessThan(4.5);
    expect(contrast(c.accent_ink, "#b06e3c")).toBeLessThan(4.5);
    expect(contrast("#587170", c.surface_sunken)).toBeLessThan(4.5);
  });
});

/* ---------------- SC-D4 motion ---------------- */

describe("#4453 6a SC-D4 reduced motion, motion: none and Save-Data animate nothing", () => {
  for (const design of NEW) {
    it(`${design.key}: none and Save-Data draw data-motion=none; the page is complete at rest`, () => {
      expect(motionAttributes(design, "none")["data-motion"]).toBe("none");
      expect(motionAttributes(design, "design", true)["data-motion"]).toBe("none");
      const artifact = galleryArtifact(design.key);
      artifact.tokens.motion = "none";
      const { Page } = DESIGN_RENDERERS[design.key];
      const html = renderToStaticMarkup(<Page artifact={artifact} page={homePage(artifact) as ArtifactPage} forms={forms} nonce="n" notFound={false} />);
      expect(html).toContain('data-motion="none"');
      expect(html).not.toMatch(/\shidden=""[^>]*data-mg-rise|style="[^"]*opacity:\s*0/);
    });

    it(`${design.key}: every animation in its stylesheet runs only with motion on and no reduced-motion preference, on transform / opacity / clip-path`, () => {
      const sheet = css(`/designs/${design.key}/1.css`);
      for (const rule of sheet.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(?!none)[^;}]+/g)) {
        expect(rule[1], rule[0]).toContain('[data-motion="on"]');
        const before = sheet.slice(0, rule.index);
        expect(before.lastIndexOf("@media (prefers-reduced-motion: no-preference)"), rule[0]).toBeGreaterThan(-1);
      }
      for (const frames of sheet.matchAll(/@keyframes [\w-]+ \{([\s\S]*?\})\s*\}/g)) {
        for (const prop of [...frames[1]!.matchAll(/([a-z-]+):/g)].map((m) => m[1])) expect(["transform", "opacity", "clip-path"]).toContain(prop);
      }
      expect(sheet).not.toMatch(/view-timeline-name|position:\s*sticky/);
    });
  }
});

/* ---------------- SC-D5 fonts and origins ---------------- */

describe("#4453 6a SC-D5 font budget and no off-origin requests", () => {
  /*
   * Measured 2026-11-16 from Google's css2 API (the publish pipeline's own
   * source), latin subset, woff2, per style (all variable: one file per style).
   */
  const LATIN: Readonly<Record<string, { normal: number; italic?: number }>> = {
    "Bodoni Moda": { normal: 25_804, italic: 30_220 },
    // #4453 6b — Nocturne now fetches Archivo with its width axis (62–125%): one larger variable file.
    Archivo: { normal: 90_096 },
    Cormorant: { normal: 35_280, italic: 38_076 },
    Manrope: { normal: 24_436 },
    Italiana: { normal: 10_164 },
    Newsreader: { normal: 58_152, italic: 64_500 },
    Jost: { normal: 26_588 },
  };
  const catalogue = read("packages/site-contracts/src/googleFontsCatalog.ts");
  for (const design of NEW) {
    it(`${design.key}: ≤ 4 families, ≤ 8 latin files, display + body ≤ 180 KB, every face and weight in the catalogue`, () => {
      const slots = [design.fonts.display, design.fonts.body, design.fonts.accent, design.fonts.label ?? null].filter((slot) => slot !== null);
      const families = new Set(slots.map((slot) => slot!.family));
      expect(families.size).toBeLessThanOrEqual(4);
      const files = new Set(slots.flatMap((slot) => [`${slot!.family}/normal`, ...(slot!.italic ? [`${slot!.family}/italic`] : [])]));
      expect(files.size).toBeLessThanOrEqual(8);
      for (const file of files) {
        const [family, style] = file.split("/") as [string, "normal" | "italic"];
        expect(LATIN[family]?.[style], file).toBeTypeOf("number");
      }
      expect(LATIN[design.fonts.display.family]!.normal + LATIN[design.fonts.body.family]!.normal).toBeLessThanOrEqual(180 * 1024);
      for (const slot of slots) {
        const row = new RegExp(`\\["${slot!.family}","[a-z-]+",\\[([\\d,]*)\\],\\[([\\d,]*)\\]`).exec(catalogue);
        expect(row, slot!.family).not.toBeNull();
        const weights = row![1]!.split(",").map(Number);
        for (const weight of slot!.weights) expect(weights, `${slot!.family} ${weight}`).toContain(weight);
        if (slot!.italic) expect(row![2], `${slot!.family} italic`).not.toBe("");
      }
      expect(preloadDigests(galleryArtifact(design.key)).length).toBeLessThanOrEqual(2);
    });

    it(`${design.key}: the page and its stylesheets request nothing from another origin`, async () => {
      const artifact = galleryArtifact(design.key);
      const { Page } = DESIGN_RENDERERS[design.key];
      const html = renderToStaticMarkup(<Page artifact={artifact} page={homePage(artifact) as ArtifactPage} live={await liveFor(artifact)} forms={forms} nonce="n" notFound={false} />);
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

  it("the shared stylesheet's 6a additions name no colour and read only mapped roles", () => {
    const shared = css(SHARED_STYLESHEET);
    expect(shared.match(/#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d|(?<![-\w])(?:white|black)(?![-\w])/gi) ?? []).toEqual([]);
    const read = new Set([...shared.matchAll(/var\((--mg-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const own = new Set([...shared.matchAll(/(--mg-[a-z0-9-]+):/g)].map((m) => m[1]));
    for (const design of NEW) {
      const mapped = new Set([...css(`/designs/${design.key}/1.css`).matchAll(/(--mg-[a-z0-9-]+):/g)].map((m) => m[1]));
      expect([...read].filter((name) => !mapped.has(name) && !own.has(name)), design.key).toEqual([]);
    }
  });
});

/* ---------------- phone menu ---------------- */

describe("#4453 6a the phone menu covers the viewport in each design's header", () => {
  for (const design of NEW) {
    it(`${design.key} (${design.chrome.header[0]}): the dialog is portalled to <body>, lists every page, and closes on Escape`, async () => {
      document.body.innerHTML = "";
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      const artifact = galleryArtifact(design.key);
      const { Page } = DESIGN_RENDERERS[design.key];
      await act(async () => root.render(<Page artifact={artifact} page={homePage(artifact) as ArtifactPage} forms={forms} nonce="n" notFound={false} />));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      expect(host.querySelector(`.mg-hd--${design.chrome.header[0]}`)).not.toBeNull();
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

  it("the menu box is fixed, inset 0, above the header and above Nocturne's grain", () => {
    const shared = css(SHARED_STYLESHEET);
    expect(shared).toMatch(/\.mg-pmenu \{ position: fixed; inset: 0; z-index: 90;/);
    expect(css("/designs/nocturne/1.css")).toMatch(/\.mg-page::after \{[^}]*z-index: 70; pointer-events: none;/);
  });
});

void W5;
