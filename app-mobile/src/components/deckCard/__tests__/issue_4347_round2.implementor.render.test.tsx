/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #4347 round 2 (Seth, 2026-11-09) — implementor happy path.
 *
 *   1. Real Google price estimates on AI plans: the collapsed plan plate's Spend
 *      tile reads "₦100,000+" (≈ "$74+" for a dollar viewer), with the
 *      spend-level fallback when a paying stop has no price.
 *   2. Direction B: the plan plate (route + stop photos, Time / Away / Spend,
 *      wide Details) replaces the slivers and the fact line.
 *   3. "Price per stop" on the plan sheet; conditions rows keep the value
 *      beside the label.
 *   4. The pinned primary label shrinks INSIDE its button; the stepper is solid.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs.
 *
 * FAILS-ON-REVERT: removing `plan={planPlate}` from CuratedExperienceSwipeCard,
 * the `planEstimateLabel` branch of aiPlanPriceLabel, PlanPrices, or the
 * label's `flexShrink` in pinnedPrimary.ts fails here.
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

const designSystem = require("../../../constants/designSystem");
const { CuratedExperienceSwipeCard } = require("../../CuratedExperienceSwipeCard");
const { DeckCardPlate, CardStateDiscs, platePresentation } = require("../../deckCardPlate");
const { DeckTextColumn, HostChip, PhotoPagerBars, PhotoCapsule, NoPhotoFill } = require("../DeckCardChrome");
const { curatedDeckPhotos, experienceDeckPhotos, placeFactSpans } = require("../deckCardModel");
const { SkeletonCard } = require("../../SkeletonCard");
const CI = require("../../../../../packages/card-identity/index.js");

type Node = import("react-test-renderer").ReactTestInstance;

function mount(element: React.ReactElement) {
  let root: import("react-test-renderer").ReactTestRenderer | null = null;
  TestRenderer.act(() => {
    root = TestRenderer.create(element);
  });
  return root!;
}
// react-native-web: the composite element keeps `testID` / `style` / a11y
// props; its host <div> carries the compiled attributes. Read the composite.
const isComposite = (n: Node) => typeof n.type !== "string";
const byTestId = (root: { root: Node }, id: string) => root.root.findAll((n: Node) => n.props?.testID === id && isComposite(n));
const allText = (root: { root: Node }) =>
  root.root
    .findAll((n: Node) => typeof n.props?.children === "string" || typeof n.props?.children === "number")
    .map((n: Node) => String(n.props.children));
const flat = (style: unknown): Record<string, unknown> =>
  Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {});

const { PlanPrices, PlanConditions } = require("../../expandedCard/PlanSections");
const { pinnedPrimaryStyles } = require("../../expandedCard/pinnedPrimary");
const { PLAN_SHEET } = require("../../expandedCard/spineTokens");

// The Abuja plan from Seth's screenshot: an add-on florist, a gallery, The Burgundy.
const BURGUNDY = {
  placeName: "The Burgundy by Chef Stone",
  imageUrl: "https://cdn/burgundy.jpg",
  optional: false,
  placeType: "upscale_fine_dining",
  priceMin: 100000,
  priceMax: 100000,
  priceOpenEnded: true,
  priceCurrency: "NGN",
  priceLevel: "PRICE_LEVEL_VERY_EXPENSIVE",
};
const ABUJA_STOPS = [
  { placeName: "Petals & More", imageUrl: "https://cdn/petals.jpg", optional: true, placeType: "flowers", priceMin: 0, priceMax: 0, priceCurrency: null, priceLevel: null },
  { placeName: "Nike Art Gallery, Abuja", imageUrl: "https://cdn/nike.jpg", optional: false, placeType: "creative_arts", priceMin: 0, priceMax: 0, priceCurrency: null, priceLevel: null, travelTimeFromUserMin: 6 },
  BURGUNDY,
];
const ABUJA_PLAN = {
  id: "plan-abuja",
  cardType: "curated",
  title: "Gallery to dinner in Central Abuja",
  experienceType: "romantic",
  estimatedDurationMinutes: 153,
  totalPriceMin: 100000,
  totalPriceMax: 100000,
  stops: ABUJA_STOPS,
};

describe("#4347 round 2 — the collapsed plan plate (Direction B)", () => {
  test("RR-1 route, stop photos and Time / Away / Spend, with the real naira estimate", () => {
    const root = mount(<CuratedExperienceSwipeCard card={ABUJA_PLAN} currencyCode="NGN" photos={curatedDeckPhotos(ABUJA_STOPS)} />);
    expect(byTestId(root, "deck-plan-plate")).toHaveLength(1);
    const text = allText(root);
    expect(text).toEqual(expect.arrayContaining([
      "Nike Art Gallery, Abuja → The Burgundy by Chef Stone",
      "Time", "2h 33m", "Away", "6 min", "Spend", "₦100,000+",
    ]));
    expect(text).not.toContain("Upscale");
    // The add-on is not in the route, and the old fact line is gone.
    expect(text.some((s) => s.includes("Petals"))).toBe(false);
    expect(text).not.toContain("2 stops");
  });

  test("RR-2 a dollar viewer sees the converted estimate", () => {
    const root = mount(<CuratedExperienceSwipeCard card={ABUJA_PLAN} currencyCode="USD" photos={[]} />);
    expect(allText(root)).toContain("≈ $74+");
  });

  test("RR-3 a paying stop with no price falls back to Google's spend level", () => {
    const bar = { placeName: "Bar Nine", optional: false, placeType: "drinks_and_music", priceMin: 0, priceMax: 0, priceCurrency: null, priceLevel: "PRICE_LEVEL_MODERATE" };
    const root = mount(<CuratedExperienceSwipeCard card={{ ...ABUJA_PLAN, stops: [...ABUJA_STOPS, bar] }} currencyCode="NGN" photos={[]} />);
    const text = allText(root);
    expect(text).toContain("Upscale");
    expect(text.some((s) => s.includes("₦"))).toBe(false);
  });

  test("RR-4 Details is the wide filled control; a host experience keeps its own plate", () => {
    const details = jest.fn();
    const root = mount(<CuratedExperienceSwipeCard card={ABUJA_PLAN} currencyCode="NGN" photos={[]} onDetailsPress={details} detailsLabel="Details" />);
    const button = byTestId(root, "deck-plan-details")[0];
    expect(flat(button.props.style({ pressed: false })).flex).toBe(1);
    TestRenderer.act(() => button.props.onPress());
    expect(details).toHaveBeenCalledTimes(1);
    const host = mount(
      <CuratedExperienceSwipeCard
        card={{ ...ABUJA_PLAN, cardType: "experience", currency: "NGN" }}
        brandExperience={{ brandName: "Lekki Walks", brandLogoUrl: null }}
        currencyCode="NGN"
        photos={[]}
      />,
    );
    expect(byTestId(host, "deck-plan-plate")).toHaveLength(0);
  });
});

describe("#4347 round 2 — the plan sheet", () => {
  test("RR-5 Price per stop renders its rows and note; nothing when there are no rows", () => {
    const rows = [
      { key: "1", label: "1 · Nike Art Gallery, Abuja", value: "No price listed" },
      { key: "2", label: "2 · The Burgundy by Chef Stone", value: "₦100,000+ pp" },
    ];
    const root = mount(<PlanPrices title="Price per stop" rows={rows} note="Google's per-person estimates." />);
    expect(allText(root)).toEqual(expect.arrayContaining(["Price per stop", "2 · The Burgundy by Chef Stone", "₦100,000+ pp", "Google's per-person estimates."]));
    // The value stays beside a long label.
    const row = byTestId(root, "plan-price-row-2")[0];
    expect(flat(row.props.style).flexWrap).toBe("nowrap");
    const empty = mount(<PlanPrices title="Price per stop" rows={[]} note="x" />);
    expect(byTestId(empty, "plan-prices")).toHaveLength(0);
  });

  test("RR-6 a long conditions row keeps its weather on the same line", () => {
    const rows = [{ key: "0", label: "Petals & More - Flowers & Gifts (Fresh Flowers) (add-on), 8pm", value: "84°F · quiet" }];
    const root = mount(<PlanConditions title="Conditions at your stops" rows={rows} note="n" />);
    expect(flat(byTestId(root, "plan-conditions-row-0")[0].props.style).flexWrap).toBe("nowrap");
  });

  test("RR-7 the pinned primary label shrinks inside its button; the stepper is solid", () => {
    expect(flat(pinnedPrimaryStyles.label).flexShrink).toBe(1);
    expect(flat(pinnedPrimaryStyles.button).minWidth).toBe(0);
    expect(PLAN_SHEET.navFill).toBe("#FFFFFF");
  });
});
