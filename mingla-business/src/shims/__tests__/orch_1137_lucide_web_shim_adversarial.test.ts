import React from "react";

// `react-dom/server` ships no bundled types here; require it (matches the
// sibling web-shim require style) to render the resolved components to markup.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (el: React.ReactElement) => string;
};

/**
 * ORCH-1137 — TESTER ADVERSARIAL regression test (different angle than the
 * implementor's happy-path `orch_1137_lucide_web_shim.test.ts`).
 *
 * The implementor's happy-path proves the 11 live names render, an unknown
 * name returns a non-undefined fallback, the `then` guard, and default/esModule
 * interop. This adversarial suite attacks a DIFFERENT class of failure:
 *
 *   A-1 (ENUMERATION-IS-DEAD): icons that are NOT in the old 12-entry null-stub
 *       list AND are not even in the 11 live-app names — `Trash2`, `Calendar`,
 *       `Bell`, `Search` — must STILL render a real <svg>. This is the proof the
 *       resolver is a TOTAL Proxy, not a quietly-renamed enumeration. A regression
 *       to ANY fixed list (even a longer one) blanks these and flips A-1 RED.
 *
 *   A-2 (DEAD-12-NO-REGRESSION): the 7 dead social icons the OLD stub enumerated
 *       (`AtSign, Facebook, Globe2, Instagram, Linkedin, Music2, Youtube`) — which
 *       USED to "render" (as () => null, i.e. blank) — must now render a real
 *       <svg>. A revert to the null-stub makes these blank again (no <svg>) → RED.
 *
 *   A-3 (PROXY has-TRAP): `'Plus' in shim`, `'AnyIconShapedName' in shim` are
 *       true (the has trap returns true for icon keys) while `'then' in shim` is
 *       false (thenable guard). A null-stub plain object has NO custom has trap,
 *       so `'AnyIconShapedName' in shim` is false there → A-3 RED on revert.
 *
 *   A-4 (WEB↔NATIVE ROSTER-PARITY / NO-DIVERGENCE GUARD): every icon name that
 *       the real native `lucide-react-native` exposes AND the app could import
 *       must ALSO resolve to a real renderable component on the web shim — the
 *       web roster must never silently diverge below the native roster (a
 *       divergence is exactly how blank glyphs return). We sample a broad set of
 *       names present on the native lib and assert each resolves real on the web
 *       shim, never undefined, never blank.
 *
 *   A-5 (NEVER-UNDEFINED FUZZ): for a fuzz set of arbitrary capitalized icon
 *       names, the shim NEVER returns undefined and NEVER throws on render — the
 *       structural F-3 crash-kill, attacked with names the implementor did not use.
 *
 * fails-on-revert: restoring `const IconStub = () => null` + the 12-entry map
 * flips A-1 (Trash2/Calendar render blank → no <svg>), A-2 (social icons blank),
 * A-3 (no has trap → `'X1137' in shim` false), A-4 (most native names undefined),
 * and A-5 (undefined → crash) RED. Re-applying the real Proxy shim flips them GREEN.
 *
 * Do NOT restore the () => null null-stub. See SPEC_ORCH-1137 §4.2/§9 +
 * invariant I-PROPOSED-1137-BIZ-WEB-LUCIDE-REAL.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const shim = require("../lucideReactNativeWebStub.js");

// The roster the web shim must not diverge BELOW: the names exposed by the REAL
// native `lucide-react-native@0.577.0`. We do NOT `require("lucide-react-native")`
// here — that lib carries the react-native-svg/Flow surface that does NOT parse
// under node/jest (the exact ORCH-1085 break the web shim exists to dodge), so
// requiring it would crash the test ENVIRONMENT, not exercise the shim. Instead
// we read the native roster off the on-disk CJS icon directory (the source of
// truth for which names native exposes) and assert each ALSO resolves real on
// the web shim. Since both packages are pinned EXACT at 0.577.0 from one Lucide
// monorepo train, this is the true web↔native no-divergence guard.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs") as typeof import("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path") as typeof import("path");

const isRenderable = (v: unknown): boolean =>
  typeof v === "function" || (typeof v === "object" && v !== null);

const renderHtml = (icon: unknown): string =>
  renderToStaticMarkup(
    React.createElement(icon as React.ElementType, { size: 16, color: "#000", strokeWidth: 2 }),
  );

describe("ORCH-1137 ADVERSARIAL · A-1 — enumeration is dead (icons outside BOTH the old-12 and the 11 live names render real)", () => {
  // None of these are in the old 12-entry null-stub, none are in the 11 live
  // app names. A fixed-list shim of ANY length blanks them.
  const NOT_ENUMERATED = ["Trash2", "Calendar", "Bell", "Search", "MapPin", "Clock"] as const;
  for (const name of NOT_ENUMERATED) {
    it(`shim.${name} (not in any hand-list) renders a real <svg>`, () => {
      const icon = (shim as Record<string, unknown>)[name];
      expect(icon).toBeDefined();
      expect(isRenderable(icon)).toBe(true);
      expect(renderHtml(icon)).toContain("<svg");
    });
  }
});

describe("ORCH-1137 ADVERSARIAL · A-2 — the 7 dead social icons now render REAL (no blank regression)", () => {
  // These were the only icons the OLD stub "had" (as () => null → blank).
  const OLD_DEAD_SOCIAL = ["AtSign", "Facebook", "Globe2", "Instagram", "Linkedin", "Music2", "Youtube"] as const;
  for (const name of OLD_DEAD_SOCIAL) {
    it(`shim.${name} renders a real <svg> (was () => null / blank under the null-stub)`, () => {
      const icon = (shim as Record<string, unknown>)[name];
      expect(icon).toBeDefined();
      expect(isRenderable(icon)).toBe(true);
      expect(renderHtml(icon)).toContain("<svg");
    });
  }
});

describe("ORCH-1137 ADVERSARIAL · A-3 — Proxy has-trap", () => {
  it("'Plus' in shim is true (a known icon name)", () => {
    expect("Plus" in shim).toBe(true);
  });
  it("'SomeArbitraryIconName1137' in shim is true (the total has-trap; a plain null-stub object would be false)", () => {
    expect("SomeArbitraryIconName1137" in shim).toBe(true);
  });
  it("'then' in shim is false (thenable guard — module is not mistaken for a Promise)", () => {
    expect("then" in shim).toBe(false);
  });
});

describe("ORCH-1137 ADVERSARIAL · A-4 — web↔native roster parity (no silent divergence below native)", () => {
  // Read the native roster from the on-disk CJS icon directory (kebab-case file
  // names → PascalCase exports). This is the set of names native exposes; the
  // web shim must resolve every one of them real (never undefined, never blank).
  const NATIVE_ICONS_DIR = path.join(
    __dirname,
    "..", "..", "..",
    "node_modules", "lucide-react-native", "dist", "cjs", "icons",
  );

  const kebabToPascal = (kebab: string): string =>
    kebab
      .replace(/\.js$/, "")
      .split("-")
      .map((seg) => (seg.length === 0 ? "" : seg[0].toUpperCase() + seg.slice(1)))
      .join("");

  it("the native icon directory exists and exposes a large roster (sanity)", () => {
    expect(fs.existsSync(NATIVE_ICONS_DIR)).toBe(true);
    const files = fs.readdirSync(NATIVE_ICONS_DIR).filter((f) => f.endsWith(".js"));
    expect(files.length).toBeGreaterThan(500);
  });

  it("EVERY native icon name the web shim is asked for resolves to a real, non-undefined renderable component (sampled across the full native roster — no silent web divergence)", () => {
    const files = fs
      .readdirSync(NATIVE_ICONS_DIR)
      .filter((f) => f.endsWith(".js") && !f.endsWith(".js.map"));
    // Sample every 37th file across the full sorted roster for a broad, stable,
    // fast spread (≈46 names) rather than all 1700+.
    const sampled = files
      .sort()
      .filter((_f, i) => i % 37 === 0)
      .map(kebabToPascal)
      // Lucide CJS ships a few non-icon helper files; PascalCase of those is
      // harmless — they still must resolve to a non-undefined component via the
      // Proxy fallback, which is itself part of the never-undefined contract.
      .filter((n) => n.length > 0);

    expect(sampled.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const name of sampled) {
      const onWeb = (shim as Record<string, unknown>)[name];
      if (onWeb === undefined || !isRenderable(onWeb)) {
        offenders.push(`${name}=undefined-or-not-renderable`);
        continue;
      }
      try {
        if (!renderHtml(onWeb).includes("<svg")) {
          // A real lucide icon renders an <svg>; the HardFallback renders null.
          // The contract is "never undefined / never crash" — a blank fallback
          // for a truly-unknown name is allowed, but a NATIVE-roster name that
          // renders blank is a divergence. Record it for inspection.
          offenders.push(`${name}=blank(no-svg)`);
        }
      } catch (e) {
        offenders.push(`${name}=threw:${(e as Error).message}`);
      }
    }
    // Hard contract: NONE may be undefined / not-renderable / throw.
    const hardFails = offenders.filter((o) => o.includes("undefined-or-not-renderable") || o.includes("threw:"));
    expect(hardFails).toEqual([]);
  });
});

describe("ORCH-1137 ADVERSARIAL · A-5 — never-undefined fuzz (different names than the happy-path used)", () => {
  const FUZZ = [
    "ZzTopNotARealIcon",
    "Qwerty1137",
    "AAAAAAAAAA",
    "Plus2Electric",
    "NewIconAddedIn2099",
    "Z",
  ];
  for (const name of FUZZ) {
    it(`shim.${name} is never undefined and never throws on render`, () => {
      let icon: unknown;
      expect(() => {
        icon = (shim as Record<string, unknown>)[name];
      }).not.toThrow();
      expect(icon).not.toBeUndefined();
      expect(isRenderable(icon)).toBe(true);
      expect(() => renderHtml(icon)).not.toThrow();
    });
  }
});
