// @vitest-environment jsdom
/*
 * #4453 6a rework after the tester's FAIL (comment 6932025288).
 *
 * MINGLA-INVARIANT: I-SITES-BAND-INK | issue #4453 | text on a design's dark band (newsletter photo band, band callouts) is drawn in the band's own roles; every band role resolved from the REAL stylesheets and the design's default tokens passes AA (headings 3:1, text 4.5:1) for every design that draws the shared library.
 *
 * - P1-1: resolves each design's stylesheet role map (--mg-* → --c-* → hex, color-mix included) and
 *   checks every colour the shared stylesheet draws on a band against that band, plus the band heading
 *   rule winning the cascade (it sits in a later layer than the base heading colour).
 * - P1-2: the form layer (trap, screen-reader labels, fields, buttons, newsletter row, consent bar) is
 *   in the shared stylesheet; hiding applies to every design, the chrome only to gallery pages.
 * - P2-1: Nocturne and Maison headings follow the owner's heading case.
 * - P2-2: the hero's CSS entrance counts against the 12-at-once motion cap.
 * - P3-1: a serif face with no published metric fallback falls back to a serif generic.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DESIGNS, type DesignKey } from "../../contracts/generated/designs.ts";
import { resolveTokens, tokenCssDeclarations } from "../../contracts/generated/tokens.ts";
import { tokenStyleCss } from "../../components/v2/TokenStyle";
import { galleryArtifact } from "./galleryDesigns.fixture";
import { sitePages } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import { MAX_ANIMATING_AT_ONCE, startMotion } from "./motion";

const pub = (file: string) => fs.readFileSync(path.join(process.cwd(), "public/designs", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SHARED = pub("_shared/blocks-1.css");
/** Every design that links the shared library (atelier draws its own markup only). */
const KEYS: readonly DesignKey[] = ["voyage", "nocturne", "haven", "maison"];

/* ---------------- colour resolution from the real stylesheets ---------------- */

const hexRgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const rgbHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
function luminance(hex: string): number {
  const c = hexRgb(hex).map((v) => v / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** A design's custom properties: its default tokens (as the runtime emits them) and its stylesheet's root map. */
function properties(key: DesignKey): Map<string, string> {
  const props = new Map<string, string>();
  for (const declaration of tokenCssDeclarations(resolveTokens(DESIGNS[key].tokens, {}))) {
    const at = declaration.indexOf(":");
    props.set(declaration.slice(0, at), declaration.slice(at + 1));
  }
  const sheet = pub(`${key}/1.css`);
  const root = new RegExp(`:root\\[data-design="${key}"\\] \\{([^}]*)\\}`, "g");
  for (const block of sheet.matchAll(root)) {
    for (const m of block[1]!.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) props.set(m[1]!, m[2]!.trim());
  }
  return props;
}

/** Resolves a colour expression (a hex, var(--x), or color-mix(in srgb, A p%, B)) over `under` for transparency. */
function resolve(value: string, props: Map<string, string>, under: string, depth = 0): string {
  if (depth > 8) throw new Error(`unresolvable ${value}`);
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const ref = /^var\((--[a-z0-9-]+)(?:,\s*(.+))?\)$/.exec(v);
  if (ref) {
    const next = props.get(ref[1]!) ?? ref[2];
    if (!next) throw new Error(`unmapped ${ref[1]}`);
    return resolve(next, props, under, depth + 1);
  }
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+(\d+(?:\.\d+)?)%,\s*(.+)\)$/.exec(v);
  if (mix) {
    const a = hexRgb(resolve(mix[1]!, props, under, depth + 1));
    const b = mix[3]!.trim() === "transparent" ? hexRgb(under) : hexRgb(resolve(mix[3]!, props, under, depth + 1));
    const p = Number(mix[2]) / 100;
    return rgbHex(a.map((x, i) => x * p + b[i]! * (1 - p)));
  }
  throw new Error(`unsupported colour ${v}`);
}

/** Every `color:` the shared stylesheet draws inside a band (a selector naming .mg-band or .mg-nl-photo). */
function bandColours(): Array<{ selector: string; value: string; large: boolean }> {
  const out: Array<{ selector: string; value: string; large: boolean }> = [];
  for (const rule of SHARED.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1]!.trim();
    if (!/\.mg-band\b|\.mg-nl-photo\b/.test(selector) || /\.mg-on-photo|\.btn|\.mg-btn/.test(selector)) continue;
    // The base layer's whole-library defaults (`:is(.mg-blk, …, .mg-nl-photo, …)`) are overridden for
    // bands by the band rules themselves (pinned below); `inherit` takes the band's own ink.
    if (/:is\(\.mg-blk/.test(selector)) continue;
    const colour = /(?:^|;)\s*color:\s*([^;]+)/.exec(rule[2]!);
    if (colour && colour[1]!.trim() !== "inherit") out.push({ selector, value: colour[1]!.trim(), large: /\b(h1|h2|h3)\b/.test(selector) });
  }
  return out;
}

describe("#4453 6a P1-1 I-SITES-BAND-INK every band role passes on the band, resolved from the real stylesheets", () => {
  const rules = bandColours();
  it("the shared stylesheet draws band headings in the band ink, in a layer after the base heading colour", () => {
    expect(SHARED).toMatch(/\[data-design\] :is\(\.mg-band, \.mg-nl-photo\) :is\(h1, h2, h3\) \{ color: var\(--mg-band-ink\); \}/);
    // The base heading colour is in mg-base; the band rule is in a later mg-blocks block, so it wins.
    const base = SHARED.indexOf("@layer mg-base {");
    const band = SHARED.indexOf(":is(.mg-band, .mg-nl-photo) :is(h1, h2, h3)");
    expect(base).toBeGreaterThan(-1);
    expect(SHARED.lastIndexOf("@layer mg-blocks {", band)).toBeGreaterThan(base);
    // The band itself sets the band ink after (and as specific as) the base layer's body colour.
    expect(SHARED).toMatch(/\[data-design\] \.mg-nl-photo \{[^}]*color: var\(--mg-band-ink\)/);
    expect(SHARED).toMatch(/\[data-design\] \.mg-band \{[^}]*color: var\(--mg-band-ink\)/);
    expect(rules.length).toBeGreaterThanOrEqual(4);
  });
  for (const key of KEYS) {
    const props = properties(key);
    const band = resolve("var(--mg-band)", props, "#000000");
    for (const rule of rules) {
      it(`${key}: ${rule.selector} (${rule.value}) on the band`, () => {
        const ink = resolve(rule.value, props, band);
        expect(contrast(ink, band), `${ink} on ${band}`).toBeGreaterThanOrEqual(rule.large ? 3 : 4.5);
      });
    }
    it(`${key}: the page heading ink is NOT a band colour (why a band heading needs its own rule)`, () => {
      const heading = resolve("var(--mg-heading)", props, band);
      if (key === "haven" || key === "maison" || key === "voyage") expect(contrast(heading, band)).toBeLessThan(3);
      expect(contrast(resolve("var(--mg-band-ink)", props, band), band)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("#4453 6a P1-2 the shared form layer", () => {
  it("hides the spam trap (both markups) off-screen, invisible, for every design that links the sheet", () => {
    const rule = /\[data-design\] :is\(\.form-trap, \.site-form-trap\) \{([^}]*)\}/.exec(SHARED);
    expect(rule).not.toBeNull();
    for (const part of ["position: absolute", "left: -10000px", "clip-path: inset(50%)", "visibility: hidden", "width: 1px", "height: 1px"]) expect(rule![1]).toContain(part);
  });
  it("styles fields, buttons, the newsletter row, the status line and the consent bar on gallery pages only", () => {
    for (const piece of [".field", ".site-form-submit", ".v-newsletter__form", ".v-form-status", ".consent button", ".consent-link"]) {
      const lines = SHARED.split("\n").filter((line) => line.includes(piece) && line.includes("{"));
      expect(lines.length, piece).toBeGreaterThan(0);
      for (const line of lines) expect(line, piece).toContain(".mg-page:not(.v-page)");
    }
  });
  it("draws form chrome from shared roles only (no colour literal anywhere in the sheet)", () => {
    expect(SHARED.match(/#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|(?<![-\w])(?:white|black)(?![-\w])/gi) ?? []).toEqual([]);
  });
});

describe("#4453 6a contact form posts the page it is on (found on the production build)", () => {
  it("the gallery contact form's hidden `page` is the page's path (\"contact-us\"), never its href (the route refuses \"/contact-us\")", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ContactFormBasic } = await import("./blocks/Basics");
    const artifact = galleryArtifact("haven");
    const page = sitePages(artifact).find((candidate) => candidate.blocks.some((block) => String(block.type) === "contact_form"))!;
    const index = page.blocks.findIndex((block) => String(block.type) === "contact_form");
    const forms = { renderedAt: 1, signature: "s", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;
    const html = renderToStaticMarkup(<ContactFormBasic block={page.blocks[index] as never} index={index} ctx={{ artifact, page, forms, analytics: { siteId: "", brandId: "", publicationId: "" } }} />);
    expect(html).toContain(`name="page" value="${page.path}"`);
    expect(page.path).not.toMatch(/^\//);
    expect(html).toContain(`name="block" value="${index}"`);
  });
});

describe("#4453 6a P2-1 headings follow the owner's heading case", () => {
  it("nocturne's section headings and maison's h3 read --display-case (design default kept as the fallback)", () => {
    expect(pub("nocturne/1.css")).toMatch(/:is\(h2, \.mg-phd__h\) \{[^}]*text-transform: var\(--display-case, uppercase\)/);
    expect(pub("maison/1.css")).toMatch(/h3 \{[^}]*text-transform: var\(--display-case, uppercase\)/);
    for (const key of ["nocturne", "haven", "maison"]) {
      for (const rule of pub(`${key}/1.css`).matchAll(/([^{}]*\b(?:h1|h2|h3)\b[^{}]*)\{([^}]*text-transform:\s*uppercase[^}]*)\}/g)) {
        throw new Error(`${key}: a heading rule forces uppercase: ${rule[1]!.trim()}`);
      }
    }
  });
});

describe("#4453 6a P2-2 the hero's entrance counts against the 12-at-once cap", () => {
  it("a hero with two lines and a settling picture leaves 9 slots for rises at load, then frees them", () => {
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
    const hero = `<section data-mg-hero=""><div data-mg-hero-bg=""></div><h1 class="mg-h1"><span class="mg-ln"><span>One</span></span><span class="mg-ln"><span>Two</span></span></h1></section>`;
    document.body.innerHTML = `<div id="s" class="mg-scope" data-motion="on">${hero}${Array.from({ length: 30 }, (_, i) => `<p data-mg-rise="">${i}</p>`).join("")}</div>`;
    startMotion(document.getElementById("s")!);
    const fire = (els: Element[]) => cb(els.map((target) => ({ isIntersecting: true, target })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    fire(observed.slice(0, 15));
    const moving = observed.slice(0, 15).filter((el) => !el.hasAttribute("data-mg-instant")).length;
    expect(moving + 3).toBe(MAX_ANIMATING_AT_ONCE);
    vi.advanceTimersByTime(6000);
    fire(observed.slice(15, 30));
    expect(observed.slice(15, 30).filter((el) => !el.hasAttribute("data-mg-instant")).length).toBe(MAX_ANIMATING_AT_ONCE);
    expect(observed.every((el) => el.hasAttribute("data-in"))).toBe(true);
    vi.useRealTimers();
  });
});

describe("#4453 6a P2-2 a rise never transitions OUT of view when motion switches on", () => {
  it("the hidden start state is applied without a transition (only entering animates)", () => {
    expect(SHARED).toContain('[data-design] .mg-scope[data-mg-motion="on"] [data-mg-rise]:not([data-in]) { transition: none; }');
    // It must come after the rule that gives every rise its transition (same layer, later and more specific).
    expect(SHARED.indexOf("[data-mg-rise]:not([data-in]) { transition: none; }")).toBeGreaterThan(SHARED.indexOf('[data-mg-motion="on"] [data-mg-rise] { transition:'));
  });
});

describe("#4453 6a P3 serif fallbacks and Nocturne's gold kicker", () => {
  it("a serif display face with no published metric fallback falls back to a serif generic", () => {
    for (const key of ["nocturne", "haven"] as const) {
      const artifact = galleryArtifact(key);
      artifact.font_fallbacks = [];
      const css = tokenStyleCss(artifact);
      expect(/--font-display:([^;]*)/.exec(css)![1], key).toMatch(/serif$/);
      expect(/--font-display:([^;]*)/.exec(css)![1], key).not.toMatch(/sans-serif$/);
    }
  });
  it("nocturne's hero kicker is the accent gold", () => {
    expect(pub("nocturne/1.css")).toContain('[data-design="nocturne"] .mg-page .mg-hero .mg-label { color: var(--c-accent-400); }');
  });
});
