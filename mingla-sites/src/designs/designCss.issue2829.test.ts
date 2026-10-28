/*
 * #2829 W3 (T-W3) — design stylesheets reference colours ONLY through site
 * tokens, so changing any swatch changes every surface that uses it, and an
 * owner can never get a colour the design hard-coded instead of theirs.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_CSS_VARS } from "../contracts/generated/tokens.ts";
import { DESIGN_KEYS, DESIGNS } from "../contracts/generated/designs.ts";
import { DESIGN_RENDERERS } from "./registry";

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), "public", file.replace(/^\//, "")), "utf8");
/** Splits a selector list at top-level commas only (not inside :where(...)). */
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
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*\d|(?<![-\w])(?:white|black|red|gold|ivory|silver|gray|grey)(?![-\w])/gi;

describe("#2829 design stylesheets are token-driven", () => {
  for (const key of DESIGN_KEYS) {
    const href = DESIGN_RENDERERS[key].stylesheet(DESIGNS[key].version);
    const css = withoutComments(read(href));

    it(`${key}: has no colour literal anywhere`, () => {
      expect(css.match(COLOR_LITERAL) ?? []).toEqual([]);
    });

    it(`${key}: every --c-* it reads is a token the runtime emits`, () => {
      const used = new Set([...css.matchAll(/var\((--c-[a-z0-9-]+)/g)].map((match) => match[1]!));
      const known = new Set(TOKEN_CSS_VARS);
      expect([...used].filter((name) => !known.has(name))).toEqual([]);
      // The primary swatches the design draws are all wired.
      for (const name of ["--c-canvas", "--c-ink-body", "--c-accent-400", "--c-accent-ink", "--c-surface-sunken", "--c-surface-deep"]) {
        expect(used.has(name)).toBe(true);
      }
    });

    it(`${key}: every rule is scoped to the design`, () => {
      const selectors = [...css.matchAll(/(^|[{}])\s*([^{}@;][^{};]*)\{/g)].map((match) => match[2]!.trim())
        .filter((selector) => !/^(from|to|\d+%|@)/.test(selector));
      for (const group of selectors) {
        for (const selector of topLevel(group)) {
          expect(selector, selector).toMatch(new RegExp(`^(?::root|html)?\\[data-design="${key}"\\]`));
        }
      }
    });

    it(`${key}: fonts come from the font slots and radii from the shape token`, () => {
      expect(css).toContain("--display: var(--font-display)");
      expect(css).toContain("--body: var(--font-body)");
      expect(css).not.toMatch(/font-family:\s*["'][A-Z]/);
      expect(css).not.toMatch(/@font-face/);
      expect(css).toContain("var(--radius-scale");
      expect(css).toContain("var(--button-radius");
    });
  }

  it("the v1 rollback stylesheet is the untouched v1 file (only served to v1 artifacts)", () => {
    const legacy = read("/designs/legacy-v1.css");
    expect(legacy).toContain("TEMPORARY(#2829)");
    expect(legacy).toContain("--gold: #cda052;");
    expect(legacy).toContain('src: url("/fonts/oswald-400-latin.woff2")');
  });
});
