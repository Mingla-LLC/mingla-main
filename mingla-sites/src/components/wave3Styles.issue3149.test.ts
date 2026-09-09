// @vitest-environment jsdom
/*
 * #3149 wave 3 — the stylesheet, MEASURED rather than read.
 *
 * `styles.css` declares `.hero`, `.button` and `.gallery` more than once and
 * the LATER block wins, so grepping the file for a declaration proves nothing
 * about what a browser ends up applying. Everything here loads the real
 * stylesheet into a real document, builds the real markup, and reads
 * `getComputedStyle`.
 *
 * The reduced-motion half needs one trick and it is worth stating plainly:
 * jsdom does not emulate `prefers-reduced-motion`, so a media query for it
 * never matches. Rather than assert nothing about the case that matters, the
 * stylesheet is re-served with the reduced-motion blocks UNWRAPPED — every
 * other rule in place, in its original order. That is the exact cascade a
 * visitor with the preference gets, including the blanket
 * `animation-duration: 0.01ms !important` block earlier in the file, which is
 * the thing that made this worth measuring at all.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = fs.readFileSync(
  path.resolve(process.cwd(), "src/app/styles.css"),
  "utf8",
);

/* Unwraps every `@media (<query>) { ... }` block, brace-balanced, leaving the
   rules inside exactly where they were in source order. */
function unwrap(source: string, query: string): string {
  const marker = `@media ${query}`;
  let out = "";
  let index = 0;
  for (;;) {
    const at = source.indexOf(marker, index);
    if (at < 0) return out + source.slice(index);
    out += source.slice(index, at);
    const open = source.indexOf("{", at);
    let depth = 0;
    let close = open;
    for (; close < source.length; close += 1) {
      if (source[close] === "{") depth += 1;
      else if (source[close] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out += source.slice(open + 1, close);
    index = close + 1;
  }
}

const REDUCED = unwrap(CSS, "(prefers-reduced-motion: reduce)");
const PHONE = unwrap(CSS, "(max-width: 767px)");

function measured(sheet: string, html: string, selector: string) {
  document.head.innerHTML = "";
  document.body.innerHTML = html;
  const style = document.createElement("style");
  style.textContent = sheet;
  document.head.appendChild(style);
  const element = document.querySelector(selector);
  if (!element) throw new Error(`nothing matched ${selector}`);
  return getComputedStyle(element);
}

const MARQUEE = `<div class="marquee"><div class="marquee-track">` +
  `<span class="marquee-run" id="first"><span class="marquee-phrase">24/7 food house</span></span>` +
  `<span class="marquee-run" id="second" aria-hidden="true"><span class="marquee-phrase">24/7 food house</span></span>` +
  `</div></div>`;

const GALLERY = `<div class="gallery">` +
  `<a class="gallery-item" id="one"><img></a><a class="gallery-item" id="two"><img></a>` +
  `</div>`;

const STRIP = `<div class="gallery gallery-strip">` +
  `<a class="gallery-item" id="one"><img></a><a class="gallery-item" id="two"><img></a>` +
  `</div>`;

describe("#3149 the marquee actually scrolls", () => {
  it("runs the loop, and runs it forever", () => {
    const track = measured(CSS, MARQUEE, ".marquee-track");
    expect(track.animation).toBe("marquee-slide 34s linear infinite");
  });

  it("is as wide as its content, so half a turn lands on the seam", () => {
    /*
     * Without `max-content` the flex track is only as wide as its box, both
     * runs are compressed to fit, and translating 50% no longer lands on the
     * start of the second copy — the loop visibly jumps every revolution.
     */
    expect(measured(CSS, MARQUEE, ".marquee-track").width).toBe("max-content");
  });

  it("clips to the strip rather than widening the page", () => {
    expect(measured(CSS, MARQUEE, ".marquee").overflow).toBe("hidden");
  });

  it("shows both runs, because both are needed for the seam", () => {
    expect(measured(CSS, MARQUEE, "#second").display).toBe("flex");
  });

  it("draws the separator itself — no punctuation in the copy", () => {
    const rule = CSS.match(/\.marquee-phrase::after \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain('content: "\\00b7"');
    expect(rule).toContain("color: var(--gold)");
  });
});

describe("#3149 reduced motion stops it, and does not hide it", () => {
  it("REMOVES the animation outright", () => {
    /*
     * The blanket rule earlier in this file forces `animation-duration:
     * 0.01ms !important` and one iteration. That stops the loop but leaves the
     * track wherever the animation put it, which for this track is half a
     * revolution along — showing the duplicate copy. `animation: none` is what
     * actually removes it, and this measures the shorthand a browser resolves.
     */
    const track = measured(REDUCED, MARQUEE, ".marquee-track");
    expect(track.animation).toBe("none");
    expect(track.transform).toBe("none");
  });

  it("hides the duplicate, so the phrases print once", () => {
    expect(measured(REDUCED, MARQUEE, "#second").display).toBe("none");
    expect(measured(REDUCED, MARQUEE, "#first").display).not.toBe("none");
  });

  it("wraps instead of scrolling, so nothing is clipped off the edge", () => {
    const track = measured(REDUCED, MARQUEE, ".marquee-track");
    expect(track.flexWrap).toBe("wrap");
    expect(track.width).not.toBe("max-content");
    expect(measured(REDUCED, MARQUEE, ".marquee").overflow).toBe("visible");
  });

  it("still shows the strip — the phrases are the brand's copy", () => {
    expect(measured(REDUCED, MARQUEE, ".marquee").display).not.toBe("none");
    expect(measured(REDUCED, MARQUEE, "#first").display).toBe("flex");
  });

  it("opens the lightbox without a fade", () => {
    const sheet = REDUCED;
    const panel = measured(sheet, `<div class="lightbox"></div>`, ".lightbox");
    expect(panel.animation).toBe("none");
    // And it is still a covering panel, not a hidden one.
    expect(panel.position).toBe("fixed");
  });
});

describe("#3149 the gallery anchor is the grid cell now", () => {
  it("gives the mosaic's tall first cell to the ANCHOR", () => {
    /*
     * `.gallery img:first-child { grid-row: span 2 }` still exists above and
     * is now inert: an `img` inside an `a` is not a grid item, so the property
     * is discarded. The tall cell has to be restated on the element that is
     * one, or the mosaic quietly flattens.
     */
    expect(measured(CSS, GALLERY, "#one").gridRow).toBe("span 2");
    expect(measured(CSS, GALLERY, "#two").gridRow).not.toBe("span 2");
  });

  it("neutralises that cell in the short strip", () => {
    expect(measured(CSS, STRIP, "#one").gridRow).toBe("auto");
  });

  it("fills its cell, and may shrink below its picture's width", () => {
    const anchor = measured(CSS, GALLERY, "#one");
    expect(anchor.display).toBe("block");
    expect(anchor.height).toBe("100%");
    // `.gallery > *` now selects the anchors; a 640px intrinsic image inside a
    // zero-minimum track needs this or the grid overflows the page.
    expect(anchor.minWidth).toBe("0");
  });

  it("lets the strip's cells size to their own square pictures", () => {
    expect(measured(CSS, STRIP, "#one").height).toBe("auto");
  });

  it("gives the phone mosaic's first cell the full width", () => {
    const anchor = measured(PHONE, GALLERY, "#one");
    expect(anchor.gridColumn).toBe("span 2");
    expect(anchor.gridRow).toBe("auto");
  });
});

describe("#3149 the new sections inherit the site's own tokens", () => {
  it("draws the pull quote's bar in the brand's accent", () => {
    const quote = measured(
      CSS,
      `<figure class="pull-quote"><blockquote><p>x</p></blockquote></figure>`,
      ".pull-quote",
    );
    /*
     * Read as LONGHANDS, and written that way in the stylesheet for the same
     * reason: a `border-left` shorthand whose colour is a custom property is
     * kept verbatim rather than split, so `border-left-color` reads back as
     * the inherited text colour and a bar that had silently lost its accent
     * would measure as passing.
     */
    expect(quote.borderLeftColor).toBe("var(--gold)");
    expect(quote.borderLeftWidth).toBe("2px");
    expect(quote.borderLeftStyle).toBe("solid");
  });

  it("rounds the map and the stat cards with the shared media radius", () => {
    const panel = measured(
      CSS,
      `<div class="map-panel"></div>`,
      ".map-panel",
    );
    expect(panel.borderRadius).toBe("var(--radius-media)");
    const card = measured(
      CSS,
      `<dl class="stats-row"><div id="card"><dt>24/7</dt></div></dl>`,
      "#card",
    );
    expect(card.borderRadius).toBe("var(--radius-media)");
  });
});
