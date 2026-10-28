/*
 * #2829 W3 (T-W3) — token CSS emission and self-hosted font faces.
 *
 * R-9: the page a visitor loads names fonts ONLY at /fonts/<digest> on its own
 * origin; no Google host appears anywhere in the emitted markup.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { upgradeV1ToV2 } from "../../contracts/generated/upgradeV1ToV2.ts";
import { resolveTokens } from "../../contracts/generated/tokens.ts";
import { ATELIER } from "../../contracts/generated/designs.ts";
import { gogiV1Fixture } from "../../contracts/gogiV1.fixture";
import { FontFaces, fontFacesCss, preloadDigests } from "./FontFaces";
import { TokenStyle, tokenStyleCss } from "./TokenStyle";

const D = (c: string) => c.repeat(64);

function artifact() {
  const v2 = upgradeV1ToV2(gogiV1Fixture(), {
    fontAssets: [
      { family: "Oswald", weight: 400, style: "normal", unicode_range: "U+0000-00FF, U+0131", digest: D("1"), bytes: 100 },
      { family: "Oswald", weight: 600, style: "normal", unicode_range: "U+0000-00FF, U+0131", digest: D("2"), bytes: 100 },
      { family: "Oswald", weight: 400, style: "normal", unicode_range: "U+0100-02BA", digest: D("3"), bytes: 100 },
      { family: "Plus Jakarta Sans", weight: 400, style: "normal", unicode_range: "U+0000-00FF", digest: D("4"), bytes: 100 },
      { family: "Plus Jakarta Sans", weight: 800, style: "normal", unicode_range: "U+0000-00FF", digest: D("5"), bytes: 100 },
    ],
    fontFallbacks: [
      { family: "Oswald", local: "Arial", size_adjust: "81.43%", ascent_override: "146.51%", descent_override: "35.49%", line_gap_override: "0.00%" },
    ],
  });
  return v2;
}

describe("#2829 TokenStyle", () => {
  it("emits every token and the font stacks on :root", () => {
    const css = tokenStyleCss(artifact());
    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain("--c-canvas:#101013");
    expect(css).toContain("--c-accent-400:#cda052");
    expect(css).toContain('--font-display:"Oswald", "Oswald Fallback", ui-sans-serif');
    expect(css).toContain('--font-body:"Plus Jakarta Sans", "Plus Jakarta Sans Fallback"');
    expect(renderToStaticMarkup(<TokenStyle artifact={artifact()} />)).toContain('data-site-tokens="1"');
  });

  it("an owner's exact accent reaches the page unchanged (R-10)", () => {
    const v2 = artifact();
    v2.tokens = resolveTokens(ATELIER.tokens, { colors: { accent: { seed: "#ff00aa", steps: { 400: "#ff00aa" } }, ink_body: "#bbbbbb", canvas: "#ffffff" } });
    const css = tokenStyleCss(v2);
    expect(css).toContain("--c-accent-400:#ff00aa");
    expect(css).toContain("--c-ink-body:#bbbbbb");
    expect(css).toContain("--c-canvas:#ffffff");
  });
});

describe("#2829 FontFaces (R-9)", () => {
  it("points every face at /fonts/<digest> with swap and unicode-range", () => {
    const css = fontFacesCss(artifact());
    expect(css).toContain(`@font-face{font-family:"Oswald";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/${D("1")}") format("woff2");unicode-range:U+0000-00FF, U+0131}`);
    expect(css).toContain('@font-face{font-family:"Oswald Fallback";src:local("Arial");size-adjust:81.43%;ascent-override:146.51%;descent-override:35.49%;line-gap-override:0.00%}');
    expect(css).not.toMatch(/googleapis|gstatic|https?:/);
  });

  it("preloads display and body regular/bold latin files, from the site itself", () => {
    expect(preloadDigests(artifact()).sort()).toEqual([D("1"), D("2"), D("4"), D("5")].sort());
    const html = renderToStaticMarkup(<FontFaces artifact={artifact()} />);
    expect(html).toContain(`href="/fonts/${D("1")}"`);
    expect(html).not.toMatch(/googleapis|gstatic/);
  });

  it("a private preview's fonts carry the preview key", () => {
    expect(fontFacesCss(artifact(), "publications/x/preview-y/z.json")).toContain(`/fonts/${D("1")}?k=publications%2Fx%2Fpreview-y%2Fz.json`);
  });

  it("emits nothing for a tampered family name or digest", () => {
    const v2 = artifact();
    v2.font_assets[0]!.family = 'Oswald";}body{display:none}';
    v2.font_assets[1]!.digest = "../../etc";
    const css = fontFacesCss(v2);
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("../../etc");
  });
});
