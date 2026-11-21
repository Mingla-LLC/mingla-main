// #2331 — the server-rendered buyer pages and the React app draw the SAME
// privacy strip. Both carry their own copy of the stylesheet (the server pages
// boot without the React bundle), so this test pins them byte-for-byte and pins
// the shell rules that keep everything above the strip
// (I-PRIVACY-BAR-NEVER-OCCLUDES): one CSS constant, #root as the fixed box that
// ends at the strip, the strip on the top z-layer, and no JS measuring.
import { readFileSync } from "fs";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtime = require("../../../server/publicPrivacyRuntime.js") as {
  privacyBarCss: () => string;
  privacyBarRuntimeSource: () => string;
  privacyBarCollapsedRuntimeSource: () => string;
};

const BANNER_SOURCE = readFileSync(join(__dirname, "..", "ConsentBanner.web.tsx"), "utf8");
const HTML_SHELL = readFileSync(join(__dirname, "..", "..", "..", "scripts", "inject-mobile-blur-css.mjs"), "utf8");

function reactBarCss(): string {
  const match = BANNER_SOURCE.match(/const BAR_CSS = `\n([\s\S]*?)\n`;/);
  if (match === null) throw new Error("BAR_CSS not found in ConsentBanner.web.tsx");
  return match[1];
}

const STRIP = ":root{--mingla-privacy-strip:calc(28px + env(safe-area-inset-bottom,0px))}";
const APP = "html:has(style#expo-reset)";
const ROOT_BOX =
  `${APP} #root{position:fixed;top:0;left:0;right:0;bottom:var(--mingla-privacy-strip);box-sizing:border-box;height:auto!important;contain:layout;overflow:hidden;overflow:clip}`;

describe("#2331 privacy strip stylesheet parity", () => {
  it("the server copy equals the React copy rule for rule", () => {
    expect(runtime.privacyBarCss().split("\n")).toEqual(reactBarCss().split("\n"));
  });

  it("the strip's band is one CSS constant, and the strip is exactly that band", () => {
    for (const css of [runtime.privacyBarCss(), reactBarCss()]) {
      expect(css).toContain(STRIP);
      expect(css).toMatch(/\.mps\{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;[^}]*height:var\(--mingla-privacy-strip\);/);
      // The label can never wrap or grow the band.
      expect(css).toMatch(/\.mps\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis;/);
      expect(css).toContain(".mps span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}");
      // The Options sheet and its scrim sit ON the strip, above it in z.
      expect(css).toMatch(/\.mpb-scrim\{[^}]*bottom:var\(--mingla-privacy-strip\);z-index:2147483001;/);
      expect(css).toMatch(/\.mpb\{[^}]*bottom:var\(--mingla-privacy-strip\);z-index:2147483002;/);
      expect(css).not.toContain("--mingla-privacy-inset");
    }
  });

  it("once the app owns the document, the app root is the fixed, contained box that ends at the strip", () => {
    for (const css of [runtime.privacyBarCss(), reactBarCss()]) {
      expect(css).toContain(`${APP},${APP} body{height:100%;overflow:hidden}`);
      expect(css).toContain(ROOT_BOX);
      // react-native-web Modal's body portal gets the same box.
      expect(css).toContain(
        `${APP} body>div:has(>div [aria-modal="true"]){position:fixed;top:0;left:0;right:0;bottom:var(--mingla-privacy-strip);contain:layout;z-index:9999;pointer-events:none}`,
      );
      expect(css).toContain(`${APP} body>[aria-modal="true"]{bottom:var(--mingla-privacy-strip)!important}`);
      // #root never scrolls; a screen taller than the box scrolls in the app's
      // root view, which does not hold the fixed layers' containing block.
      expect(css).toContain("overflow:hidden;overflow:clip}");
      expect(css).toContain(`${APP} #root>div{overflow-y:auto;overscroll-behavior:contain}`);
      expect(css.match(/#root>/g)).toHaveLength(1);
    }
  });

  it("a document the app does not own (#3214 plain page, share pages) scrolls with the body padded by the band", () => {
    const lines = runtime.privacyBarCss().split("\n");
    expect(lines).toContain("body{padding-bottom:var(--mingla-privacy-strip)}");
    // Every rule that stops document scrolling or boxes #root is keyed on expo-reset.
    for (const line of lines) {
      if (/overflow:hidden|#root\{|position:fixed;top:0;left:0;right:0;bottom:var/.test(line) && !line.startsWith(".mp")) {
        expect(line.startsWith(APP) || line.startsWith(`:where(${APP}`)).toBe(true);
      }
    }
  });

  it("nothing measures the strip or writes the variable (Constitution rule 8)", () => {
    for (const source of [BANNER_SOURCE, runtime.privacyBarRuntimeSource(), runtime.privacyBarCollapsedRuntimeSource()]) {
      expect(source).not.toMatch(/ResizeObserver|writeInset|setProperty\(|data-mingla-privacy-bar|function inset\(/);
    }
  });

  it("the React strip renders outside #root and the SPA shell ships the band from the first paint", () => {
    expect(BANNER_SOURCE).toContain('const { createPortal } = require("react-dom") as {');
    expect(BANNER_SOURCE).toMatch(/return createPortal\([\s\S]*document\.body,\n  \);\n\}/);
    expect(HTML_SHELL).toContain('`<style id="${PRIVACY_BAR_STYLE_ID}">${privacyBarCss()}</style>`');
    expect(HTML_SHELL).toContain('.replace(\'<div id="root"></div>\', `<div id="root"></div>${PRIVACY_BODY}`)');
    expect(HTML_SHELL).toContain("${privacyBarCollapsedMarkup()}<script id=");
  });
});
