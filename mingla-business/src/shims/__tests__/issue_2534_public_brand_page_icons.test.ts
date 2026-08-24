import fs from "node:fs";
import path from "node:path";
import React from "react";

// `react-dom/server` ships no bundled types here (@types/react-dom is not a
// dep), so require it — matching the sibling orch_1137 shim suite's style — to
// keep ts-jest happy without adding a dev dependency.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (el: React.ReactElement) => string;
};

/**
 * Issue #2534 — the public brand page's ticket badge and social chips must
 * render REAL glyphs on business web, not the HelpCircle placeholder.
 *
 * WHAT BROKE. On web, metro.config.js aliases `lucide-react-native` to
 * `src/shims/lucideReactNativeWebStub.js`. That shim deep-requires a USED_ICONS
 * map and its Proxy returns a HelpCircle fallback for ANY unmapped name — by
 * design, so an unknown icon degrades instead of crashing.
 * `packages/brand-rendering/PublicBrandPage.tsx` imports ten icons from
 * `lucide-react-native` and NINE were absent from that map, so
 * `host.usemingla.com/b/{brandSlug}` drew a circled question mark for its
 * TICKETS / RSVP badge and every social chip except X. Confirmed on production
 * 2026-08-24 via `document.querySelectorAll('svg.lucide-circle-question-mark')`.
 *
 * WHY THIS SUITE ASSERTS ON IDENTITY, NOT ON "IS DEFINED". The pre-fix shim
 * ALREADY returned a defined, render-capable component for every one of these
 * nine names — the fallback. `expect(shim.Ticket).toBeDefined()` and
 * `expect(html).toContain("<svg")` both PASS on the broken tree, so a suite
 * built on them would be unfalsifiable: green before the fix and green after,
 * proving nothing. The load-bearing assertions here are therefore
 *   (a) each name resolves to a component that is NOT the fallback (identity),
 *   (b) the nine are mutually distinct components, and
 *   (c) each renders its OWN lucide class + glyph path and NOT the
 *       `lucide-circle-question-mark` markup a buyer actually saw.
 * All three flip RED the moment the nine USED_ICONS entries are deleted.
 *
 * The fallback contract itself is re-asserted in the last block: an unmapped
 * name must STILL resolve to HelpCircle. That is what gives (c) its teeth — it
 * proves the discriminator is real and the placeholder still renders the
 * question-mark markup the negative assertions look for.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const shim = require("../lucideReactNativeWebStub.js");

type IconSignature = {
  /** The literal `lucide-${iconName}` class createLucideIcon always emits. */
  readonly cls: string;
  /** A distinctive path/shape `d` taken from the real lucide-react@0.577.0 module. */
  readonly d: string;
  /** What the buyer sees on /b/{brandSlug}. */
  readonly surface: string;
};

// Signatures transcribed from the installed lucide-react@0.577.0 icon modules.
// NOTE `Globe2` is an ALIAS module (`globe-2.js` re-exports `./earth.js`), so it
// legitimately renders the `lucide-earth` class — not `lucide-globe-2`.
const NINE: Readonly<Record<string, IconSignature>> = {
  AtSign: {
    cls: "lucide-at-sign",
    d: "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",
    surface: "Threads social chip",
  },
  CalendarCheck: {
    cls: "lucide-calendar-check",
    d: "m9 16 2 2 4-4",
    surface: "RSVP kind badge",
  },
  Facebook: {
    cls: "lucide-facebook",
    d: "M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",
    surface: "Facebook social chip",
  },
  Globe2: {
    cls: "lucide-earth",
    d: "M21.54 15H17a2 2 0 0 0-2 2v4.54",
    surface: "Website social chip",
  },
  Instagram: {
    cls: "lucide-instagram",
    d: "M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z",
    surface: "Instagram social chip",
  },
  Linkedin: {
    cls: "lucide-linkedin",
    d: "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z",
    surface: "LinkedIn social chip",
  },
  Music2: {
    cls: "lucide-music-2",
    d: "M12 18V2l7 4",
    surface: "TikTok social chip",
  },
  Ticket: {
    cls: "lucide-ticket",
    d: "M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",
    surface: "TICKETS kind badge",
  },
  Youtube: {
    cls: "lucide-youtube",
    d: "m10 15 5-3-5-3z",
    surface: "YouTube social chip",
  },
} as const;

// The exact class the production forensics found on every broken glyph:
// lucide-react@0.577.0 renders HelpCircle (an alias of CircleQuestionMark) as
// `svg.lucide-circle-question-mark`.
const FALLBACK_CLASS = "lucide-circle-question-mark";

const NAMES = Object.keys(NINE);

const iconFromShim = (name: string): React.ElementType =>
  (shim as Record<string, unknown>)[name] as React.ElementType;

const renderIcon = (name: string): string =>
  renderToStaticMarkup(
    React.createElement(iconFromShim(name), {
      size: 18,
      color: "#111111",
      strokeWidth: 2,
    }),
  );

describe("#2534 · T-1 — each brand-page icon resolves to a REAL component, not the HelpCircle fallback", () => {
  it.each(NAMES)(
    "shim.%s is NOT the same component as the fallback",
    (name) => {
      const icon = iconFromShim(name);
      expect(icon).toBeDefined();
      // The whole bug: before the fix this WAS `shim.HelpCircle`.
      expect(icon).not.toBe(shim.HelpCircle);
      expect(icon).not.toBe(shim.ThisNameIsDefinitelyNotAnIcon2534);
    },
  );
});

describe("#2534 · T-2 — the nine resolve to nine DISTINCT components", () => {
  it("no two brand-page icons share a component instance", () => {
    const resolved = NAMES.map(iconFromShim);
    // Pre-fix, all nine were the one shared fallback -> size 1.
    expect(new Set(resolved).size).toBe(NAMES.length);
  });
});

describe("#2534 · T-3 — each renders its own glyph, and never the question-mark placeholder", () => {
  it.each(NAMES)("shim.%s renders its real lucide glyph", (name) => {
    const sig = NINE[name];
    const html = renderIcon(name);
    expect(html).toContain("<svg");
    // Its own identity...
    expect(html).toContain(sig.cls);
    expect(html).toContain(sig.d);
    // ...and NOT the placeholder a buyer actually saw on /b/{brandSlug}.
    expect(html).not.toContain(FALLBACK_CLASS);
  });

  it("no brand-page icon renders the placeholder (the live-page symptom)", () => {
    const offenders = NAMES.filter((name) =>
      renderIcon(name).includes(FALLBACK_CLASS),
    ).map((name) => `${name} (${NINE[name].surface})`);
    expect(offenders).toEqual([]);
  });
});

describe("#2534 · T-4 — the fallback contract is intact (this is what gives T-3 its teeth)", () => {
  it("an unmapped name STILL resolves to a real HelpCircle component, never undefined", () => {
    const unknown = (shim as Record<string, unknown>)
      .SomeIconNobodyHasMappedYet2534;
    expect(unknown).toBeDefined();
    expect(unknown).toBe(shim.HelpCircle);
  });

  it("the fallback really does render the question-mark markup T-3 asserts against", () => {
    const html = renderToStaticMarkup(
      React.createElement(shim.HelpCircle as React.ElementType, { size: 18 }),
    );
    expect(html).toContain(FALLBACK_CLASS);
  });
});

describe("#2534 · T-5 — the INV-4 drift gate walks packages/ (the half that stops a recurrence)", () => {
  // Mapping the nine fixes today's page. Widening the gate is what stops the
  // NEXT shared-package icon import from shipping the same silent placeholder,
  // so it is protected from a quiet revert here too.
  const gatePath = path.resolve(
    __dirname,
    "../../../../.github/scripts/strict-grep/i-proposed-1137-biz-web-lucide-real.mjs",
  );

  it("the gate script exists where the workflow expects it", () => {
    expect(fs.existsSync(gatePath)).toBe(true);
  });

  it("its scan roots include packages/ alongside the two mingla-business roots", () => {
    const src = fs.readFileSync(gatePath, "utf8");
    // Isolate the roots array so a mention inside a comment cannot satisfy this.
    const rootsBlock = /const\s+\w*ROOTS\w*\s*=\s*\[([\s\S]*?)\]/.exec(src);
    expect(rootsBlock).not.toBeNull();
    const roots = rootsBlock?.[1] ?? "";
    expect(roots).toContain('"packages"');
    expect(roots).toContain('"mingla-business", "src"');
    expect(roots).toContain('"mingla-business", "app"');
  });
});
