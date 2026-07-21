/**
 * #1036 [remove-contrast-chip] — TESTER adversarial WEB render-proof.
 *
 * DIFFERENT ANGLE than the implementor's suite. The implementor's
 * issue_1036_contrast_apparatus_removed.test.ts is a SOURCE GATE: it
 * readFileSync's ThemeSheet.tsx and asserts named strings/identifiers
 * ("Nudge to AA", "contrastTier", "seedVsDerived", the chip styles, ...) are
 * absent. That pins the CURRENT wording but cannot prove the behaviour: a
 * refactor could re-introduce a contrast chip under RENAMED variables or with
 * NEW copy and slip straight past every literal-string grep.
 *
 * This suite attacks the RENDER PATH instead. It mounts the REAL ThemeSheet
 * through react-native-web (ReactDOMServer.renderToStaticMarkup — the deployed
 * business-web target) across a SWEEP of colour seeds spanning the whole
 * contrast-tier range, and asserts the derived colour-tab tree contains NO
 * contrast-advisory node for ANY seed:
 *   - no decimal ratio badge (e.g. "3.7:1", the chip's `${ratio.toFixed(1)}:1`),
 *   - no advisory vocabulary ("Nudge", "Crisp", "Faint", "Hard to read",
 *     "Contrast", "readable", "so labels stay").
 * while the REAL picker controls still render (preview band, hex field, Done).
 *
 * The sweep INCLUDES #2563eb — the exact Ocean preset from Seth's screenshot,
 * which previously surfaced "Nudge to AA -> 3.7:1". Under the with-chip
 * origin/main version the chip renders unconditionally (tier only changes its
 * styling/copy), so EVERY seed prints an "X.X:1" ratio -> every assertion here
 * goes red on revert. That is the behavioural fails-on-revert the source grep
 * cannot express: it proves the advisory actually FIRED for these seeds before
 * and is gone now.
 *
 * Effects don't run under renderToStaticMarkup, so the screen-reader probe
 * never flips numericMode -> the S/V plane path renders (the exact tab body
 * that used to host the chip between the ⌨ toggle row and the swatch strip).
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.issue1036.render.cjs --runInBand
 */

import React from "react";
import ReactDOMServer from "react-dom/server";

// ── Mock ONLY decorative / native-only leaves. NONE of these is where the
//    contrast chip lived — the chip was inline JSX inside ThemeSheet itself,
//    between the ⌨ numeric-toggle row and the swatch strip — so mocking these
//    cannot hide a re-introduced chip's TEXT (we assert on text/aria-label, not
//    icons). Each mock is the minimum needed to let ThemeSheet mount on web.

// Sheet primitive uses reanimated/gesture-handler portals — render children
// straight through so the sheet body (and any chip in it) renders to markup.
jest.mock("../../ui/Sheet", () => {
  const React = require("react");
  const Sheet = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return { Sheet, default: Sheet };
});

// Button pulls reanimated/haptics; render its label as Text so "Done" is
// present in the tree (proves the footer/dismiss control survives).
jest.mock("../../ui/Button", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const Button = ({ label }: { label?: string }) =>
    React.createElement(Text, null, label ?? "");
  return { Button, default: Button };
});

// Icon -> lucide-react-native (native). A re-introduced chip's TEXT survives
// this mock (we don't assert on icons), so nulling it cannot mask a chip.
jest.mock("../../ui/Icon", () => ({ Icon: () => null, default: () => null }));

// WebSafeGestureDetector wraps children with gesture-handler's GestureDetector
// (native). Pass children through.
jest.mock("../../ui/WebSafeGestureDetector", () => {
  const React = require("react");
  const WebSafeGestureDetector = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return { WebSafeGestureDetector, default: WebSafeGestureDetector };
});

// ThemeSheet calls Gesture.Pan()...chain directly at render. Provide a
// chainable no-op so the useMemo gesture builders don't throw.
jest.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = {};
  const make = (): Record<string, unknown> => {
    const g = new Proxy(chain, {
      get: () => () => g,
    });
    return g as Record<string, unknown>;
  };
  return {
    Gesture: { Pan: make, Simultaneous: make, Native: make },
    GestureDetector: ({ children }: { children?: unknown }) => children,
  };
});

// expo-linear-gradient LinearGradient -> plain View passthrough (decorative).
jest.mock("expo-linear-gradient", () => {
  const React = require("react");
  const { View } = require("react-native");
  const LinearGradient = ({ children, style }: { children?: React.ReactNode; style?: unknown }) =>
    React.createElement(View, { style }, children);
  return { LinearGradient, default: LinearGradient };
});

// ThemeEntranceAnimation (barrel) is reanimated-driven decorative motion in the
// preview. Null it. createThemePalette/resolveTheme are imported by DIRECT file
// path (not this barrel), so the REAL palette maths still run.
jest.mock("@mingla/offering-rendering", () => ({
  ThemeEntranceAnimation: () => null,
}));

// useThemeFont loads the selected font family (expo-font) — no-op under jest.
jest.mock("../../../theme/useThemeFont", () => ({ useThemeFont: () => undefined }));

// themeRecentsStore persists via native AsyncStorage — stub to an in-memory
// no-op so the store module loads under node without the native bridge.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));

import { ThemeSheet } from "../ThemeSheet";
import type { ThemeInput } from "@mingla/offering-rendering";

function renderColourTab(seed: string): string {
  const value: ThemeInput = { color: seed, font: null, animation: null };
  return ReactDOMServer.renderToStaticMarkup(
    <ThemeSheet
      visible
      onClose={() => undefined}
      value={value}
      onChange={() => undefined}
      scope="brand"
    />,
  );
}

// A contrast chip inherently prints a decimal ratio (`${ratio.toFixed(1)}:1`)
// AND/OR uses advisory vocabulary. Both signatures are asserted absent.
const RATIO_BADGE = /\d\.\d\s*:\s*1(?!\d)/; // "3.7:1", "4.5 : 1"
const RATIO_SPOKEN = /\bto\s+1\b/i;          // aria-label "Contrast 3.7 to 1."
const ADVISORY_WORDS = [
  "Nudge",
  "Crisp",
  "Faint",
  "Hard to read",
  "Small labels look faint",
  "so labels stay",
  "On the page this becomes",
  "readable",
  "Contrast",
];

// Sweep spans the tier range: pass-ish default orange, the exact low-contrast
// Ocean blue from Seth's screenshot, a near-black "fail" tier, a bright green.
const SEEDS: Array<[label: string, hex: string]> = [
  ["default orange (pass tier)", "#eb7825"],
  ["Ocean blue — the screenshot's 3.7:1 case", "#2563eb"],
  ["near-black (hard-to-read tier)", "#111318"],
  ["bright green", "#00e676"],
];

describe("#1036 — no contrast-advisory node renders for ANY seed (tester, WEB render)", () => {
  for (const [label, hex] of SEEDS) {
    describe(`seed ${hex} — ${label}`, () => {
      const html = renderColourTab(hex);

      test("the colour picker actually rendered (preview band + hex field + Done)", () => {
        // If these are absent the render is empty and the "no chip" assertions
        // below would be vacuously true — this guards against that.
        expect(html).toContain("Preview: your page with this theme");
        expect(html).toContain("Rooftop Sessions");
        expect(html).toContain("Get tickets");
        expect(html).toContain("Hex colour code");
        expect(html).toContain("Done");
      });

      test("no decimal contrast-ratio badge is rendered", () => {
        expect(html).not.toMatch(RATIO_BADGE);
        expect(html).not.toMatch(RATIO_SPOKEN);
      });

      test("no contrast-advisory vocabulary is rendered", () => {
        for (const word of ADVISORY_WORDS) {
          expect(html).not.toContain(word);
        }
      });
    });
  }

  test("the low-contrast Ocean seed specifically shows no 'Nudge to AA' affordance", () => {
    // The precise regression Seth flagged: #2563eb used to surface
    // "Nudge to AA -> 3.7:1". Assert the derived tree for that seed is clean.
    const html = renderColourTab("#2563eb");
    expect(html).not.toContain("Nudge to AA");
    expect(html).not.toMatch(RATIO_BADGE);
    // and the picker is still functional-looking (hex field present to edit).
    expect(html).toContain("Hex colour code");
  });
});
