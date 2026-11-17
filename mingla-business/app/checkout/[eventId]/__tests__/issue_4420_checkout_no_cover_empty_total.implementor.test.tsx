/**
 * #4420 web journey (shot 34) — checkout's first step showed the authoring
 * placeholder (orange stripes) above the tickets when the event had no
 * cover, while the event's public page shows the host's own colour; and the
 * Total row of an empty cart was a lone dash that read as a bar.
 *
 * WHAT THIS FILE PROVES (mounting the REAL cart screen, harness from #2338)
 *   NC-1 no cover: the host-colour band draws, never the striped placeholder.
 *   NC-2 a cover: the cover draws as before.
 *   NC-3 an empty cart's Total reads zero in the event's currency, never "—".
 *   NC-4 the band's stops follow the host palette (gradient, else single
 *        colour fading), the same rule as the public page.
 *
 * FAILS-ON-REVERT: restore the unconditional EventCoverMedia and the "—"
 * Total in app/checkout/[eventId]/index.tsx and NC-1 / NC-3 go red.
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

let checkoutTerminalSource:
  | typeof CHECKOUT_TERMINAL_SOURCE
  | { kind: "occurrences"; value: [] } = CHECKOUT_TERMINAL_SOURCE;
let publicEventData: unknown = null;
let routeParams: Record<string, string> = { eventId: EVENT_ID };
type CapturedEmptyStateProps = {
  title?: unknown;
  description?: unknown;
  cta?: { label?: unknown };
};
let capturedEmptyStateProps: CapturedEmptyStateProps | null = null;

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
            terminalSource: checkoutTerminalSource,
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
jest.mock("@mingla/offering-rendering", () => ({
  ...jest.requireActual("../../../../__manual_mocks__/offering-rendering.js"),
  ...jest.requireActual(
    "../../../../../packages/offering-rendering/eventAcquisitionLifecycle",
  ),
}));
jest.mock("../../../../src/components/ui/EventCoverMedia", () => {
  const ReactLocal = require("react");
  return {
    EventCoverMedia: (props: Record<string, unknown>) =>
      ReactLocal.createElement("MockEventCoverMedia", props),
  };
});
jest.mock("../../../../src/components/ui/EmptyState", () => ({
  EmptyState: (props: CapturedEmptyStateProps) => {
    capturedEmptyStateProps = props;
    return null;
  },
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
import { checkoutCoverFallbackStops } from "../../../../src/components/checkout/CheckoutCoverFallback";
import { formatCurrency } from "../../../../src/utils/currency";
import CartScreen from "../index";

const PAID_TIER = {
  ...FREE_TIER,
  id: "tt-paid-ga",
  name: "General Admission",
  priceGbp: 25,
  currency: "USD",
  isFree: false,
  isUnlimited: false,
  capacity: 100,
};
const USD_EVENT = { ...SINGLE_DATE_EVENT, currency: "USD", tickets: [PAID_TIER] };

type Node = { type: unknown; props: Record<string, unknown>; children?: unknown };
const all = (tree: Renderer): Node[] =>
  (tree.root as unknown as { findAll: (p: (n: Node) => boolean) => Node[] }).findAll(() => true);
const textContent = (node: unknown): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textContent((node as { children?: unknown }).children);
  }
  return "";
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

describe("#4420 checkout with no cover and an empty cart", () => {
  beforeEach(() => {
    checkoutTerminalSource = CHECKOUT_TERMINAL_SOURCE;
    routeParams = { eventId: EVENT_ID };
    publicEventData = {
      event: USD_EVENT,
      brand: { displayName: "Capture Co", theme: null },
      occurrences: [],
      multiDatePricingMode: "per_day",
    };
  });

  test("NC-1 no cover draws the host-colour band, never the striped placeholder", async () => {
    const tree = await mount();
    expect(all(tree).filter((n) => n.type === "MockEventCoverMedia")).toHaveLength(0);
    expect(all(tree).filter((n) => n.props.testID === "checkout-themed-cover").length).toBeGreaterThan(0);
    await act(async () => tree.unmount());
  });

  test("NC-2 a cover still draws the cover", async () => {
    publicEventData = {
      event: { ...USD_EVENT, coverMediaUrl: "https://example.test/cover.jpg", coverMediaType: "image" },
      brand: { displayName: "Capture Co", theme: null },
      occurrences: [],
      multiDatePricingMode: "per_day",
    };
    const tree = await mount();
    expect(all(tree).filter((n) => n.type === "MockEventCoverMedia").length).toBeGreaterThan(0);
    expect(all(tree).filter((n) => n.props.testID === "checkout-themed-cover")).toHaveLength(0);
    await act(async () => tree.unmount());
  });

  test("NC-3 an empty cart totals zero in the event's currency", async () => {
    const tree = await mount();
    const text = textContent(tree.toJSON());
    const zero = formatCurrency(0, "USD");
    expect(text).toContain(`Total${zero}`);
    expect(text).not.toContain("Total—");
    await act(async () => tree.unmount());
  });

  test("NC-4 the band follows the host palette like the public page", () => {
    const solid = { accent: "#336699" } as never;
    const [first, second] = checkoutCoverFallbackStops(solid);
    expect(first).toBe("#336699");
    expect(second).toMatch(/^rgba\(51, ?102, ?153, ?0\.72\)$/);
    const graphite = checkoutCoverFallbackStops(null);
    expect(graphite).toHaveLength(2);
  });
});
