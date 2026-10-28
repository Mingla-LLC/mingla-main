/**
 * Issue #2829 W4 — the trip guide on the shared trip page.
 *
 * `packages/offering-rendering/TripOfferingBody.tsx` is THE trip page body on
 * every surface (consumer iOS/Android, Business iOS/Android, buyer web). The
 * guide (highlights, what to prepare, good to know, FAQs, group size,
 * activity level) is ADDED to it, never replacing an existing section.
 *
 * 1. A trip WITHOUT a guide renders byte-identically to before: the rendered
 *    tree is compared with a snapshot captured from the body BEFORE the guide
 *    sections existed (`__snapshots__/issue_2829_trip_guide_body.test.tsx.snap`).
 * 2. A trip WITH a guide shows each section it has, in order, after the
 *    existing itinerary and inclusions and before the cancellation policy —
 *    and the existing sections are all still there, in their locked order.
 * 3. Missing sections are hidden, never filled in (Constitution 9).
 *
 * HOW: the REAL body source is compiled with the TypeScript compiler and
 * mounted against an explicit module boundary (the #3801 / #1780 pattern):
 * pure helpers are real; leaf components are named stubs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import React from "react";
import ts from "typescript";

import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: (TestInstance | string)[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  toJSON: () => unknown;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => void) => void;
};

const PACKAGE = path.resolve(__dirname, "..", "..", "..", "..", "..", "packages", "offering-rendering");
const BODY_FILE = path.join(PACKAGE, "TripOfferingBody.tsx");

const leaf = (name: string) => {
  const Leaf = (props: Record<string, unknown>): React.ReactElement =>
    React.createElement(name, { testID: props.testID }, props.children as React.ReactNode);
  Leaf.displayName = name;
  return Leaf;
};

const BOUNDARY: Record<string, () => unknown> = {
  react: () => React,
  "react-native": () => jest.requireActual("react-native"),
  "./themePalette": () => jest.requireActual("@mingla/offering-rendering/themePalette"),
  "./designTokens": () => ({}),
  "./EventCoverMedia": () => ({ EventCoverMedia: leaf("EventCoverMedia") }),
  "./ChipGroup": () => ({ ChipGroup: leaf("ChipGroup") }),
  "./DayByDay": () => ({ DayByDay: leaf("DayByDay") }),
  "./LazyOfferingRefundLadder": () => ({
    LazyOfferingRefundLadder: leaf("TripRefundLadder"),
    LazySaleAvailabilityText: leaf("SaleAvailabilityText"),
  }),
  "./TripPaymentChoice": () => ({ TripPaymentChoice: leaf("TripPaymentChoice") }),
  "./TripCountdownPill": () => ({ TripCountdownPill: leaf("TripCountdownPill") }),
  "./LucideIcons": () =>
    new Proxy({}, { get: (_target, name) => leaf(`Icon.${String(name)}`) }),
  "./PresentedByFollowerCount": () => ({ PresentedByFollowerCount: leaf("PresentedByFollowerCount") }),
  "./OfferingMomentum": () => ({ OfferingMomentum: leaf("OfferingMomentum") }),
  "./socialProofTypes": () => ({}),
  "./mapboxStaticImage": () => ({ buildStaticMapUrl: () => "https://map.fixture/static.png" }),
  "./tripOfferingTypes": () => ({}),
  "./useTripOfferingState": () => jest.requireActual("@mingla/offering-rendering/useTripOfferingState"),
  "./tripGuide": () => jest.requireActual("@mingla/offering-rendering/tripGuide"),
};

type BodyModule = { TripOfferingBody: React.ComponentType<Record<string, unknown>> };

function loadBody(): BodyModule {
  const output = ts.transpileModule(fs.readFileSync(BODY_FILE, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const boundaryRequire = (specifier: string): unknown => {
    const supply = BOUNDARY[specifier];
    if (supply !== undefined) return supply();
    throw new Error(`Unclassified TripOfferingBody boundary: ${specifier}`);
  };
  const module = { exports: {} as BodyModule };
  new Function("require", "module", "exports", output)(boundaryRequire, module, module.exports);
  return module.exports;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const palettes = require("@mingla/offering-rendering/themePalette") as {
  createThemePalette: (theme: Record<string, string>) => Record<string, string>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stateModule = require("@mingla/offering-rendering/useTripOfferingState") as {
  useTripOfferingState: (input: Record<string, unknown>) => Record<string, unknown>;
};

const THEME = { color: "#eb7825", font: "inter", animation: "none" };

const baseData = (): Record<string, unknown> => ({
  id: "trip-2829",
  title: "Albania coast",
  description: "Eight days along the Albanian Riviera with a small group.",
  startAt: "2026-06-28T08:00:00.000Z",
  endAt: "2026-07-02T18:00:00.000Z",
  durationLabel: "5 days · 4 nights",
  dateRangeLabel: "Jun 28 – Jul 2, 2026",
  departureCityCountry: "Tirana, Albania",
  destinationCityCountry: "Sarandë, Albania",
  destinationText: "Sarandë",
  spotsLabel: "4 seats left · 16 max",
  bookingDeadlineIso: null,
  days: [{ id: "d1", ordinal: 1, title: "Arrive", narrative: "Meet in Tirana.", date: null, media: [] }],
  inclusions: [
    { id: "i1", kind: "included", item: "Lodging" },
    { id: "i2", kind: "excluded", item: "Flights" },
  ],
  refundPolicy: null,
  tiers: [{
    id: "t1", ticketTypeId: "tt1", tierName: "Shared room", priceCents: 180000, currency: "USD",
    isFree: false, isUnlimited: false, ticketsRemaining: 4, installmentSchedule: null,
  }],
  currency: "USD",
  destinationLat: null,
  destinationLng: null,
  bookable: true,
  bookingsClosed: false,
});

const brand = {
  id: "b1", slug: "young-and-stamped", name: "Young & Stamped", bio: null,
  coverMediaUrl: null, coverMediaType: null, coverHue: null, verified: false,
};

function render(data: Record<string, unknown>, extra: Record<string, unknown> = {}): Renderer {
  const { TripOfferingBody } = loadBody();
  const palette = palettes.createThemePalette(THEME);
  const Harness = (): React.ReactElement => {
    const state = stateModule.useTripOfferingState({
      data, paymentPlanChoice: "full", onReserve: () => undefined, now: new Date("2026-06-01T00:00:00Z"),
    });
    return React.createElement(TripOfferingBody, {
      data, brand, palette, theme: THEME, state, callbacks: { onReserve: () => undefined },
      variant: "phone", paymentPlanChoice: "full", onPaymentPlanChoiceChange: () => undefined, ...extra,
    });
  };
  let renderer: Renderer | null = null;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(Harness));
  });
  return renderer as unknown as Renderer;
}

const testIds = (renderer: Renderer): string[] =>
  renderer.root
    .findAll((node) => typeof node.props.testID === "string" && typeof node.type === "string")
    .map((node) => node.props.testID as string)
    .filter((id, index, all) => all.indexOf(id) === index);

const textOf = (renderer: Renderer): string => JSON.stringify(renderer.toJSON());

describe("#2829 trip guide on the shared trip body", () => {
  test("a trip without a guide renders exactly as before", () => {
    for (const guide of [undefined, null]) {
      const data = baseData();
      if (guide !== undefined) data.guide = guide;
      const renderer = render(data);
      expect(renderer.toJSON()).toMatchSnapshot("trip without a guide");
      TestRenderer.act(() => renderer.unmount());
    }
  });

  test("a full guide adds its sections after the itinerary and inclusions, before the cancellation policy", () => {
    const data = baseData();
    data.guide = {
      highlights: ["Swim at Ksamil", "Butrint ruins"],
      whatToPrepare: "Reef-safe sunscreen and water shoes.",
      goodToKnow: "Euros and lek are both accepted.",
      faqs: [{ question: "Is it beginner friendly?", answer: "Yes, walks are short." }],
      activityLevel: "moderate",
      groupSizeLabel: "Group size 6–16",
    };
    const renderer = render(data);
    const ids = testIds(renderer);
    const order = [
      "trip-body-about",
      "trip-body-guide-highlights",
      "trip-body-itinerary",
      "trip-body-included",
      "trip-body-excluded",
      "trip-body-guide-prepare",
      "trip-body-guide-good-to-know",
      "trip-body-guide-faqs",
      "trip-body-cancellation",
      "trip-body-pay-box",
    ];
    const positions = order.map((id) => ids.indexOf(id));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    const text = textOf(renderer);
    for (const words of ["Highlights", "Swim at Ksamil", "What to prepare", "Reef-safe sunscreen", "Good to know",
      "Euros and lek", "Questions", "Is it beginner friendly?", "Group size 6–16", "Moderate"]) {
      expect(text).toContain(words);
    }
    // Every existing section is still there.
    for (const id of ["trip-body-title", "trip-body-route-pills", "trip-body-meta-pills", "trip-body-presented-by"]) {
      expect(ids).toContain(id);
    }
  });

  test("FAQ answers open on tap (no dead tap) and only sections with content show", () => {
    const data = baseData();
    data.guide = {
      highlights: [], whatToPrepare: null, goodToKnow: null,
      faqs: [{ question: "Visa?", answer: "Not for most passports." }],
      activityLevel: null, groupSizeLabel: null,
    };
    // reduceMotion: the test renderer has no LayoutAnimation presets.
    const renderer = render(data, { reduceMotion: true });
    const ids = testIds(renderer);
    expect(ids).toContain("trip-body-guide-faqs");
    for (const absent of ["trip-body-guide-highlights", "trip-body-guide-prepare", "trip-body-guide-good-to-know", "trip-body-guide-group"]) {
      expect(ids).not.toContain(absent);
    }
    expect(textOf(renderer)).not.toContain("Not for most passports.");
    const toggle = renderer.root.findAll((node) => node.props.testID === "trip-body-guide-faq-0" && typeof node.props.onPress === "function")[0]!;
    TestRenderer.act(() => {
      (toggle.props.onPress as () => void)();
    });
    expect(textOf(renderer)).toContain("Not for most passports.");
  });
});
