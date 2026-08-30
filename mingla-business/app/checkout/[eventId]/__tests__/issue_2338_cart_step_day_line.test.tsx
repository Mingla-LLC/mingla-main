/**
 * issue #2338 — THE CART STEP AND THE ORDER SUMMARY MUST WORD THE SAME DAY
 * THE SAME WAY, AND NEITHER MAY SAY "Date TBD" ABOUT A DAY THAT EXISTS.
 *
 * ══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════
 * #2160 taught step 1 of 3 to name the chosen day(s) — but it did it with a
 * PRIVATE `chosenDayLabel` useMemo inside this route file, a fourth date
 * formatter outside the I-14 owner. That is the whole reason the confirmation
 * screen two steps later could not reuse it and printed "Date TBD" over the
 * founder's own two-day order (#2338). Lifting the wording into
 * `eventDateDisplay.ts` is the fix; this file is the runtime proof that the
 * lift did not change what step 1 says, and that its own "Date TBD" hole is
 * closed too.
 *
 * That second half is a REAL defect this issue found and was not asked about:
 * a bare `/checkout/{eventId}` link — no `eventDateIds` — on a published
 * multi-date event ALSO rendered "Date TBD" on the cart step, because the
 * fallback was `formatDraftDateLine(event)` and the public reader strips the
 * organiser's draft days. Same cause, one step earlier, and it is reachable by
 * anyone who shares a checkout URL without the day set.
 *
 * ══ WHAT IS PROVED (mounting the REAL cart screen) ═════════════════════════
 *   K-1  two chosen days read "Sat 29 Aug + Sun 30 Aug" — the wording #2338's
 *        order summary now matches, asserted here against the SAME constant
 *   K-2  LOAD-BEARING — withhold the occurrences and the line stops naming a
 *        day, even though the ids are still in the URL
 *   K-3  the bare link (no chosen days) names the event's REAL first day
 *        instead of "Date TBD"
 *   K-4  HONEST DEGRADE — no occurrences AND no chosen days → "Date TBD"
 *   K-5  a SINGLE-date event's line is byte-identical to
 *        `formatDraftDateLine(event)`
 *
 * FAILS-ON-REVERT: restore the private `chosenDayLabel` useMemo with its
 * `?? formatDraftDateLine(event)` fallback and K-3 goes red; pass `[]` for the
 * occurrences and K-1 goes red while K-4/K-5 stay green.
 *
 * Owner: mingla-implementor. Issue: #2338.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Renderer = {
  root: {
    findAllByProps: (p: Record<string, unknown>) => Array<{
      props: Record<string, unknown>;
    }>;
  };
  toJSON: () => unknown;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const EVENT_ID = "2b05b5df-b8a0-4192-beb6-bc16111a2d85";

// The REAL production occurrences (pg_direct_event_checkout_bundle, 2026-08-19).
const DAY_29 = {
  id: "0870ce30-0671-4cc0-b7c2-87412cb76ef9",
  startAt: "2026-08-29T10:00:00+00:00",
  endAt: "2026-08-29T17:00:00+00:00",
  timezone: "Africa/Lagos",
  isMaster: true,
  ticketsRemaining: null,
};
const DAY_30 = {
  id: "a607a1d3-7525-400f-9772-6abbd16b52fe",
  startAt: "2026-08-30T10:00:00+00:00",
  endAt: "2026-08-30T17:00:00+00:00",
  timezone: "Africa/Lagos",
  isMaster: false,
  ticketsRemaining: null,
};

const FREE_TIER = {
  id: "tt-free-entry",
  name: "Free Entry",
  priceGbp: null,
  currency: "NGN",
  capacity: null,
  isFree: true,
  isUnlimited: true,
  visibility: "public",
  displayOrder: 0,
  availableAt: "online",
  saleStartAt: null,
  saleEndAt: null,
  waitlistEnabled: false,
};

const TWO_DAY_EVENT = {
  id: EVENT_ID,
  name: "We Go Again — Two Day Free",
  brandSlug: "minglanigeria",
  eventSlug: "we-go-again-two-day-free",
  currency: "NGN",
  themeOverrides: null,
  tickets: [FREE_TIER],
  coverHue: 24,
  coverMediaUrl: null,
  coverMediaType: null,
  status: "scheduled",
  // `isEventPast` reads `endedAt !== null`, so an UNDEFINED field here would
  // silently classify this event as over and render the sold-out empty state
  // instead of the mini-card. Explicit null, deliberately.
  endedAt: null,
  cancelledAt: null,
  whenMode: "multi_date",
  date: "2026-08-29",
  doorsOpen: "11:00",
  endsAt: "18:00",
  // Far enough out that `isEventPast` can never flip this suite by calendar.
  masterStartAtUtc: "2099-08-29T10:00:00+00:00",
  masterEndAtUtc: "2099-08-29T17:00:00+00:00",
  timezone: "Africa/Lagos",
  recurrenceRule: null,
  multiDates: null,
};

const SINGLE_DATE_EVENT = {
  ...TWO_DAY_EVENT,
  id: "single-2338",
  name: "Lagos One Night",
  whenMode: "single",
  date: "2099-09-12",
  doorsOpen: "20:00",
  endsAt: "23:00",
  masterStartAtUtc: null,
  masterEndAtUtc: null,
};

// Lifecycle truth is intentionally separate from the display occurrences used by
// K-1 through K-5. Every populated public-event fixture stays active regardless
// of the wall clock without changing the date-line inputs those tests exercise.
const CHECKOUT_TERMINAL_SOURCE = {
  kind: "occurrences" as const,
  value: [
    {
      id: "lifecycle-2338",
      startAt: "2099-08-29T10:00:00+00:00",
      endAt: "2099-08-29T17:00:00+00:00",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
  ],
};

let publicEventData: unknown = null;
let routeParams: Record<string, string> = { eventId: EVENT_ID };

const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com" },
    },
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => routeParams,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Path: () => null, Circle: () => null }),
  { virtual: true },
);
jest.mock("../../../../src/hooks/usePublicEvents", () => ({
  usePublicEventById: () => ({
    data:
      publicEventData === null
        ? null
        : {
            ...(publicEventData as Record<string, unknown>),
            terminalSource: CHECKOUT_TERMINAL_SOURCE,
          },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/analytics/webAnalytics", () => ({
  captureWeb: jest.fn(),
  gaEvent: jest.fn(),
}));
jest.mock("../../../../src/components/ui/EventCoverMedia", () => ({
  EventCoverMedia: () => null,
}));
jest.mock("../../../../src/components/ui/EmptyState", () => ({
  EmptyState: () => null,
}));
jest.mock("../../../../src/components/ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (props: { label: string; onPress?: () => void }) => (
      <Pressable accessibilityLabel={props.label} onPress={props.onPress} />
    ),
  };
});
jest.mock("../../../../src/components/checkout/CheckoutHeader", () => ({
  CheckoutHeader: () => null,
}));
jest.mock("../../../../src/components/checkout/QuantityRow", () => ({
  QuantityRow: () => null,
}));
jest.mock("../../../../src/components/waitlist/JoinWaitlistSheet", () => ({
  JoinWaitlistSheet: () => null,
}));

import { CartProvider } from "../../../../src/components/checkout/CartContext";
import { formatDraftDateLine } from "../../../../src/utils/eventDateDisplay";
import CartScreen from "../index";

/** The exact string #2338's order summary renders for the same selection. */
const BOTH_DAYS = "Sat 29 Aug + Sun 30 Aug";

const cartDateLine = (tree: Renderer): string => {
  const nodes = tree.root.findAllByProps({
    testID: "issue-2338-cart-date-line",
  });
  if (nodes.length === 0) {
    throw new Error(
      "cart mini-card date line not rendered; tree=" +
        JSON.stringify((tree as unknown as { toJSON: () => unknown }).toJSON()),
    );
  }
  const children = nodes[nodes.length - 1].props.children;
  return (Array.isArray(children) ? children : [children])
    .map((c) => String(c))
    .join("");
};

const mount = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <CartScreen />
      </CartProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
};

describe("issue #2338 — the cart step's day line", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    routeParams = {
      eventId: EVENT_ID,
      eventDateIds: `${DAY_29.id},${DAY_30.id}`,
    };
    publicEventData = {
      event: TWO_DAY_EVENT,
      brand: { displayName: "Mingla Nigeria", theme: null },
      occurrences: [DAY_29, DAY_30],
      multiDatePricingMode: "per_day",
    };
  });

  test("K-1 two chosen days read exactly what the order summary now reads", async () => {
    const tree = await mount();
    expect(cartDateLine(tree)).toBe(`Mingla Nigeria · ${BOTH_DAYS}`);
    await act(async () => tree.unmount());
  });

  test("K-2 LOAD-BEARING: withhold the occurrences and the ids alone name nothing", async () => {
    publicEventData = {
      event: TWO_DAY_EVENT,
      brand: { displayName: "Mingla Nigeria", theme: null },
      occurrences: [],
      multiDatePricingMode: "per_day",
    };
    const tree = await mount();
    expect(cartDateLine(tree)).not.toContain(BOTH_DAYS);
    expect(cartDateLine(tree)).toBe("Mingla Nigeria · Date TBD");
    await act(async () => tree.unmount());
  });

  test("K-3 a bare /checkout link names the event's REAL first day, not 'Date TBD'", async () => {
    routeParams = { eventId: EVENT_ID };
    const tree = await mount();
    const line = cartDateLine(tree);
    expect(line).not.toContain("Date TBD");
    expect(line).toBe("Mingla Nigeria · Sat 29 Aug · 11:00 AM – 6:00 PM");
    await act(async () => tree.unmount());
  });

  test("K-4 HONEST DEGRADE: no days anywhere still says 'Date TBD'", async () => {
    routeParams = { eventId: EVENT_ID };
    publicEventData = {
      event: TWO_DAY_EVENT,
      brand: { displayName: "Mingla Nigeria", theme: null },
      occurrences: [],
      multiDatePricingMode: "per_day",
    };
    const tree = await mount();
    expect(cartDateLine(tree)).toBe("Mingla Nigeria · Date TBD");
    await act(async () => tree.unmount());
  });

  test("K-5 a SINGLE-date event's line is byte-identical to the old expression", async () => {
    routeParams = { eventId: EVENT_ID };
    publicEventData = {
      event: SINGLE_DATE_EVENT,
      brand: { displayName: "Mingla Nigeria", theme: null },
      occurrences: [],
      multiDatePricingMode: "per_day",
    };
    const tree = await mount();
    expect(cartDateLine(tree)).toBe(
      `Mingla Nigeria · ${formatDraftDateLine(SINGLE_DATE_EVENT as never)}`,
    );
    await act(async () => tree.unmount());
  });
});
