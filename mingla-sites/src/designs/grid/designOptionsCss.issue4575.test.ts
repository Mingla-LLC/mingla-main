// MINGLA-INVARIANT: I-SITES-DESIGN-OPTIONS-GATED | issue #4575 | every rule of a design options stylesheet is gated on its option attribute, so a site without options draws exactly as before.
/*
 * #4575 — Grid's options stylesheet (public/designs/grid/options-1.css):
 * gated on its option attribute rule by rule, token-driven, no keyframes of
 * its own, every movement behind motion on and no reduced-motion request,
 * the full-screen cover at every width, the grid lines over photos and full
 * colour (Grid's own 1.css and the shared sheets stay untouched: the 6b
 * snapshots and the SC-1 render test pin plain Grid).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { colorVar, DESIGN_OWNED_RGB_ROLES, TOKEN_CSS_VARS } from "../../contracts/generated/tokens.ts";
import { GRID } from "../../contracts/generated/designs.ts";
import { DESIGN_RENDERERS } from "../registry";

const raw = fs.readFileSync(path.resolve(process.cwd(), "public/designs/grid/options-1.css"), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d|(?<![-\w])(?:white|black|red|gold|ivory|silver|gray|grey)(?![-\w])/gi;
const COVER = '[data-design="grid"] .mg-page[data-mg-cover="full"]';
const PHOTOS = '[data-design="grid"] .mg-page[data-mg-photos="colour"]';
const PREFIX = /^\[data-design="grid"\] \.mg-page\[data-mg-(cover="full"|photos="colour")\]/;

/** Splits a selector list at top-level commas only (not inside :is(...)). */
function topLevel(group: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of group) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

type Rule = { selector: string; body: string; media: string[] };

/** Every style rule with the @media conditions it sits inside. */
function rules(source: string): Rule[] {
  const out: Rule[] = [];
  const stack: string[] = [];
  let i = 0;
  let head = "";
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === "{") {
      const prelude = head.trim();
      head = "";
      if (prelude.startsWith("@")) {
        stack.push(prelude);
        i += 1;
        continue;
      }
      const end = source.indexOf("}", i);
      out.push({ selector: prelude, body: source.slice(i + 1, end), media: [...stack] });
      i = end + 1;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      head = "";
      i += 1;
      continue;
    }
    head += ch;
    i += 1;
  }
  return out;
}

const all = rules(css);

describe("#4575 grid/options-1.css", () => {
  it("is linked by the Grid renderer only and its header names the issue and the immutability rule", () => {
    expect(DESIGN_RENDERERS.grid.optionsStylesheet).toBe("/designs/grid/options-1.css");
    expect(raw).toContain("#4575");
    expect(raw).toContain("Immutable: a change is options-2.css");
    expect(raw).not.toMatch(/@layer/);
    expect(all.length).toBeGreaterThan(50);
  });

  it("(a) every top-level selector is gated on an option attribute of Grid's page scope", () => {
    for (const rule of all) {
      for (const selector of topLevel(rule.selector)) expect(selector, selector).toMatch(PREFIX);
    }
  });

  it("(b) has no colour literal", () => {
    expect(css.match(COLOR_LITERAL) ?? []).toEqual([]);
  });

  it("(c) every --c-* it reads is a token the runtime emits and a role Grid draws", () => {
    const used = [...new Set([...css.matchAll(/var\((--c-[a-z0-9-]+)/g)].map((m) => m[1]!))];
    const known = new Set<string>(TOKEN_CSS_VARS);
    const drawn = new Set<string>([
      ...GRID.uses.colors.single.map((role) => colorVar(role)),
      ...Object.entries(GRID.uses.colors.ramps).flatMap(([role, steps]) => (steps ?? []).map((step) => colorVar(role, step))),
      ...DESIGN_OWNED_RGB_ROLES.map((role) => colorVar(role)),
    ]);
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter((name) => !known.has(name))).toEqual([]);
    expect(used.filter((name) => !drawn.has(name))).toEqual([]);
    // Fonts come from Grid's own variables (1.css), never a family name.
    expect(css).not.toMatch(/font-family:\s*["'A-Z]/);
    expect(css).not.toMatch(/var\(--font-/);
    expect(css).toContain("var(--display)");
    expect(css).toContain("var(--label)");
  });

  it("(d) no keyframes of its own; every animation, transform and transition is behind motion on and no reduced motion", () => {
    expect(css).not.toMatch(/@keyframes/);
    const moving = all.filter((rule) => /(^|;)\s*(animation|transform|transition)\s*:/.test(rule.body));
    expect(moving.length).toBe(5);
    for (const rule of moving) {
      expect(rule.media, rule.selector).toContain("@media (prefers-reduced-motion: no-preference)");
      for (const selector of topLevel(rule.selector)) expect(selector, selector).toContain('[data-motion="on"]');
    }
    expect(css).toContain("animation: gr-wipe ");
  });

  it("(e) the cover fills the screen at every width (no 1000px cap)", () => {
    const hero = all.filter((rule) => rule.selector === `${COVER} .mg-hero-full`);
    expect(hero).toHaveLength(1);
    expect(hero[0]!.media).toEqual([]);
    expect(hero[0]!.body.trim()).toBe("min-height: 100vh; min-height: 100svh;");
    expect(css).not.toContain("1000px");
  });

  it("(f) the grid lines sit over photographs", () => {
    const lines = all.find((rule) => rule.selector === `${COVER}::before` && !rule.media.length)!;
    expect(lines.body).toMatch(/z-index: 40;/);
    expect(lines.body).toMatch(/mix-blend-mode: difference;/);
  });

  it("(g) full colour turns Grid's monochrome off", () => {
    const colour = all.find((rule) => rule.selector.startsWith(PHOTOS) && /filter: none/.test(rule.body));
    expect(colour?.selector).toBe(`${PHOTOS} :is(.mg-ph, .mg-hero__bg) img`);
    // No hover scale on the hero picture.
    for (const rule of all.filter((candidate) => /transform\s*:/.test(candidate.body))) expect(rule.selector).not.toContain("mg-hero__bg");
  });

  it("the scrim keeps the copy zone (bottom 45%) at 70% or more", () => {
    const scrim = all.find((rule) => rule.selector === `${COVER} .mg-hero-full::after`)!;
    const stops = [...scrim.body.matchAll(/\/ (\.\d+)\) (\d+)%/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
    for (const [alpha, at] of stops) if (at >= 55) expect(alpha, `${at}%`).toBeGreaterThanOrEqual(0.7);
    expect(stops.some(([alpha, at]) => at === 55 && alpha >= 0.7)).toBe(true);
  });
  it("the consent banner stays above the grid lines (it lives inside the footer's own layer)", () => {
    const lift = all.find((rule) => rule.selector === `${COVER} > .mg-foot:has(.consent)`);
    expect(lift?.body).toMatch(/z-index: 41/);
  });

  it("phones keep the accent RSVP cell in the black bar (the shared bar hides it at 400px and below)", () => {
    expect(css).toMatch(/@media \(max-width: 400px\) \{\s*\[data-design="grid"\] \.mg-page\[data-mg-cover="full"\] \.mg-hd--grid-bar \.mg-hd__end > \.mg-hd__cta \{ display: inline-flex;/);
  });
});
