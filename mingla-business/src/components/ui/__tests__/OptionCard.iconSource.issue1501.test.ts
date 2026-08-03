/**
 * Issue #1501 [add-rooms-form] — WHERE THE STAY EDITOR'S ICONS COME FROM.
 *
 * THE BUG THIS PINS (caught in review on PR #1507, not in production):
 *
 * `OptionCard` originally took a lucide component as its `icon` prop, and
 * `StayInventoryManager` registered 10 new glyphs (Umbrella, Layers, Zap,
 * UserCheck, Lock, Users, Copy, Tag, Globe, KeyRound) in
 * `src/shims/lucideReactNativeWebStub.js`. That looked local and free. It was
 * neither.
 *
 * On web, `metro.config.js` aliases `lucide-react-native` to that shim, and the
 * shim builds its `USED_ICONS` map with deep `require()`s AT MODULE SCOPE. The
 * shim is reachable from the eager boot path, so Metro places it in the EAGER
 * `__common` chunk — which means every glyph in that map is downloaded by every
 * business-web visitor BEFORE ANYTHING RENDERS, even though the only screen
 * using them is the Stay offering editor behind a lazy route.
 *
 * Measured: the eager `__common` chunk went 2,316,555 B -> 2,325,301 B, i.e.
 * +8,746 B of boot payload, breaching the ORCH-1083 cap (2,320,000 B). The
 * three new components themselves were never the problem — they were correctly
 * code-split into the lazy Stay route chunk the whole time.
 *
 * THE RULE: a shared `ui/` primitive that lazy screens render must draw its
 * glyphs from the IN-APP `Icon` roster (`src/components/ui/Icon.tsx`, 69 SVG
 * glyphs), which is ALREADY in `__common` because `Button` depends on it. Those
 * cost zero marginal eager bytes. Adding a lucide glyph for a lazy-only screen
 * is a permanent, global boot-payload cost and is not a local decision.
 *
 * After the fix: `__common` is 2,317,625 B — under the cap, +1,070 B vs
 * baseline, all of which is the new `designSystem.ts` layout tokens (which
 * genuinely belong in the eager tokens module) plus minifier/chunk-hash churn.
 *
 * FAILS-ON-REVERT: give `OptionCard` a lucide import again, or re-add a lucide
 * glyph to `StayInventoryManager`, -> I-1/I-2 FAIL.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 */

import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(businessRoot, rel), "utf8");

const optionCard = read("src/components/ui/OptionCard.tsx");
const chipInput = read("src/components/ui/ChipInput.tsx");
const nameBuilder = read("src/components/ui/NameBuilder.tsx");
const manager = read("src/components/stay/StayInventoryManager.tsx");
const icon = read("src/components/ui/Icon.tsx");

/** Strip comments — this file's own explanation must not fail its own rule. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("#1501 — the Stay editor's icons stay OUT of the eager boot payload", () => {
  it("I-0 — VACUITY GUARD: all five sources really loaded", () => {
    for (const [name, source] of [
      ["OptionCard", optionCard],
      ["ChipInput", chipInput],
      ["NameBuilder", nameBuilder],
      ["StayInventoryManager", manager],
      ["Icon", icon],
    ] as const) {
      expect({ name, big: source.length > 500 }).toEqual({ name, big: true });
    }
  });

  it("I-1 — the three new shared inputs import NO lucide glyph at all", () => {
    for (const [name, source] of [
      ["OptionCard", optionCard],
      ["ChipInput", chipInput],
      ["NameBuilder", nameBuilder],
    ] as const) {
      const code = stripComments(source);
      expect({ name, lucide: code.includes("lucide-react-native") }).toEqual({
        name,
        lucide: false,
      });
    }
    // ...and OptionCard's glyph prop is a NAME from the in-app roster, so a
    // caller cannot smuggle a lucide component through it.
    expect(stripComments(optionCard)).toContain("icon?: IconName");
    expect(stripComments(optionCard)).toContain('from "./Icon"');
  });

  it("I-2 — the editor's lucide imports are EXACTLY the four that pre-date #1501", () => {
    const code = stripComments(manager);
    const importLine = /import\s*\{([^}]*)\}\s*from\s*"lucide-react-native";/.exec(
      code,
    );
    expect(importLine).not.toBeNull();
    const imported = (importLine as RegExpExecArray)[1]
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .sort();
    // These four were already in the boot payload before this issue. Any
    // ADDITION here is a permanent, global boot-payload cost — measure it and
    // justify it, or use the in-app `Icon` roster instead.
    expect(imported).toEqual(["BedDouble", "CalendarDays", "Check", "X"]);
  });

  it("I-3 — every choice glyph resolves against the real in-app roster", () => {
    const code = stripComments(manager);
    const table = /const STAY_CHOICE_ICON: Record<StayChoiceId, IconName> = \{([\s\S]*?)\n\};/.exec(
      code,
    );
    expect(table).not.toBeNull();
    const names = [
      ...(table as RegExpExecArray)[1].matchAll(/:\s*"([a-zA-Z]+)"/g),
    ].map((match) => match[1]);

    // Vacuity guard: all twelve approved choices carry a glyph.
    expect(names).toHaveLength(12);

    // `Icon` renders a dev-warning fallback square for an unknown name rather
    // than throwing, so a typo would ship as a blank box. Resolve each against
    // the real exported union.
    const roster = /export type IconName =([\s\S]*?);/.exec(icon);
    expect(roster).not.toBeNull();
    const known = new Set(
      [...(roster as RegExpExecArray)[1].matchAll(/"([a-zA-Z]+)"/g)].map(
        (match) => match[1],
      ),
    );
    expect(known.size).toBeGreaterThan(50);
    for (const name of names) {
      expect({ name, inRoster: known.has(name) }).toEqual({
        name,
        inRoster: true,
      });
    }
  });

  it("I-4 — the lucide web shim is untouched by #1501", () => {
    // The shim's used-set is a GLOBAL EAGER REGISTRY: whatever is in it ships
    // to every visitor. #1501 must have added nothing to it.
    const shim = read("src/shims/lucideReactNativeWebStub.js");
    for (const glyph of [
      "Umbrella",
      "Layers",
      "Zap",
      "UserCheck",
      "Lock",
      "Users",
      "Copy",
      "Tag",
      "Globe",
      "KeyRound",
    ]) {
      expect({
        glyph,
        registered: shim.includes(`${glyph}: iconOf(`),
      }).toEqual({ glyph, registered: false });
    }
  });
});
