/*
 * #3149 — the site chrome, asserted against the EFFECTIVE declarations.
 *
 * Every number here was read off the brand's own site at a 1043x847 viewport:
 * the header is `position: fixed`, transparent, 85px tall and un-hairlined
 * over the hero; past 40px of scroll it gains `stuck`, its `::before` fades
 * `opacity: 0 -> 1` carrying `rgba(16,16,19,0.92)` and `blur(14px)`, and the
 * header settles to 72px.
 *
 * These read the STYLESHEET, not the component, because the thing that broke
 * is a rendered value and not a class name: the header was opaque and 72px on
 * every pixel of every page, so a hero built to run a full viewport started
 * 72px down and lost its top band to a bar with nothing to be legible against.
 * A test that greps the component for "stuck" would have passed against that.
 *
 * `styles.css` declares `.hero` and `.button` TWICE and the later block wins,
 * so anything asserted here is scoped to a specific block rather than searched
 * for anywhere in the file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RAW = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/styles.css"),
  "utf8",
);
const styles = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

/*
 * Top-level rules start at column 0; rules inside a media query are indented.
 * Anchoring to the start of a line is therefore how a desktop declaration is
 * told apart from the phone override of the same selector — which matters,
 * because the phone header is deliberately a different height.
 */
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const topLevel = (selector: string): string => {
  const found = styles.match(
    new RegExp(`^${escape(selector)}\\s*\\{([^}]*)\\}`, "m"),
  );
  return found ? found[1]! : "";
};

/*
 * `\s` matches a newline, so `^\s+` would happily match a TOP-LEVEL rule with
 * a blank line above it. `.nav-panel` is declared at both levels — once as
 * `display: contents` on desktop and once as the phone panel — so the
 * character class here has to exclude line breaks or this reads the wrong one.
 */
const indented = (selector: string): string => {
  const found = styles.match(
    new RegExp(`^[ \\t]+${escape(selector)}\\s*\\{([^}]*)\\}`, "m"),
  );
  return found ? found[1]! : "";
};

describe("#3149 the header is fixed and transparent over the hero", () => {
  const header = topLevel(".site-header");

  it("is taken out of flow, so the hero starts at the top of the screen", () => {
    expect(header).not.toBe("");
    expect(header).toContain("position: fixed");
    // It was sticky, which reserved 72px of page and pushed the hero down.
    expect(header).not.toContain("position: sticky");
    expect(header).toContain("inset: 0 0 auto 0");
  });

  it("carries NO background, NO blur and NO hairline of its own", () => {
    expect(header).toContain("background: transparent");
    expect(header).not.toContain("rgba(16, 16, 19, 0.94)");
    expect(header).not.toContain("backdrop-filter");
    expect(header).not.toMatch(/border-bottom:/);
  });

  it("is 85px at rest and 72px once stuck — the measured pair", () => {
    expect(styles).toContain("--header-height: 85px");
    expect(styles).toContain("--header-height-stuck: 72px");
    expect(header).toContain("height: var(--header-height)");
    expect(topLevel(".site-header.stuck")).toContain(
      "height: var(--header-height-stuck)",
    );
  });
});

describe("#3149 the scrolled panel lives on ::before", () => {
  const before = topLevel(".site-header::before");

  it("exists and paints behind the header's own contents", () => {
    expect(before).not.toBe("");
    expect(before).toContain("position: absolute");
    expect(before).toContain("inset: 0");
    expect(before).toContain("z-index: -1");
    // z-index: -1 only stays inside the header because the header isolates.
    expect(topLevel(".site-header")).toContain("isolation: isolate");
  });

  it("carries the measured fill, blur and hairline", () => {
    expect(before).toContain("background: rgba(16, 16, 19, 0.92)");
    expect(before).toContain("backdrop-filter: blur(14px)");
    expect(before).toContain("border-bottom: 1px solid rgba(240, 238, 233, 0.14)");
  });

  it("starts invisible and is revealed only by `stuck`", () => {
    expect(before).toMatch(/opacity:\s*0;/);
    expect(before).toMatch(/transition:\s*opacity/);
    expect(topLevel(".site-header.stuck::before")).toMatch(/opacity:\s*1/);
  });

  it("keeps the blur off the header element itself", () => {
    /*
     * `backdrop-filter` makes an element the containing block for its
     * `position: fixed` descendants. On the header that re-roots anything
     * fixed inside it — which is why the panel is a pseudo-element, and the
     * reference carries the same note after the same bug.
     */
    expect(topLevel(".site-header")).not.toContain("backdrop-filter");
  });

  it("goes opaque while the phone disclosure panel is open", () => {
    // Otherwise the brand and the burger float on the photograph above a
    // solid menu, which reads as a rendering fault.
    expect(topLevel(".site-header:has(.nav-panel.open)::before")).toMatch(
      /opacity:\s*1/,
    );
  });

  it("drops both transitions under prefers-reduced-motion", () => {
    const reduced = styles.match(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.site-header,\s*\.site-header::before \{([^}]*)\}/,
    );
    expect(reduced).not.toBeNull();
    expect(reduced![1]).toContain("transition: none");
  });
});

describe("#3149 nothing starts underneath the fixed header", () => {
  it("an inner page's title band clears the header's own height", () => {
    // The band still runs to the top of the screen — the header is
    // transparent over it — but the h1 sits below it. The old 4rem floor put
    // "MENU" 21px behind the header the moment the header went fixed.
    expect(topLevel(".page-header")).toContain(
      "calc(var(--header-height) + clamp(2.5rem, 7vh, 4.5rem))",
    );
    expect(styles).not.toContain(
      "padding: clamp(4rem, 13vh, 8rem) max(20px, 4vw)",
    );
  });

  it("a page whose first block is neither hero nor band is offset", () => {
    expect(topLevel("main.header-offset")).toContain(
      "padding-top: var(--header-height)",
    );
  });

  it("an anchor jump compensates for the SHRUNKEN header", () => {
    // Anchor jumps have always scrolled, so what they land under is `stuck`.
    expect(topLevel(".page-content")).toContain(
      "scroll-margin-top: var(--header-height-stuck)",
    );
  });

  it("a phone gets one header height, and everything reads it", () => {
    // Overriding the tokens rather than `height` is what keeps the band, the
    // scroll-margin and the disclosure panel's top in step with the header.
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?:root \{\s*--header-height: 64px;\s*--header-height-stuck: 64px;/,
    );
    expect(indented(".nav-panel")).toContain("top: var(--header-height)");
  });
});

describe("#3149 section imagery is rounded", () => {
  it("declares one radius token, at the reference's 14px", () => {
    expect(styles).toContain("--radius-media: 14px");
  });

  it("rounds gallery, feature and team media with it", () => {
    for (const selector of [".gallery img", ".feature img"]) {
      expect(topLevel(selector)).toContain("border-radius: var(--radius-media)");
    }
    expect(topLevel(".team-grid img")).toContain(
      "border-radius: var(--radius-media)",
    );
    // Gallery pictures were square-cornered against a design where every
    // photograph in a section is rounded.
    expect(topLevel(".gallery img")).not.toMatch(/border-radius:\s*0/);
  });

  it("leaves the full-bleed hero square", () => {
    // `.hero` is declared twice and BOTH must stay unrounded: a rounded
    // full-viewport hero would show the page behind its corners.
    const heroBlocks = styles.match(/^\.hero\s*\{[^}]*\}/gm) ?? [];
    expect(heroBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of heroBlocks) expect(block).not.toContain("border-radius");
  });

  it("leaves the reels at the radius they already had", () => {
    expect(topLevel(".reel-poster, .reel-video")).toContain("border-radius: 14px");
  });
});
