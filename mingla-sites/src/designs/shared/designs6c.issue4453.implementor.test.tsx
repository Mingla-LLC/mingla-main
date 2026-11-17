// @vitest-environment jsdom
/*
 * #4453 PR 6c (designs: Pop, Sunset, Pulse) — the implementor's regression suite.
 *
 * MINGLA-INVARIANT: I-SITES-DESIGN-KEYS-ONE-LIST | issue #4453 | DESIGN_KEYS == renderers == stylesheets == Studio design enum == Core brand_site_design_keys() (6c adds pop, sunset, pulse: the list is complete).
 * MINGLA-INVARIANT: I-SITES-DEFAULTS-AA | issue #4453 | every gallery design's default text pairs pass WCAG AA (4.5:1 small, 3:1 large) on every surface it draws (6c: Pop, Sunset, Pulse; their bands are covered by I-SITES-BAND-INK in rework6a).
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
  ARI_DESIGN_KEYS, DESIGN_KEYS, DESIGNS, HEADER_VARIANTS, POP, PULSE, SHARED_LAYOUTS, SUNSET,
  compositionVariant, type DesignDefinition, type HeaderVariant,
} from "../../contracts/generated/designs.ts";
import { FONT_AXES, MAX_FONT_ASSETS, type FontAxes } from "../../contracts/generated/fontSlots.ts";
import { resolveTokens } from "../../contracts/generated/tokens.ts";
import { ariVariants } from "../../contracts/generated/ariToolSchemas.ts";
import { w5EndedTrips } from "../../contracts/w5Content.fixture";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { homePage, sitePages, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import { preloadDigests } from "../../components/v2/FontFaces";
import { tokenStyleCss } from "../../components/v2/TokenStyle";
import { DESIGN_RENDERERS, SHARED_STYLESHEET } from "../registry";
import { POP_BLOCK_VARIANTS } from "../pop/PopPage";
import { SUNSET_BLOCK_VARIANTS } from "../sunset/SunsetPage";
import { PULSE_BLOCK_VARIANTS } from "../pulse/PulsePage";
import { POP_SIGNATURE_BLOCKS } from "../pop/blocks/PopBlocks";
import { SUNSET_SIGNATURE_BLOCKS } from "../sunset/blocks/SunsetBlocks";
import { PULSE_SIGNATURE_BLOCKS } from "../pulse/blocks/PulseBlocks";
import { motionAttributes } from "./library";
import { galleryArtifact } from "./galleryDesigns.fixture";
import type { SharedContext } from "./parts";
import { MAX_ANIMATING_AT_ONCE, startMotion } from "./motion";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
// A cover's /om token is signed with the runtime key (test value only).
vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 7).toString("base64"), videoCdnHosts: [] }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = path.resolve(process.cwd(), "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const css = (file: string) => fs.readFileSync(path.join(process.cwd(), "public", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
const NEW: readonly DesignDefinition[] = [POP, SUNSET, PULSE];
const MAPS = { pop: POP_BLOCK_VARIANTS, sunset: SUNSET_BLOCK_VARIANTS, pulse: PULSE_BLOCK_VARIANTS } as const;
const SIGNATURES = { pop: POP_SIGNATURE_BLOCKS, sunset: SUNSET_SIGNATURE_BLOCKS, pulse: PULSE_SIGNATURE_BLOCKS } as const;

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

describe("#4453 6c SC-D1 pop, sunset and pulse are design keys everywhere", () => {
  it("DESIGN_KEYS lists all eleven (Atelier and the ten gallery designs), each new one with a renderer, the shared stylesheet and its own stylesheet", () => {
    expect(DESIGN_KEYS).toEqual(["atelier", "voyage", "nocturne", "haven", "maison", "journal", "grid", "terra", "pop", "sunset", "pulse"]);
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
    // 6c adds no header: each new design's headers are shared ones.
    for (const design of NEW) for (const header of design.chrome.header) expect(["glass", "center", "pill"]).toContain(header);
  });

  it("Core: the 6c migration replaces only brand_site_design_keys() with every key, after 6b", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const sql = read("supabase/migrations/20280727104453_issue_4453_design_keys_6c.sql");
    expect(sql).toContain("SELECT ARRAY['atelier','voyage','nocturne','haven','maison','journal','grid','terra','pop','sunset','pulse']::text[]");
    expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(sql).not.toMatch(/ALTER TABLE|DROP |INSERT |UPDATE |DELETE /);
    const prefixes = fs.readdirSync(dir).filter((file) => /^\d{14}_/.test(file)).map((file) => file.slice(0, 14)).sort();
    expect(prefixes.filter((prefix) => prefix > "20280725104453")).toContain("20280727104453");
    expect(read("supabase/migrations/__tests__/issue_4453_design_keys.fixture.sql")).toContain("ARRAY['atelier','voyage','nocturne','haven','maison','journal','grid','terra','pop','sunset','pulse']");
  });

  it("Ari's declared designs stay atelier and voyage until PR 7 (#3355 frozen declarations)", () => {
    expect(ARI_DESIGN_KEYS).toEqual(["atelier", "voyage"]);
    for (const layout of ["pop-stack", "sunset-sun", "pulse-stage"]) expect(ariVariants("hero")).not.toContain(layout);
    expect(read("supabase/functions/_shared/agentSiteTools.ts")).toContain("enum: [...ARI_DESIGN_KEYS]");
  });
});

/* ---------------- §3.3 layouts ---------------- */

describe("#4453 6c §3.3 each design draws exactly the layouts it offers", () => {
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
    expect(row(POP)).toEqual(["pop-stack", "cards", "tiles", "mosaic", "ledger-count", "rail", "photo", "pill", "giant", "bold"]);
    expect(row(SUNSET)).toEqual(["sunset-sun", "cards", "tiles", "mosaic", "ledger-count", "wall", "photo", "pill", "giant", "calm"]);
    expect(row(PULSE)).toEqual(["pulse-stage", "poster", "numbered", "pinned", "split", "rail", "photo", "glass", "giant", "bold"]);
    expect([POP, SUNSET, PULSE].map((d) => d.label)).toEqual(["Pop", "Sunset", "Pulse"]);
    expect(PULSE.tokens.heading_case).toBe("uppercase");
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

describe("#4453 6c §3.3 every signature layout draws every field its block defines", async () => {
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

describe("#4453 6c SC-D2 each design's Home validates and renders on fixture data", async () => {
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
    const wrong = galleryArtifact("pulse");
    (homePage(wrong)!.blocks[0] as unknown as { variant: string }).variant = "sunset-sun";
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
  pop: { label: 700, button: "canvas", italic: ["highlight", 600] },
  sunset: { label: 700, button: "surface", italic: ["highlight", 600] },
  pulse: { label: 0, button: "accent_ink", italic: ["highlight", 200] },
} as const;

describe("#4453 6c SC-D3 I-SITES-DEFAULTS-AA every role each design draws passes AA", () => {
  for (const design of NEW) {
    const c = design.tokens.colors;
    const roles = ROLES[design.key as keyof typeof ROLES];
    // Pulse labels are the cyan on-dark highlight; the light designs use an accent step.
    const label = design.key === "pulse" ? c.highlight_on_dark : c.accent.ramp[roles.label as 700]!;
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
      const [, step] = roles.italic as readonly [string, number];
      const ramp = c.highlight.ramp as Record<number, string>;
      // Pop sets its accent words in ink ON the lime highlighter; the others draw the colour on the page.
      if (design.key === "pop") expect(contrast(c.ink_strong, ramp[step]!)).toBeGreaterThanOrEqual(4.5);
      else expect(contrast(ramp[step]!, c.canvas)).toBeGreaterThanOrEqual(3);
    });
  }

  it("pop: ink on every sticker colour (tiles, labels on bands, footer) passes AA", () => {
    const c = POP.tokens.colors;
    for (const bg of [c.paper.ramp[400], c.highlight.ramp[200], c.highlight.ramp[600], c.paper.ramp[200], c.highlight.ramp[700], c.surface_sunken, c.paper.ramp[50]]) {
      expect(contrast(c.ink_strong, bg), bg).toBeGreaterThanOrEqual(4.5);
    }
    // The band label sticker: grape on lime.
    expect(contrast(c.surface_deep, c.highlight_on_dark)).toBeGreaterThanOrEqual(4.5);
    // A hovered button turns tangerine with grape ink (the cream ink would fail).
    expect(contrast(c.canvas, c.accent.ramp[400])).toBeLessThan(4.5);
    expect(contrast(c.accent_ink, c.accent.ramp[400])).toBeGreaterThanOrEqual(4.5);
    expect(css("/designs/pop/1.css")).toContain('[data-design="pop"] .mg-page .mg-btn:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--c-ink-strong); color: var(--c-accent-ink); }');
  });

  it("sunset: ink on its warm tiles and the mustard ticker; cream on the tomato button and the burnt accent", () => {
    const c = SUNSET.tokens.colors;
    for (const bg of [c.paper.ramp[100], c.paper.ramp[200], c.paper.ramp[400], c.highlight.ramp[200]]) expect(contrast(c.ink_strong, bg), bg).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.surface, c.action)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.surface, c.ink_strong)).toBeGreaterThanOrEqual(4.5);
  });

  it("pulse: the near-black ink passes on every stop of the neon gradient and on the white hover; the pink headline line passes over the scrim", () => {
    const c = PULSE.tokens.colors;
    for (const stop of [c.accent.ramp[400], c.highlight.ramp[600], c.highlight_on_dark, c.action]) expect(contrast(c.accent_ink, stop), stop).toBeGreaterThanOrEqual(4.5);
    // On the stage the last headline line is the cyan (the pink fails over a light photo's scrim zone); on the page it is the pink.
    const scrimZone = over(rgbHex(c.scrim_rgb), 0.7, "#ffffff");
    expect(contrast(c.highlight.ramp[200], scrimZone)).toBeLessThan(3);
    expect(contrast(c.highlight_on_dark, scrimZone)).toBeGreaterThanOrEqual(3);
    expect(css("/designs/pulse/1.css")).toContain('[data-design="pulse"] .mg-page .mg-on-photo .mg-h1 .mg-ln:last-child > span { color: var(--c-highlight-on-dark); }');
    // The gradient is built from those three tokens only.
    expect(css("/designs/pulse/1.css")).toContain("--pl-grad: linear-gradient(100deg, var(--c-accent-400) 0%, var(--c-highlight-600) 48%, var(--c-highlight-on-dark) 100%);");
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

describe("#4453 6c SC-D4 reduced motion, motion: none and Save-Data animate nothing", () => {
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

    it(`${design.key}: every animation runs only with motion on and no reduced-motion preference, on transform / opacity / clip-path; nothing is sticky`, () => {
      const sheet = css(`/designs/${design.key}/1.css`);
      for (const rule of sheet.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(?!none)[^;}]+/g)) {
        expect(rule[1], rule[0]).toContain('[data-motion="on"]');
        expect(sheet.slice(0, rule.index).lastIndexOf("@media (prefers-reduced-motion: no-preference)"), rule[0]).toBeGreaterThan(-1);
      }
      for (const frames of sheet.matchAll(/@keyframes [\w-]+ \{([\s\S]*?\})\s*\}/g)) {
        for (const prop of [...frames[1]!.matchAll(/([a-z-]+):/g)].map((m) => m[1])) expect(["transform", "opacity", "clip-path"]).toContain(prop);
      }
      expect(sheet).not.toMatch(/view-timeline-name/);
      // The pinned-section budget is the shared gallery's (Pulse's pinned gallery is the shared one).
      const sticky = [...sheet.matchAll(/([^{}]+)\{[^{}]*position:\s*sticky/g)].map((m) => m[1]!.trim());
      expect(sticky).toEqual([]);
    });
  }

  it("every endless animation in the three stylesheets is the hero's held motion (Pulse's two orbs, Sunset's rays) or the shared ticker; Pop has none", () => {
    const endless = (key: string) => [...css(`/designs/${key}/1.css`).matchAll(/([^{}]+)\{[^{}]*\banimation:[^;}]*\binfinite\b/g)].map((m) => m[1]!.trim());
    expect(endless("pop")).toEqual([]);
    expect(endless("sunset")).toEqual(['[data-design="sunset"] .mg-scope[data-motion="on"] .ss-rays']);
    expect(endless("pulse")).toEqual(['[data-design="pulse"] .mg-scope[data-motion="on"] .pl-orb--1', '[data-design="pulse"] .mg-scope[data-motion="on"] .pl-orb--2']);
    // Each of those elements carries data-mg-hold in the hero's markup, so the motion module counts it.
    expect(render(galleryArtifact("sunset"))).toMatch(/<span class="ss-rays" aria-hidden="true" data-mg-hold=""><\/span>/);
    const pulse = render(galleryArtifact("pulse"));
    expect(pulse.match(/class="pl-orb pl-orb--[12]" aria-hidden="true" data-mg-hold=""/g)).toHaveLength(2);
    // Pulse's glow is static (box-shadow/filter never animate); its orbs move by transform only.
    expect(css("/designs/pulse/1.css")).not.toMatch(/@keyframes[^{]*\{[^}]*(filter|box-shadow|opacity)/);
    for (const design of NEW) {
      const html = render(galleryArtifact(design.key));
      const hero = html.slice(html.indexOf("data-mg-hero"), html.indexOf("</section>", html.indexOf("data-mg-hero")));
      const movers = (hero.match(/class="mg-ln"|data-mg-hero-bg=""|data-mg-hold=""/g) ?? []).length;
      expect(movers, design.key).toBeGreaterThan(0);
      expect(movers, design.key).toBeLessThanOrEqual(MAX_ANIMATING_AT_ONCE);
    }
  });

  it("the 12-at-once cap: a held endless mover keeps its slot for as long as it moves, the hero's finite entrance frees its slots when it ends", async () => {
    vi.useFakeTimers();
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    let cb: IntersectionObserverCallback = () => {};
    const observed: Element[] = [];
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(c: IntersectionObserverCallback) { cb = c; }
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    };
    const hero = `<section data-mg-hero=""><div data-mg-hero-bg=""></div><span class="orb" data-mg-hold=""></span><span class="orb" data-mg-hold=""></span><h1 class="mg-h1"><span class="mg-ln"><span>One</span></span><span class="mg-ln"><span>Two</span></span></h1></section>`;
    document.body.innerHTML = `<div id="s" class="mg-scope" data-motion="on">${hero}${Array.from({ length: 30 }, (_, i) => `<p data-mg-rise="">${i}</p>`).join("")}</div>`;
    const endless = { effect: { getComputedTiming: () => ({ endTime: Infinity }) }, finished: new Promise(() => {}) };
    const entrance = { effect: { getComputedTiming: () => ({ endTime: 1200 }) }, finished: Promise.resolve() };
    document.querySelectorAll<HTMLElement>("[data-mg-hold]").forEach((el) => { (el as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [endless]; });
    document.querySelectorAll<HTMLElement>(".mg-ln > span, [data-mg-hero-bg]").forEach((el) => { (el as unknown as { getAnimations: () => unknown[] }).getAnimations = () => [entrance]; });
    startMotion(document.getElementById("s")!);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const fire = (els: Element[]) => cb(els.map((target) => ({ isIntersecting: true, target })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    fire(observed.slice(0, 15));
    // The entrance (two lines and the picture) has ended; the two orbs still hold their slots.
    expect(observed.slice(0, 15).filter((el) => !el.hasAttribute("data-mg-instant")).length + 2).toBe(MAX_ANIMATING_AT_ONCE);
    vi.advanceTimersByTime(60_000);
    fire(observed.slice(15, 30));
    expect(observed.slice(15, 30).filter((el) => !el.hasAttribute("data-mg-instant")).length + 2).toBe(MAX_ANIMATING_AT_ONCE);
    vi.useRealTimers();
  });
});

/* ---------------- SC-D5 fonts and origins ---------------- */

describe("#4453 6c SC-D5 font budget, variable axes and no off-origin requests", () => {
  /*
   * Every latin woff2 file a gallery design's page can load, measured
   * 2026-11-16 by running the publish pipeline itself (resolveSiteFonts
   * against Google's css2 API, with each design's axes). Variable families
   * are one file per style (all weights); Space Mono is static (one file per
   * weight). `firstView` are the display and body files (§3.6). The other
   * gallery designs are pinned by the 6a and 6b suites.
   */
  const BUDGET: Readonly<Record<string, { files: Readonly<Record<string, number>>; firstView: readonly string[] }>> = {
    // Pop's Fraunces is the accent face only (italic words, no opsz: inside the 180 KB page total).
    pop: { files: { "Unbounded/normal": 50_892, "Figtree/normal": 20_184, "Fraunces/normal": 36_560, "Fraunces/italic": 45_624 }, firstView: ["Unbounded/normal", "Figtree/normal"] },
    // Sunset's Fraunces carries opsz with its soft instance pinned (SOFT 100); Shrikhand is static.
    sunset: { files: { "Fraunces/normal": 62_200, "Nunito/normal": 39_152, "Shrikhand/normal": 15_736 }, firstView: ["Fraunces/normal", "Nunito/normal"] },
    // Space Mono is static (one file per weight).
    pulse: { files: { "Unbounded/normal": 50_892, "Space Grotesk/normal": 23_472, "Space Mono/400": 9_464, "Space Mono/700": 9_552 }, firstView: ["Unbounded/normal", "Space Grotesk/normal"] },
  };
  const filesOf = (design: DesignDefinition): Set<string> => new Set([design.fonts.display, design.fonts.body, design.fonts.accent, design.fonts.label ?? null]
    .filter((slot) => slot !== null && slot.source === "google")
    .flatMap((slot) => (["IBM Plex Mono", "Space Mono"].includes(slot!.family) ? slot!.weights.map((w) => `${slot!.family}/${w}`) : [`${slot!.family}/normal`, ...(slot!.italic ? [`${slot!.family}/italic`] : [])])));
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
    // Sunset: optical size with its soft instance pinned (the gallery sets SOFT 100 on the whole page).
    expect(SUNSET.fonts.display.axes).toEqual({ opsz: [9, 144], SOFT: [100, 100] });
    expect(POP.fonts.accent!.axes).toBeUndefined();
    expect([PULSE.fonts.display.axes, PULSE.fonts.body.axes, PULSE.fonts.label?.axes]).toEqual([undefined, undefined, undefined]);
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

});

/* ---------------- phone menu ---------------- */

describe("#4453 6c the phone menu covers the viewport in every header each design offers", () => {
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

  it("the menu box is the shared fixed, inset-0 layer above Sunset's grain", () => {
    expect(css(SHARED_STYLESHEET)).toMatch(/\.mg-pmenu \{ position: fixed; inset: 0; z-index: 90;/);
    expect(css("/designs/sunset/1.css")).toMatch(/\.mg-page::after \{[^}]*z-index: 70; pointer-events: none;/);
  });
});

/* ---------------- brand overrides ---------------- */

describe("#4453 6c a brand's own look reaches every new design", () => {
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
        // Pulse's buttons are its neon gradient, itself built from tokens only.
        expect(value, `${design.key} ${name}`).toMatch(design.key === "pulse" ? /^var\(--(c-|pl-grad\))/ : /^var\(--c-/);
      }
      expect(render(artifact)).toContain("Wake up");
    });
  }
});

/* ---------------- I-SITES-NO-PUBLIC-EMPTY-STATE (milestone 3) ---------------- */

describe("#4453 6c an empty upcoming grid is left out of the public site on Pop, Sunset and Pulse (I-SITES-NO-PUBLIC-EMPTY-STATE)", async () => {
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

/* ---------------- found on the production build ---------------- */

describe("#4453 6c production-build findings", () => {
  it("each new design keeps its call to action and menu button on a 375 px phone (Pop's menu button sat at 406-454 px with real fonts)", () => {
    for (const design of NEW) {
      const sheet = css(`/designs/${design.key}/1.css`);
      const phone = sheet.slice(sheet.lastIndexOf("@media (max-width: 720px)"));
      expect(phone, design.key).toContain(`[data-design="${design.key}"] .mg-page .mg-hd .mg-mark { min-width: 0; flex: 0 1 auto; overflow: hidden; font-size: 16px; }`);
      expect(phone, design.key).toContain(`[data-design="${design.key}"] .mg-page .mg-hd__end { flex: none; }`);
    }
  });

  it("Pop's hero highlighter is the tangerine (grape ink on it), lime elsewhere", () => {
    expect(css("/designs/pop/1.css")).toContain('[data-design="pop"] .pp-hero .mg-h1 .mg-ln:last-child > span { background: var(--c-accent-400); color: var(--c-accent-ink); }');
    expect(contrast(POP.tokens.colors.accent_ink, POP.tokens.colors.accent.ramp[400])).toBeGreaterThanOrEqual(4.5);
  });

  it("Pop's tilted stickers and ticker tape can never widen the page: the page clips sideways overflow", () => {
    expect(css(SHARED_STYLESHEET)).toMatch(/\[data-design\] \.mg-page \{[^}]*overflow-x: clip;/);
  });
});
