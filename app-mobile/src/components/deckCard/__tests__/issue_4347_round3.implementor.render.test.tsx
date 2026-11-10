/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 round 3 (Seth, 2026-11-09, S1) — implementor happy path.
 *
 * A single place's collapsed card gets the plan card's box: open status on top,
 * Rating / Away / Spend tiles, then the wide Details, a round Been-here and
 * Share. A fact with no data is left out and the plate's silhouette follows
 * what is known (169 / 139 / 109 / 79). Plans and host experiences unchanged.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: removing `plan={currentPlacePlate}` from SwipeableCards, the
 * place branch of PlanPlate, or `planPlateHeight`'s per-shape rows fails here.
 */
import React from "react";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

// A cards.json-backed translator, so the rendered strings are the shipped copy.
jest.mock("react-i18next", () => {
  const cards = require("../../../i18n/locales/en/cards.json");
  const interpolate = (value: string, options: Record<string, unknown> = {}) =>
    String(value).replace(/{{\s*(\w+)\s*}}/g, (_m: string, key: string) =>
      key in options ? String(options[key]) : `{{${key}}}`,
    );
  const t = (key: string, options: Record<string, unknown> = {}) => {
    const leaf = key.includes(":") ? key.split(":").at(-1)! : key;
    const plural = typeof options.count === "number" ? `${leaf}_${options.count === 1 ? "one" : "other"}` : leaf;
    const value = cards[plural] ?? cards[leaf] ?? (options.defaultValue as string | undefined) ?? key;
    return interpolate(value, options);
  };
  return { useTranslation: () => ({ t, i18n: { language: "en" } }), initReactI18next: {} };
});
jest.mock("expo-image", () => {
  const ReactActual = jest.requireActual("react");
  const Image = (props: Record<string, unknown>) => ReactActual.createElement("ExpoImage", props);
  Image.prefetch = jest.fn(() => Promise.resolve(true));
  return { Image };
});
jest.mock("@mingla/offering-rendering", () => {
  const ReactActual = jest.requireActual("react");
  return {
    EventCoverMedia: (props: Record<string, unknown>) => ReactActual.createElement("EventCoverMedia", props),
  };
});
jest.mock("react-native-reanimated", () => {
  const R = jest.requireActual("react");
  const { View } = jest.requireActual("react-native");
  const chain = { duration: () => chain };
  return {
    __esModule: true,
    default: { View: R.forwardRef((p: Record<string, unknown>, _r: unknown) => R.createElement(View, p)) },
    useSharedValue: (v: unknown) => R.useRef({ value: v }).current,
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withTiming: (v: unknown) => v,
    withDelay: (_d: number, v: unknown) => v,
    withSequence: (...v: unknown[]) => v[0],
    Easing: { bezier: () => (x: number) => x },
    FadeOut: chain,
    FadeIn: chain,
    LinearTransition: chain,
    useReducedMotion: () => false,
  };
});
jest.mock("../../../utils/breadcrumbs", () => ({ breadcrumbs: { add: jest.fn(), tap: jest.fn() } }));
jest.mock("../../../services/currencyService", () => ({
  convertBetween: (amount: number) => amount,
  getServableRate: (code: string) => ({ USD: 1, NGN: 1347.74 } as Record<string, number>)[code] ?? null,
}));
jest.mock("../../../services/countryCurrencyService", () => ({ currencySymbolMap: { USD: "$", NGN: "₦" } }));
jest.mock("../../../utils/localeUtils", () => ({ getUserLocale: () => "en-US" }));

const { readFileSync } = require("node:fs");
const path = require("node:path");
const { DeckCardPlate, planPlatePresentation } = require("../../deckCardPlate");
const { placePlateContent } = require("../deckCardModel");
const CI = require("../../../../../packages/card-identity/index.js");

type Node = import("react-test-renderer").ReactTestInstance;

function mount(element: React.ReactElement) {
  let root: import("react-test-renderer").ReactTestRenderer | null = null;
  TestRenderer.act(() => {
    root = TestRenderer.create(element);
  });
  return root!;
}
const isComposite = (n: Node) => typeof n.type !== "string";
const byTestId = (root: { root: Node }, id: string) => root.root.findAll((n: Node) => n.props?.testID === id && isComposite(n));
const allText = (root: { root: Node }) =>
  root.root
    .findAll((n: Node) => typeof n.props?.children === "string" || typeof n.props?.children === "number")
    .map((n: Node) => String(n.props.children));
const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {});

const LABELS = {
  openUntil: (time: string) => `Open until ${time}`,
  closesIn: (m: number) => `Closes in ${m} min`,
  opensAt: (time: string) => `Opens ${time}`,
  opensTomorrow: (time: string) => `Opens tomorrow ${time}`,
  opensOn: (d: number, time: string) => `Opens +${d} ${time}`,
  open24h: "Open 24 hours",
  clock: (minute: number) => `${Math.floor(minute / 60) > 12 ? Math.floor(minute / 60) - 12 : Math.floor(minute / 60)}${Math.floor(minute / 60) >= 12 ? "pm" : "am"}`,
};
const TILE_LABELS = { rating: "Rating", away: "Away", spend: "Spend" };
const HOURS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
  (d) => `${d}: 12:00 PM – 11:00 PM`,
);
const OPEN_AT = new Date("2026-11-09T14:00:00Z");
const CLOSED_AT = new Date("2026-11-09T09:00:00Z");
const BURGUNDY = { openingHours: HOURS, utcOffsetMinutes: 0, rating: 4.6, reviewCount: 212, travelTime: "12 min", priceRange: "≈ ₦100k+" };

const plate = (content: unknown) =>
  mount(
    <DeckCardPlate
      spans={[]}
      plan={content}
      beenHere={null}
      onSharePress={() => undefined}
      shareLabel="Share"
      onDetailsPress={() => undefined}
      detailsLabel="Details"
    />,
  );

describe("#4347 round 3 — a single place gets the plan card's box (S1)", () => {
  test("R3-1 everything known: status, then Rating / Away / Spend, then Details; the full 169pt plate", () => {
    const content = placePlateContent(BURGUNDY, OPEN_AT, LABELS, TILE_LABELS);
    const root = plate(content);
    expect(byTestId(root, "deck-place-plate")).toHaveLength(1);
    expect(byTestId(root, "deck-plan-plate")).toHaveLength(0);
    expect(byTestId(root, "deck-place-status")).toHaveLength(1);
    expect(byTestId(root, "deck-plan-route")).toHaveLength(0);
    expect(["rating", "away", "spend"].map((k) => byTestId(root, `deck-plan-tile-${k}`).length)).toEqual([1, 1, 1]);
    const text = allText(root);
    expect(text).toEqual(expect.arrayContaining(["Open until 11pm", "Rating", "★ 4.6 (212)", "Away", "12 min", "Spend", "≈ ₦100k+", "Details"]));
    expect(flat(byTestId(root, "deck-place-plate")[0].props.style).height).toBe(CI.PLAN_PLATE.height);
    expect(CI.planPlateHeight()).toBe(169);
    // The old fact line's chevron divider is not drawn on the new box.
    expect(root.root.findAll((n: Node) => n.props?.name === "chevron-up")).toHaveLength(0);
  });

  test("R3-2 the status is coloured like the fact line: open green, closed grey", () => {
    const open = plate(placePlateContent(BURGUNDY, OPEN_AT, LABELS, TILE_LABELS));
    const closed = plate(placePlateContent(BURGUNDY, CLOSED_AT, LABELS, TILE_LABELS));
    const colourOf = (root: { root: Node }, words: string) =>
      flat(root.root.findAll((n: Node) => n.props?.children === words && isComposite(n))[0].props.style).color;
    expect(colourOf(open, "Open until 11pm")).toBe(CI.FACT_LINE.status.open);
    expect(colourOf(closed, "Opens 12pm")).toBe(CI.FACT_LINE.status.closed);
  });

  test("R3-3 no rating: the Rating tile is left out, never faked", () => {
    const root = plate(placePlateContent({ ...BURGUNDY, rating: null, reviewCount: null }, OPEN_AT, LABELS, TILE_LABELS));
    expect(byTestId(root, "deck-plan-tile-rating")).toHaveLength(0);
    expect(["away", "spend"].map((k) => byTestId(root, `deck-plan-tile-${k}`).length)).toEqual([1, 1]);
    expect(allText(root)).not.toContain("Rating");
  });

  test("R3-4 the Spend tile is the warm one; distance stands in when there is no travel time", () => {
    const content = placePlateContent({ ...BURGUNDY, travelTime: null, distanceLabel: "6.7 mi" }, OPEN_AT, LABELS, TILE_LABELS);
    expect(content.tiles.map((t: { key: string; value: string }) => [t.key, t.value])).toEqual([
      ["rating", "★ 4.6 (212)"],
      ["away", "6.7 mi"],
      ["spend", "≈ ₦100k+"],
    ]);
    const root = plate(content);
    const spendValue = byTestId(root, "deck-plan-tile-spend")[0].findAll((n: Node) => n.props?.children === "≈ ₦100k+" && isComposite(n))[0];
    expect(flat(spendValue.props.style).color).toBe(CI.PLAN_PLATE.tiles.spendColor);
  });

  test("R3-5 the silhouette follows what is known: 169 / 139 / 109 / 79, and the name moves with it", () => {
    const cases: [Record<string, unknown>, Date, number][] = [
      [BURGUNDY, OPEN_AT, 169],
      [{ ...BURGUNDY, openingHours: null }, OPEN_AT, 139],
      [{ openingHours: HOURS, utcOffsetMinutes: 0 }, OPEN_AT, 109],
      [{}, OPEN_AT, 79],
    ];
    for (const [card, at, h] of cases) {
      const content = placePlateContent(card, at, LABELS, TILE_LABELS);
      const root = plate(content);
      expect(flat(byTestId(root, "deck-place-plate")[0].props.style).height).toBe(h);
      expect(planPlatePresentation(content).titleBottom).toBe(CI.titleBottom("s1Single", h));
    }
    // Nothing known still leaves a clear way in.
    const bare = plate(placePlateContent({}, OPEN_AT, LABELS, TILE_LABELS));
    expect(byTestId(bare, "deck-place-status")).toHaveLength(0);
    expect(byTestId(bare, "deck-plan-tiles")).toHaveLength(0);
    expect(allText(bare)).toContain("Details");
  });

  test("R3-6 plans are unchanged: a plan with no tiles still draws the full 169pt plan plate", () => {
    const planContent = { route: "Nike Art Gallery → The Burgundy", photos: [], tiles: [] };
    const root = plate(planContent);
    expect(byTestId(root, "deck-plan-plate")).toHaveLength(1);
    expect(flat(byTestId(root, "deck-plan-plate")[0].props.style).height).toBe(169);
    expect(planPlatePresentation().plateH).toBe(169);
    expect(planPlatePresentation(planContent).plateH).toBe(169);
  });

  test("R3-7 the deck wires it: the front single place draws the place plate with a compact Been-here; host experiences keep theirs", () => {
    const deck = readFileSync(path.resolve(__dirname, "../../SwipeableCards.tsx"), "utf8");
    expect(deck).toMatch(/plan=\{currentPlacePlate\}/);
    expect(deck).toMatch(/const currentPresentation = \{ \.\.\.planPlatePresentation\(currentPlacePlate\)/);
    expect(deck).toMatch(/<BeenHereControl userId=\{user\?\.id\} card=\{currentRec\} compact \/>\s*\}\s*onSharePress=\{handleShare\}/);
    // Behind face: the same producer for a place, nothing for a host experience.
    expect(deck).toMatch(/: !nextCard\.cardType\s*\?\s*placePlateForCard\(nextCard,/);
  });
});
