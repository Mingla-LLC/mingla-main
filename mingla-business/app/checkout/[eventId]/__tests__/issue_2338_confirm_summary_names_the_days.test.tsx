/**
 * issue #2338 — THE ORDER SUMMARY MUST NAME THE DAYS THE GUEST BOUGHT.
 *
 * ══ WHAT THE FOUNDER SAW ═══════════════════════════════════════════════════
 * Production order `b19a9609-99ac-437d-ab08-f6b2ab99499b`, 2026-08-19, event
 * `2b05b5df` "We Go Again — Two Day Free". Six tickets minted, three per day,
 * across two `event_dates` rows (29 + 30 August) — #2160 working correctly.
 * The confirmation screen's order summary read:
 *
 *     We Go Again — Two Day Free
 *     Date TBD
 *
 * ══ WHY THIS FILE MOUNTS THE REAL SCREEN ═══════════════════════════════════
 * The defect was never in a formatter. `formatDraftDateLine` answered exactly
 * what it was given (`multiDates: null`, because `pg_direct_event_checkout_bundle`
 * strips the organiser's draft — VERIFIED against production). The defect was
 * that the SCREEN never handed it the days it already held. A unit test on the
 * helper cannot see that, so this file mounts `app/checkout/[eventId]/confirm`
 * inside the REAL `CartProvider`, seeds the cart the way the free reservation
 * path seeds it, and reads the string the guest reads.
 *
 * ══ WHAT IS PROVED ═════════════════════════════════════════════════════════
 *   S-1  the two-day free order's summary reads "Sat 29 Aug + Sun 30 Aug"
 *   S-2  LOAD-BEARING — the SAME cart and the SAME event with the occurrences
 *        withheld (the #2209 failure shape, exactly) stops naming any day. The
 *        rendered string is a function of data that must reach the screen, not
 *        a literal baked into it.
 *   S-3  LOAD-BEARING — the same cart with the CHOSEN SET withheld likewise
 *        stops naming the guest's days
 *   S-4  a SINGLE-date event's summary is byte-identical to
 *        `formatDraftDateLine(event)` — the exact expression the screen used
 *        before this change
 *   S-5  HONEST DEGRADE — a multi-date event with no materialised day still
 *        says "Date TBD"; no schedule is invented
 *   S-6  the legacy #2135 single `eventDateId` still names its one day
 *   S-7  the PAID WEB return leg (Stripe/Paystack redirect wipes the cart)
 *        restores the chosen days from the resume payload and names them
 *
 * FAILS-ON-REVERT, measured:
 *   - restore `{formatDraftDateLine(event)}` in the summary  → S-1, S-6, S-7 red
 *   - drop `occurrences` from the `resolveChosenDaysLine` call → S-1, S-6, S-7 red
 *   - drop `eventDateIds` from `CheckoutResumePayload`        → S-7 red alone
 *   and S-4 / S-5 stay green throughout, which is the shape of the claim.
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
const ORDER_ID = "b19a9609-99ac-437d-ab08-f6b2ab99499b";
const SESSION_ID = "e2295c1a-df1a-48e5-bc1f-3b49c380d51d";
const BUYER_TOKEN = "bst-2338";

// ── The REAL production rows, from `pg_direct_event_checkout_bundle` on
// 2026-08-19. Ids, instants and timezone verbatim. ─────────────────────────
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

/**
 * The event EXACTLY as the checkout bundle delivers it: multi_date with
 * `multiDates: null`, because the public reader strips the authoring block.
 */
const TWO_DAY_EVENT = {
  id: EVENT_ID,
  name: "We Go Again — Two Day Free",
  brandSlug: "minglanigeria",
  eventSlug: "we-go-again-two-day-free",
  currency: "NGN",
  themeOverrides: null,
  tickets: [],
  coverMediaUrl: null,
  coverMediaType: null,
  whenMode: "multi_date",
  date: "2026-08-29",
  doorsOpen: "11:00",
  endsAt: "18:00",
  masterStartAtUtc: "2026-08-29T10:00:00+00:00",
  masterEndAtUtc: "2026-08-29T17:00:00+00:00",
  timezone: "Africa/Lagos",
  recurrenceRule: null,
  multiDates: null,
};

/** An ordinary single-date event — the surface that must not move at all. */
const SINGLE_DATE_EVENT = {
  ...TWO_DAY_EVENT,
  id: "single-2338",
  name: "Lagos One Night",
  eventSlug: "lagos-one-night",
  whenMode: "single",
  date: "2026-09-12",
  doorsOpen: "20:00",
  endsAt: "23:00",
  masterStartAtUtc: null,
  masterEndAtUtc: null,
  multiDates: null,
};

/** Mutable so each case can hand the screen a different payload. */
let publicEventData: unknown = null;

const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const invoke = jest.fn();

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
  useNavigation: () => ({ addListener: () => () => undefined }),
  useLocalSearchParams: () => ({ eventId: EVENT_ID }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Path: () => null, Circle: () => null }),
  { virtual: true },
);
jest.mock("../../../../src/services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock("../../../../src/hooks/usePublicEvents", () => ({
  usePublicEventById: () => ({
    data: publicEventData,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/hooks/useOrderRealtimeSubscription", () => ({
  useOrderRealtimeSubscription: () => undefined,
}));
jest.mock("../../../../src/services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../../../src/analytics/webAnalytics", () => ({
  captureWeb: jest.fn(),
  fireAdPurchase: jest.fn(),
  gaEvent: jest.fn(),
  postAttributionConversion: jest.fn(),
  getStoredClickAttribution: () => ({ clickId: null }),
}));
jest.mock("../../../../src/analytics/phMask", () => ({ phMaskProps: () => ({}) }));
jest.mock("../../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../src/components/ui/GlassCard", () => {
  const { View } = require("react-native");
  return {
    GlassCard: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});
jest.mock("../../../../src/components/ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (props: { label: string; onPress?: () => void }) => (
      <Pressable accessibilityLabel={props.label} onPress={props.onPress} />
    ),
  };
});
jest.mock("../../../../src/components/checkout/TicketQrCarousel", () => ({
  TicketQrCarousel: () => null,
}));
jest.mock("../../../../src/components/checkout/DownloadMinglaCta", () => ({
  DownloadMinglaCta: () => null,
}));
jest.mock("../../../../src/components/checkout/AttendanceClaimAppIcon", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../../../src/services/attendanceClaimLinkService", () => ({
  createAttendanceClaimLink: jest.fn(() => Promise.resolve(null)),
}));
jest.mock("../../../../src/utils/attendanceClaimDeepLink", () => ({
  openAttendanceClaimWithFallback: jest.fn(),
}));

import {
  CartProvider,
  useCart,
} from "../../../../src/components/checkout/CartContext";
import {
  checkoutResumeStorageKey,
  type CheckoutResumePayload,
} from "../../../../src/components/checkout/checkoutPersistence";
import { formatDraftDateLine } from "../../../../src/utils/eventDateDisplay";
import ConfirmScreen from "../confirm";

// ── Seeding the cart the way the checkout funnel seeds it ──────────────────
// #2160's chosen day set lands in the cart on the CART step and rides through
// buyer → confirm in the same provider. This mounts a sibling that performs
// exactly those cart writes, so nothing about the cart is faked.
interface Seed {
  eventDateIds?: readonly string[];
  eventDateId?: string | null;
  quantity?: number;
}

function CartSeeder({ seed }: { seed: Seed }): null {
  const { setLineQuantity, setEventDateIds, setEventDateId, recordResult } =
    useCart();
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current) return;
    done.current = true;
    setLineQuantity({
      ticketTypeId: "tt-free-entry",
      ticketName: "Free Entry",
      unitPrice: 0,
      currency: "NGN",
      isFree: true,
      quantity: seed.quantity ?? 3,
    });
    if (seed.eventDateIds !== undefined) setEventDateIds(seed.eventDateIds);
    if (seed.eventDateId !== undefined) setEventDateId(seed.eventDateId);
    recordResult({
      orderId: ORDER_ID,
      ticketIds: ["t1", "t2", "t3", "t4", "t5", "t6"],
      checkoutSessionId: SESSION_ID,
      paidAt: "2026-08-19T09:00:00.000Z",
      paymentMethod: "free",
      total: 0,
      totalCents: 0,
      currency: "NGN",
      paymentStatus: "paid",
      notificationStatus: "queued",
      tickets: [],
    });
  }, [seed, setLineQuantity, setEventDateIds, setEventDateId, recordResult]);
  return null;
}

/** The one string this issue is about. */
const summaryDateLine = (tree: Renderer): string => {
  const nodes = tree.root.findAllByProps({
    testID: "issue-2338-summary-date-line",
  });
  if (nodes.length === 0) throw new Error("order summary date line not rendered");
  const children = nodes[nodes.length - 1].props.children;
  return Array.isArray(children) ? children.join("") : String(children);
};

const setLocationSearch = (search: string): void => {
  (globalThis as unknown as { location?: { search?: string } }).location = {
    search,
  } as never;
};

const mount = async (seed: Seed | null): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        {seed !== null ? <CartSeeder seed={seed} /> : null}
        <ConfirmScreen />
      </CartProvider>,
    );
  });
  await act(async () => {
    jest.advanceTimersByTime(10);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
};

describe("issue #2338 — the confirmation screen's order summary", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    invoke.mockReset();
    router.replace.mockReset();
    setLocationSearch("");
    publicEventData = { event: TWO_DAY_EVENT, brand: null, occurrences: [DAY_29, DAY_30] };
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("S-1 the founder's two-day free order names BOTH days", async () => {
    const tree = await mount({ eventDateIds: [DAY_29.id, DAY_30.id] });
    expect(summaryDateLine(tree)).toBe("Sat 29 Aug + Sun 30 Aug");
    expect(summaryDateLine(tree)).not.toBe("Date TBD");
    await act(async () => tree.unmount());
  });

  test("S-2 LOAD-BEARING: withhold the OCCURRENCES and the summary stops naming a day", async () => {
    // The #2209 failure shape, reproduced on this surface: the ids are correct
    // and present, the screen is simply not handed the days. If the rendered
    // string were a literal, or derived from anything other than the payload
    // this screen is handed, this case would still say "Sat 29 Aug + Sun 30 Aug".
    publicEventData = { event: TWO_DAY_EVENT, brand: null, occurrences: [] };
    const tree = await mount({ eventDateIds: [DAY_29.id, DAY_30.id] });
    expect(summaryDateLine(tree)).toBe("Date TBD");
    expect(summaryDateLine(tree)).not.toContain("29 Aug");
    await act(async () => tree.unmount());
  });

  test("S-3 LOAD-BEARING: withhold the CHOSEN SET and the guest's days are not claimed", async () => {
    const tree = await mount({ eventDateIds: [] });
    // The event's own first day — the same line the public page shows — never
    // the two-day string, because nothing on this screen knows what was bought.
    const line = summaryDateLine(tree);
    expect(line).not.toBe("Sat 29 Aug + Sun 30 Aug");
    expect(line).toBe("Sat 29 Aug · 11:00 AM – 6:00 PM");
    await act(async () => tree.unmount());
  });

  test("S-4 a SINGLE-date event's summary is byte-identical to the old expression", async () => {
    publicEventData = {
      event: SINGLE_DATE_EVENT,
      brand: null,
      occurrences: [],
    };
    const tree = await mount({ eventDateIds: [] });
    // `formatDraftDateLine(event)` is LITERALLY the expression the screen
    // evaluated before #2338. Equality with it is the byte-identity proof.
    expect(summaryDateLine(tree)).toBe(
      formatDraftDateLine(SINGLE_DATE_EVENT as never),
    );
    expect(summaryDateLine(tree)).toBe("Sat 12 Sept · 8 PM – 11 PM");
    await act(async () => tree.unmount());
  });

  test("S-4b a single-date event is unchanged even when its ONE occurrence rides along", async () => {
    publicEventData = {
      event: SINGLE_DATE_EVENT,
      brand: null,
      occurrences: [DAY_29],
    };
    const tree = await mount({ eventDateIds: [] });
    expect(summaryDateLine(tree)).toBe(
      formatDraftDateLine(SINGLE_DATE_EVENT as never),
    );
    await act(async () => tree.unmount());
  });

  test("S-5 HONEST DEGRADE: a multi-date event with no materialised day still says 'Date TBD'", async () => {
    publicEventData = { event: TWO_DAY_EVENT, brand: null, occurrences: [] };
    const tree = await mount({ eventDateIds: [] });
    expect(summaryDateLine(tree)).toBe("Date TBD");
    await act(async () => tree.unmount());
  });

  test("S-6 the legacy #2135 single eventDateId still names its one day", async () => {
    const tree = await mount({ eventDateId: DAY_30.id });
    expect(summaryDateLine(tree)).toBe("Sun 30 Aug");
    await act(async () => tree.unmount());
  });

  test("S-7 the PAID WEB return leg restores the chosen days across the redirect", async () => {
    // Stripe's success_url forces a full-page reload that wipes cart context.
    // The cart is therefore NOT seeded here: everything the summary knows comes
    // back through the sessionStorage resume payload and the confirm call.
    const payload: CheckoutResumePayload = {
      checkoutSessionId: SESSION_ID,
      buyerStatusToken: BUYER_TOKEN,
      lines: [
        {
          ticketTypeId: "tt-paid",
          ticketName: "General",
          quantity: 2,
          unitPrice: 5000,
          currency: "NGN",
          isFree: false,
        },
      ],
      buyer: {
        name: "Seth",
        email: "seth@usemingla.com",
        phone: "+2348000000000",
        marketingOptIn: false,
      },
      eventDateIds: [DAY_29.id, DAY_30.id],
    };
    const store = new Map<string, string>();
    store.set(checkoutResumeStorageKey(EVENT_ID), JSON.stringify(payload));
    (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    setLocationSearch(`?cs=cs_live_2338`);
    invoke.mockResolvedValue({
      data: {
        checkoutSessionId: SESSION_ID,
        status: "paid",
        order: {
          orderId: ORDER_ID,
          eventId: EVENT_ID,
          paymentStatus: "paid",
          totalCents: 1000000,
          currency: "NGN",
          taxAmountCents: 0,
          tickets: [],
          notificationStatus: "queued",
        },
      },
      error: null,
    });

    const tree = await mount(null);
    expect(summaryDateLine(tree)).toBe("Sat 29 Aug + Sun 30 Aug");
    await act(async () => tree.unmount());
    delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage;
  });
});
