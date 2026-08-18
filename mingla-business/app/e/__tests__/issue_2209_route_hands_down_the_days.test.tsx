/**
 * issue #2209 — THE PUBLIC ROUTE MUST HAND THE EVENT'S DAYS TO THE PAGE.
 *
 * ══ THE DEFECT THIS FILE PINS ══════════════════════════════════════════════
 * `/e/{brandSlug}/{eventSlug}` is the ONLY production mount of the buyer-web
 * `PublicEventPage`. Since #2160 the detail it renders has carried
 * `occurrences` (every materialised `event_dates` row) and
 * `multiDatePricingMode`, and #2160 also moved the occurrence read OUT of the
 * component — #2135's version fetched them itself; #2160's takes them as a
 * PROP, defaulting to an empty list.
 *
 * Nothing ever passed that prop. The result on the live page
 * (host.usemingla.com/e/minglanigeria/we-go-again-two-day-demo, a signed-out
 * guest, measured on 2026-08-18) was:
 *
 *     Date TBD
 *     Multi-date (no dates yet)
 *
 * with no day picker, on an event with two confirmed `event_dates` rows that
 * the RPC returned correctly. The days reached the route and stopped there.
 *
 * ══ WHY THE ASSERTION IS ON THE ROUTE, NOT ON THE PAGE ═════════════════════
 * A page-level test cannot see this bug: the page renders correctly WHEN it is
 * given the days, and #2135's suite passes it the prop by hand. The only place
 * the wire was cut is the route, so the route is where the proof has to be.
 *
 * FAILS-ON-REVERT: delete the `occurrences={...}` / `multiDatePricingMode={...}`
 * lines from app/e/[brandSlug]/[eventSlug].tsx and R-1/R-2/R-3 go red.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Renderer = { unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

// What the route hands down, captured at the seam.
let captured: Record<string, unknown> | null = null;

let queryResult: Record<string, unknown> = {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({
    brandSlug: "minglanigeria",
    eventSlug: "we-go-again-two-day-demo",
  }),
}));
jest.mock("../../../src/hooks/usePublicEvents", () => ({
  usePublicEventBySlug: () => queryResult,
}));
jest.mock("../../../src/components/event/PublicEventPage", () => ({
  PublicEventPage: (props: Record<string, unknown>) => {
    captured = props;
    return null;
  },
}));
jest.mock("../../../src/components/event/PublicEventNotFound", () => ({
  PublicEventNotFound: () => null,
}));
jest.mock("../../../src/analytics/webAnalytics", () => ({
  captureAdClickIds: jest.fn(),
  captureWeb: jest.fn(),
  fireAdPageView: jest.fn(),
  fireAdViewContent: jest.fn(),
}));

import PublicEventRoute from "../[brandSlug]/[eventSlug]";

const OCC_DAY_ONE = "occ-2209-day-one";
const OCC_DAY_TWO = "occ-2209-day-two";

const TWO_DAYS = [
  {
    id: OCC_DAY_ONE,
    startAt: "2026-08-22T10:00:00.000Z",
    endAt: "2026-08-22T17:00:00.000Z",
    timezone: "Africa/Lagos",
    isMaster: true,
    ticketsRemaining: null,
  },
  {
    id: OCC_DAY_TWO,
    startAt: "2026-08-23T10:00:00.000Z",
    endAt: "2026-08-23T17:00:00.000Z",
    timezone: "Africa/Lagos",
    isMaster: false,
    ticketsRemaining: null,
  },
];

const detail = (
  occurrences: unknown[],
  multiDatePricingMode: string,
): Record<string, unknown> => ({
  isLoading: false,
  isFetching: false,
  isError: false,
  data: {
    event: { id: "evt-2209", name: "We Go Again — Two Day Demo" },
    brand: { id: "brand-2209", slug: "minglanigeria" },
    tickets: [],
    bookable: true,
    occurrences,
    multiDatePricingMode,
  },
});

let mounted: Renderer[] = [];
const mount = async (): Promise<void> => {
  await act(async () => {
    mounted.push(TestRenderer.create(<PublicEventRoute />));
  });
};

beforeEach(() => {
  captured = null;
  queryResult = detail(TWO_DAYS, "per_day");
});

afterEach(async () => {
  for (const tree of mounted) await act(async () => tree.unmount());
  mounted = [];
});

describe("issue #2209 — the route hands the event's days to the page", () => {
  test("R-1 EVERY occurrence on the detail reaches PublicEventPage", async () => {
    await mount();
    expect(captured).not.toBeNull();
    const occurrences = (captured as Record<string, unknown>).occurrences as
      | Array<{ id: string }>
      | undefined;
    // The whole defect in one assertion: this was `undefined` (prop never
    // passed), so the component defaulted to the shared empty list and the
    // chooser had nothing to render.
    expect(Array.isArray(occurrences)).toBe(true);
    expect((occurrences ?? []).map((o) => o.id)).toEqual([
      OCC_DAY_ONE,
      OCC_DAY_TWO,
    ]);
  });

  test("R-2 the organiser's pricing mode reaches it too, unaltered", async () => {
    queryResult = detail(TWO_DAYS, "all_days");
    await mount();
    expect((captured as Record<string, unknown>).multiDatePricingMode).toBe(
      "all_days",
    );
  });

  test("R-3 the occurrence list is passed BY REFERENCE, not re-derived", async () => {
    // A route that rebuilt the array (mapping, filtering, sorting) would be a
    // second projection of the same concept — exactly the class of drift #2209
    // exists to close. Identity is the cheapest way to prove there is none.
    const source = queryResult.data as { occurrences: unknown };
    await mount();
    expect((captured as Record<string, unknown>).occurrences).toBe(
      source.occurrences,
    );
  });

  test("R-4 the pre-existing props are untouched", async () => {
    await mount();
    const props = captured as Record<string, unknown>;
    expect((props.event as { id: string }).id).toBe("evt-2209");
    expect((props.brand as { id: string }).id).toBe("brand-2209");
    expect(props.bookable).toBe(true);
  });
});
