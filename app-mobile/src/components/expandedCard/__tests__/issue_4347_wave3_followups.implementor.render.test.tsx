/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 wave 3 follow-ups (implementor happy path).
 *
 *   F1  the deck's tap zones read the LIVE text size (useWindowDimensions
 *       fontScale, capped by MAX_FONT_SCALE), not only the caps;
 *   F2  the schedule safety check decides open-at-arrival with the same
 *       overnight model the plan sheet's chips use (getOpenStatusAt);
 *   F4  the place sheet's Reserve / Directions and the plan's Schedule are the
 *       same primary button: one token pair, contrast >= 4.5:1.
 *   (F3 "Route all stops" lives in issue_4347_plan_model R-2..R-5.)
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: dropping `fontScale: deckTextScale` from the deck's
 * tapZoneBottomY call (F1-3), restoring the arrival-day-only isPlaceOpenAt
 * (F2-1), or putting #ea580c / a white label back on the place sheet's main
 * button (F4-2, F4-3) fails here.
 */
import fs from "fs";
import path from "path";
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

const mockWindow = { width: 402, height: 874, scale: 3, fontScale: 1 };
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return new Proxy(actual, {
    get: (target, key) => (key === "useWindowDimensions" ? () => ({ ...mockWindow }) : target[key]),
  });
});
jest.mock("expo-image", () => ({ Image: { prefetch: jest.fn(() => Promise.resolve(true)) } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

const CI = require("../../../../../packages/card-identity/index.js");
const { capDeckTextScale, useDeckTextScale } = require("../../deckCard/deckCardHooks");
const { tapZoneBottomY } = require("../../deckCard/DeckCardChrome");
const { checkAllCuratedStopsOpen } = require("../../../utils/curatedStopsAvailability");
const { getOpenStatusAt } = require("../../../utils/openingHoursUtils");
const { pinnedPrimaryStyles } = require("../pinnedPrimary");
const { PINNED_PRIMARY, SPINE } = require("../spineTokens");

const SRC = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("F1 tap zones follow the live text size", () => {
  test("F1-1 the scale is capped by MAX_FONT_SCALE and never under 1.0x", () => {
    expect(capDeckTextScale(1)).toBe(1);
    expect(capDeckTextScale(1.2)).toBe(1.2);
    expect(capDeckTextScale(3.1)).toBe(CI.MAX_FONT_SCALE.title);
    expect(capDeckTextScale(0.85)).toBe(1);
    expect(capDeckTextScale(Number.NaN)).toBe(CI.MAX_FONT_SCALE.title);
    expect(capDeckTextScale(undefined)).toBe(CI.MAX_FONT_SCALE.title);
  });

  test("F1-2 useDeckTextScale reads the live font scale and follows a change", () => {
    const seen: number[] = [];
    const Probe = () => {
      seen.push(useDeckTextScale());
      return null;
    };
    let root: { update: (el: React.ReactElement) => void; unmount: () => void } | undefined;
    mockWindow.fontScale = 1;
    TestRenderer.act(() => {
      root = TestRenderer.create(<Probe />);
    });
    mockWindow.fontScale = 1.3;
    TestRenderer.act(() => root!.update(<Probe />));
    mockWindow.fontScale = 2.5;
    TestRenderer.act(() => root!.update(<Probe />));
    TestRenderer.act(() => root!.unmount());
    expect(seen).toEqual([1, 1.3, CI.MAX_FONT_SCALE.title]);
  });

  test("F1-3 the deck passes the live scale to tapZoneBottomY, so at 1.0x the zones reach the real column", () => {
    const deck = stripComments(read("components/SwipeableCards.tsx"));
    expect(deck).toMatch(/const deckTextScale = useDeckTextScale\(\);/);
    const call = deck.slice(deck.indexOf("tapZoneBottomY("), deck.indexOf("tapZoneBottomY(") + 400);
    expect(call).toMatch(/fontScale: deckTextScale/);
    // What it buys: at 1.0x the zone bottom sits LOWER (more flip area) than
    // the caps-only fallback, and never lower than the column allows.
    const atOne = tapZoneBottomY(600, 40, { smartChip: true, stack: true, fontScale: capDeckTextScale(1) });
    const capsOnly = tapZoneBottomY(600, 40, { smartChip: true, stack: true });
    expect(atOne).toBeGreaterThan(capsOnly);
    expect(tapZoneBottomY(600, 40, { smartChip: true, stack: true, fontScale: capDeckTextScale(3) })).toBe(capsOnly);
  });
});

describe("F2 one overnight-hours model", () => {
  const BAR = [
    "Monday: Closed",
    "Tuesday: Closed",
    "Wednesday: Closed",
    "Thursday: Closed",
    "Friday: 6:00 PM – 2:00 AM",
    "Saturday: 6:00 PM – 2:00 AM",
    "Sunday: Closed",
  ];
  // Fri 29, Sat 30, Sun 31 May 2026, venue-local through a +60 offset.
  const venue = (day: number, hour: number, minute = 0) =>
    new Date(Date.UTC(2026, 4, day, hour, minute) - 60 * 60_000);

  test("F2-1 the schedule check says what the sheet says at 23:30 and 01:00 on Friday and Saturday nights", () => {
    const cases: Array<[Date, boolean]> = [
      [venue(29, 1), false], // Friday 01:00 — Thursday was closed
      [venue(29, 23, 30), true],
      [venue(30, 1), true], // Saturday 01:00 — Friday night
      [venue(30, 23, 30), true],
      [venue(31, 1), true], // Sunday 01:00 — Saturday night
    ];
    for (const [when, open] of cases) {
      const sheet = getOpenStatusAt(BAR, when, 60);
      expect(sheet !== null && sheet.kind !== "closed").toBe(open);
      const check = checkAllCuratedStopsOpen(
        [{ placeName: "Bar", openingHours: { weekdayDescriptions: BAR }, utcOffsetMinutes: 60 }],
        when,
        "en-US",
      );
      expect({ at: when.toISOString(), allOpen: check.allOpen }).toEqual({ at: when.toISOString(), allOpen: open });
    }
  });
});

describe("F4 one primary-button colour across the place and plan sheets", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  test("F4-1 the token pair is the accent fill with its on-accent label, at least 4.5:1", () => {
    expect(PINNED_PRIMARY).toEqual({ fill: SPINE.accentFill, label: SPINE.onAccent });
    expect(contrast(PINNED_PRIMARY.fill, PINNED_PRIMARY.label)).toBeGreaterThanOrEqual(4.5);
    const button = pinnedPrimaryStyles.button;
    const label = pinnedPrimaryStyles.label;
    expect(button.backgroundColor).toBe(PINNED_PRIMARY.fill);
    expect(label.color).toBe(PINNED_PRIMARY.label);
  });

  test("F4-2 the place sheet's Reserve and Directions and the plan's Schedule all use the same style", () => {
    const modal = stripComments(read("components/ExpandedCardModal.tsx"));
    const actions = stripComments(read("components/expandedCard/ActionButtons.tsx"));
    for (const id of ["sheet-primary-reserve", "sheet-primary-directions"]) {
      const at = modal.indexOf(`testID="${id}"`);
      expect(at).toBeGreaterThan(-1);
      const block = modal.slice(at, modal.indexOf("</TouchableOpacity>", at));
      expect(block).toMatch(/style=\{pinnedPrimaryStyles\.button\}/);
      expect(block).toMatch(/<Text style=\{pinnedPrimaryStyles\.label\}/);
      expect(block).toMatch(/color=\{PINNED_PRIMARY\.label\}/);
    }
    const at = actions.indexOf('testID="sheet-primary-schedule"');
    const schedule = actions.slice(at, actions.indexOf("</TrackedTouchableOpacity>", at));
    expect(schedule).toMatch(/pinnedPrimaryStyles\.button/);
    expect(schedule).toMatch(/<Text style=\{pinnedPrimaryStyles\.label\}/);
  });

  test("F4-3 the rejected #EA580C with a white label is gone from the place sheet", () => {
    const modal = stripComments(read("components/ExpandedCardModal.tsx"));
    expect(modal).not.toMatch(/#ea580c/i);
    expect(modal).not.toMatch(/reserveStyles/);
    // White on #EA580C measured 3.56:1; it is the reason the colour was rejected.
    expect(contrast("#EA580C", "#FFFFFF")).toBeLessThan(4.5);
  });
});
