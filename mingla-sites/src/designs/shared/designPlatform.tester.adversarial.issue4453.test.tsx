/*
 * #4453 PR 4 (design platform + Voyage) — the tester's adversarial suite.
 * Different angles from the implementor's suite:
 *
 * A. A brand's own colours survive the new Voyage defaults: an owner accent
 *    seed and action colour reach the page, the shared layouts read them only
 *    through voyage's --mg-* map, and nothing in the gallery look pins a
 *    Voyage default colour over them.
 * B. Motion is off by construction in CSS: every animation the shared
 *    stylesheet starts is either inside `prefers-reduced-motion:
 *    no-preference` or has both a reduced-motion and a `motion: none` stop,
 *    and nothing is hidden unless the motion module marked the page.
 * C. Header capacity has no hole: for every menu length the contract allows
 *    (1..MAX_NAV_ITEMS) and every header variant, each item is shown exactly
 *    once (inline or under "More") at 1100–1279 px and at ≥ 1280 px, and the
 *    phone menu (< 1100 px, e.g. 1024) lists Home plus every item, numbered.
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HEADER_INLINE_CAPACITY, HEADER_VARIANTS, VOYAGE } from "../../contracts/generated/designs.ts";
import { MAX_NAV_ITEMS } from "../../contracts/generated/limits.ts";
import { generateRamp } from "../../contracts/generated/colorRamp.ts";
import { resolveTokens } from "../../contracts/generated/tokens.ts";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { tokenStyleCss } from "../../components/v2/TokenStyle";
import { SHARED_STYLESHEET } from "../registry";
import { SharedHeader } from "./chrome/SharedChrome";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));

const css = (file: string) => fs.readFileSync(path.join(process.cwd(), "public", file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const SHARED = css(SHARED_STYLESHEET);
const VOYAGE_CSS = css("/designs/voyage/1.css");

/** The body of the first at-rule block that starts with `prelude` (balanced braces). */
function block(source: string, prelude: string, from = 0): { body: string; start: number; end: number } | null {
  const start = source.indexOf(prelude, from);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return { body: source.slice(open + 1, i), start, end: i + 1 };
  }
  return null;
}

describe("#4453 tester A: a brand's own colours survive the new Voyage defaults", () => {
  const OWNER_SEED = "#c2185b";
  const OWNER_ACTION = "#5b1f8a";
  const artifact = voyageSyntheticArtifact();
  artifact.navigation.header_variant = "glass";
  artifact.footer.footer_variant = "giant";
  artifact.tokens = resolveTokens(VOYAGE.tokens, { colors: { accent: { seed: OWNER_SEED }, action: OWNER_ACTION } });

  it("the owner's accent ramp and action colour are what the page's tokens carry, not Voyage's pinned accent 700", () => {
    const ramp = generateRamp(OWNER_SEED) as unknown as Record<number, string>;
    const accent = artifact.tokens.colors.accent as unknown as Record<number, string>;
    expect(accent[400]).toBe(ramp[400]);
    expect(accent[700]).toBe(ramp[700]);
    expect(accent[700]).not.toBe((VOYAGE.tokens.colors.accent as unknown as { ramp: Record<number, string> }).ramp[700]);
    const style = tokenStyleCss(artifact).toLowerCase();
    expect(style).toContain(`--c-accent-400:${ramp[400]!.toLowerCase()}`);
    expect(style).toContain(`--c-accent-700:${ramp[700]!.toLowerCase()}`);
    expect(style).toContain(`--c-action:${OWNER_ACTION}`);
  });

  it("voyage's --mg-* map reads the brand's tokens (no colour literal), so the gallery layouts follow the brand", () => {
    const map = block(VOYAGE_CSS, ':root[data-design="voyage"] {', VOYAGE_CSS.indexOf("--mg-bg:") - 400);
    expect(map).not.toBeNull();
    const roles = [...map!.body.matchAll(/(--mg-[a-z0-9-]+):\s*([^;]+);/g)];
    const colourRoles = roles.filter(([, name]) => !/^--mg-(f-|d-|h1-|l-|man-)/.test(name!));
    expect(colourRoles.length).toBeGreaterThan(15);
    for (const [, name, value] of colourRoles) {
      expect(value, name).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d|\b(?:white|black)\b/i);
      expect(value, name).toMatch(/var\(--c-/);
    }
    expect(Object.fromEntries(roles.map(([, n, v]) => [n, v!.trim()]))).toMatchObject({
      "--mg-accent": "var(--c-accent-400)",
      "--mg-btn": "var(--c-action)",
      "--mg-label": "var(--c-accent-700)",
    });
  });

  it("the gallery-look additions to voyage's stylesheet take colour only from tokens", () => {
    const tail = VOYAGE_CSS.slice(VOYAGE_CSS.indexOf('[data-mg-look="gallery"]'));
    expect(tail.length).toBeGreaterThan(0);
    expect(tail).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d|(?<![-\w])(?:white|black)(?![-\w])/i);
  });
});

describe("#4453 tester B: motion is off by construction in the shared stylesheet", () => {
  const noPref = block(SHARED, "@media (prefers-reduced-motion: no-preference)");
  const outside = noPref ? SHARED.slice(0, noPref.start) + SHARED.slice(noPref.end) : SHARED;

  it("every keyframe animation outside the no-preference block has a reduced-motion stop and a motion:none stop", () => {
    expect(noPref).not.toBeNull();
    const reduce = block(SHARED, "@media (prefers-reduced-motion: reduce)");
    expect(reduce).not.toBeNull();
    // Rules (outside the no-preference block) that start a named animation.
    const started = [...outside.matchAll(/([^{}]+)\{[^{}]*\banimation:\s*(mg-[a-z-]+)/g)].map((m) => ({ selector: m[1]!.trim(), name: m[2]! }));
    expect(started.length).toBeGreaterThan(0);
    for (const { selector } of started) {
      const cls = selector.match(/\.(mg-[a-z0-9_-]+)(?![\s\S]*\.mg-)/)?.[1] ?? selector;
      expect(reduce!.body, `${selector}: reduced-motion stop`).toMatch(new RegExp(`\\.${cls}[^{]*\\{[^}]*animation:\\s*none`));
      expect(SHARED, `${selector}: motion:none stop`).toMatch(new RegExp(`\\[data-motion="none"\\][^{]*\\.${cls}[^{]*\\{[^}]*animation:\\s*none`));
    }
  });

  it("nothing is hidden at rest: every opacity:0 rule needs the module's data-mg-motion mark", () => {
    const hiding = [...SHARED.matchAll(/([^{}]+)\{[^{}]*\bopacity:\s*0(?:\.0+)?\s*[;}]/g)].map((m) => m[1]!.trim());
    for (const selector of hiding) {
      if (/\[hidden\]|:not\(\[data-in\]\)/.test(selector) === false && !/data-mg-motion="on"/.test(selector)) {
        expect.fail(`a rule hides content without the motion mark: ${selector}`);
      }
    }
  });
});

describe("#4453 tester C: header capacity has no hole for any allowed menu length", () => {
  /** Indices the CSS keeps visible in the More list for a capacity at 1100–1279 px (the :not([data-i]) allow-list). */
  function moreAllowList(cap: number): number[] {
    const rule = SHARED.match(new RegExp(`\\[data-cap="${cap}"\\] \\.mg-more__list > \\.mg-nav__li:not\\(([^)]*)\\)`));
    expect(rule, `cap ${cap} More allow-list`).not.toBeNull();
    return [...rule![1]!.matchAll(/data-i="(\d+)"/g)].map((m) => Number(m[1]));
  }

  for (const variant of HEADER_VARIANTS) {
    it(`${variant}: every item shows exactly once at 1100–1279 px and at ≥ 1280 px, for 1..${MAX_NAV_ITEMS} items`, () => {
      const cap = HEADER_INLINE_CAPACITY[variant];
      const allow = moreAllowList(cap);
      for (let n = 1; n <= MAX_NAV_ITEMS; n += 1) {
        const items = Array.from({ length: n }, (_, i) => ({ label: `Page ${i + 1}`, href: `/p${i + 1}` }));
        const html = renderToStaticMarkup(<SharedHeader variant={variant} items={items} path="/" logo={null} siteName="Fixture" cta={null} />);
        const more = html.includes('id="mg-more-list"') ? html.slice(html.indexOf('id="mg-more-list"'), html.indexOf("</ul>", html.indexOf('id="mg-more-list"'))) : "";
        const inMoreMarkup = [...more.matchAll(/data-i="(\d+)"/g)].map((m) => Number(m[1]));
        for (const [band, inlineCount, moreHidden] of [["1100-1279", cap - 1, [] as number[]], [">=1280", cap, [cap - 1]]] as const) {
          const inline = items.map((_, i) => i).filter((i) => i < inlineCount);
          const moreShown = inMoreMarkup.filter((i) => allow.includes(i) && !moreHidden.includes(i));
          const seen = [...inline, ...moreShown].sort((a, b) => a - b);
          expect(seen, `${variant} n=${n} ${band}`).toEqual(items.map((_, i) => i));
        }
      }
    });
  }

  it("below 1100 px (e.g. 1024) the phone menu lists Home and all 7 pages, numbered 01–08, with the action and Mingla's line", () => {
    const items = ["Trips", "Places", "Journal", "About us", "Contact", "Questions", "Privacy"].map((label, i) => ({ label, href: `/p${i}` }));
    const html = renderToStaticMarkup(<SharedHeader variant="glass" items={items} path="/p6" logo={null} siteName="Fixture" cta={{ label: "Book", href: "https://host.usemingla.com/b/fixture" }} place="Fixture City" />);
    const menu = html.slice(html.indexOf('id="mg-phone-menu"'));
    const numbered = [...menu.matchAll(/class="mg-pmenu__n">(\d\d)<\/span>([^<]+)</g)].map((m) => `${m[1]} ${m[2]}`);
    expect(numbered).toEqual(["01 Home", ...items.map((item, i) => `${String(i + 2).padStart(2, "0")} ${item.label}`)]);
    expect(menu).toContain("Booked through Mingla");
    // Exactly one current page in the phone list, and "More" lights in the inline nav for the folded page.
    expect((menu.slice(0, menu.indexOf("mg-pmenu__foot")).match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/class="mg-more" data-current="true"/);
  });
});
