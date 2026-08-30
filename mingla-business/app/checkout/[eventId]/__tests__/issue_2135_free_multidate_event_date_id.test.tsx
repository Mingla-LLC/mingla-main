/**
 * issue #2135 [multi-date public day picker] — the FREE-path occurrence binding.
 *
 * This is the assertion the whole change exists for.
 *
 * A guest on a two-day event picks Sunday. The public page shows it, the cart
 * step shows it — and before this fix the free reservation still reached the
 * server with no occurrence at all, so `orders.event_date_id` landed NULL and
 * the guest was silently booked onto the master date. Every per-day guest count
 * for the event was therefore wrong, and nothing anywhere said so.
 *
 * The paid path (payment.tsx) already forwarded the occurrence; the free path
 * (buyer.tsx) did not. Free is the DOMINANT case for the events this feature
 * exists to serve, so a fix that covered only the paid path would have left the
 * bug in place for most of the traffic.
 *
 * WHY IT IS WRITTEN THIS WAY: it mounts the REAL buyer screen inside the REAL
 * CartProvider and lets the REAL `createTicketCheckout` run, stubbing only the
 * Supabase transport. So it asserts the value that actually reaches the wire,
 * not that some intermediate function was called. The two failure modes are
 * asserted SEPARATELY and deliberately:
 *
 *   - `eventDateId` absent/undefined  → the original bug (NULL in the column)
 *   - `eventDateId` === the MASTER id → a plausible "fallback to first date"
 *     regression that a mere `toBeDefined()` would happily pass
 *
 * The single-date case asserts the request carries NO `eventDateId` key at all,
 * so today's dominant flow stays byte-identical on the wire.
 *
 * FAILS-ON-REVERT: delete the `...(eventDateId !== null ? { eventDateId } : {})`
 * spread from the `createTicketCheckout` call in
 * `app/checkout/[eventId]/buyer.tsx` and the multi-date cases go red.
 *
 * Owner: mingla-implementor.
 */

import React from "react";
import { Platform } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Renderer = {
  root: {
    findAllByProps: (
      props: Record<string, unknown>,
    ) => Array<{ props: Record<string, unknown> }>;
  };
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const MASTER_OCCURRENCE = "occ-day-one-2135-master";
const CHOSEN_OCCURRENCE = "occ-day-two-2135-chosen";
const EVENT_ID = "evt-2135";

const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };

/** Captures every ticket-checkout-create request body. */
const invoke = jest.fn();

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com" },
    },
  },
}));
jest.mock(
  "react-native-svg",
  () => ({ __esModule: true, default: () => null, Path: () => null, Circle: () => null }),
  { virtual: true },
);
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ eventId: "evt-2135" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../../src/services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock("../../../../src/hooks/usePublicEvents", () => ({
  usePublicEventById: () => ({
    data: {
      event: {
        id: "evt-2135",
        name: "TEST 2131 Two-Day Exhibition",
        brandSlug: "minglanigeria",
        eventSlug: "test-2131-two-day-exhibition",
        currency: "NGN",
        themeOverrides: null,
        tickets: [],
      },
      brand: { theme: null },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/services/consentService", () => ({
  recordConsent: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../../../src/analytics/webAnalytics", () => ({
  captureWeb: jest.fn(),
  gaEvent: jest.fn(),
  getStoredClickAttribution: () => ({ clickId: null }),
  // [TEST-MOD-APPROVED #2830] Optional Sites enrichment stays absent here.
  getStoredSiteAttribution: () => null,
}));
jest.mock("@mingla/phone-input", () => ({
  PhoneInput: () => null,
  COUNTRIES: [{ code: "NG", dialCode: "+234" }],
  getCountryByCode: () => ({ dialCode: "+234" }),
}));
jest.mock("../../../../src/wrappers/SmartScrollView", () => {
  const { View } = require("react-native");
  return { ScrollView: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock("../../../../src/wrappers/useKeyboardIsVisible", () => ({
  useKeyboardIsVisible: () => false,
}));
jest.mock("../../../../src/components/ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (props: { label: string; onPress: () => void; disabled?: boolean }) => (
      <Pressable
        testID={`btn-${props.label}`}
        accessibilityRole="button"
        accessibilityLabel={props.label}
        onPress={props.disabled === true ? undefined : props.onPress}
      />
    ),
  };
});
jest.mock("../../../../src/components/ui/GlassCard", () => {
  const { View } = require("react-native");
  return { GlassCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock("../../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../src/components/ui/Input", () => ({ Input: () => null }));
jest.mock("../../../../src/components/checkout/CheckoutHeader", () => ({
  CheckoutHeader: () => null,
}));
jest.mock("../../../../src/components/checkout/ConsentTermsSheet", () => ({
  ConsentTermsSheet: () => null,
}));

import {
  CartProvider,
  useCart,
} from "../../../../src/components/checkout/CartContext";
import BuyerScreen from "../buyer";

/**
 * Seeds the cart exactly as the real funnel does: the cart step writes the
 * occurrence via `setEventDateId`, and the buyer form writes the guest details.
 */
const SeedCart: React.FC<{ eventDateId: string | null }> = ({ eventDateId }) => {
  const { setLineQuantity, setBuyer, setEventDateId } = useCart();
  React.useEffect(() => {
    setLineQuantity({
      ticketTypeId: "tier-2135",
      ticketName: "Free entry",
      unitPrice: 0,
      unitPriceAllIn: 0,
      currency: "NGN",
      isFree: true,
      quantity: 1,
    });
    setBuyer({
      name: "Ada Guest",
      email: "ada@example.test",
      phone: "+2348012345678",
      termsAccepted: true,
      marketingOptIn: true,
    });
    setEventDateId(eventDateId);
    // Seed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const freeCompletedEnvelope = {
  kind: "free_completed",
  orderId: "40000000-0000-4000-8000-00000000e139",
  checkoutSessionId: "30000000-0000-4000-8000-00000000e138",
  eventId: EVENT_ID,
  paymentStatus: "paid",
  totalCents: 0,
  currency: "NGN",
  notificationStatus: "queued",
  tickets: [
    {
      ticketId: "50000000-0000-4000-8000-00000000e13a",
      ticketTypeId: "tier-2135",
      ticketName: "Free entry",
      qrPayload: "mgl_free_2135_qr",
      status: "valid",
    },
  ],
};

/** Mount the real buyer screen over a cart seeded with `eventDateId`. */
const reserveFreeTicket = async (
  eventDateId: string | null,
): Promise<Record<string, unknown>> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <SeedCart eventDateId={eventDateId} />
        <BuyerScreen />
      </CartProvider>,
    );
  });
  const button = tree.root.findAllByProps({ testID: "btn-Reserve free ticket" })[0];
  if (button === undefined) throw new Error("free reserve button not rendered");
  await act(async () => {
    (button.props.onPress as () => void)();
  });
  await act(async () => tree.unmount());

  const call = invoke.mock.calls.find((c) => c[0] === "ticket-checkout-create");
  if (call === undefined) throw new Error("ticket-checkout-create was never invoked");
  return (call[1] as { body: Record<string, unknown> }).body;
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ data: freeCompletedEnvelope, error: null });
  router.replace.mockClear();
  jest.replaceProperty(Platform, "OS", "web");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("issue #2135 — a free multi-date reservation books the chosen day", () => {
  test("the request carries the occurrence the guest picked", async () => {
    const body = await reserveFreeTicket(CHOSEN_OCCURRENCE);

    // The whole point: this is what becomes orders.event_date_id (#1188).
    expect(body.eventDateId).toBe(CHOSEN_OCCURRENCE);
  });

  test("it is NOT null — the original bug", async () => {
    const body = await reserveFreeTicket(CHOSEN_OCCURRENCE);

    // Before the fix `eventDateId` was never sent, so the column defaulted to
    // NULL and the reservation belonged to no particular day.
    expect(body.eventDateId).toBeDefined();
    expect(body.eventDateId).not.toBeNull();
  });

  test("it is NOT the master date — the silent-fallback regression", async () => {
    const body = await reserveFreeTicket(CHOSEN_OCCURRENCE);

    // A fix that defaulted to the first/master occurrence would satisfy a
    // not-null assertion while still booking the guest onto the wrong day.
    // That is a DIFFERENT bug and is asserted separately on purpose.
    expect(body.eventDateId).not.toBe(MASTER_OCCURRENCE);
  });

  test("the reservation still completes (the #2136 guards are untouched)", async () => {
    await reserveFreeTicket(CHOSEN_OCCURRENCE);

    // The envelope carries an order AND a ticket, so isCompletedFreeOrder passes
    // and the guest reaches confirmation. Adding the occurrence must not have
    // disturbed the free-checkout contract this file shares with #2136.
    expect(router.replace).toHaveBeenCalledWith(`/checkout/${EVENT_ID}/confirm`);
  });
});

describe("issue #2135 — a free single-date reservation is byte-identical", () => {
  test("the request carries NO eventDateId key at all", async () => {
    const body = await reserveFreeTicket(null);

    // Not "null" and not "undefined-valued": the key must be ABSENT, which is
    // what keeps today's dominant free flow identical on the wire.
    expect(Object.keys(body)).not.toContain("eventDateId");
  });

  test("and still completes", async () => {
    await reserveFreeTicket(null);
    expect(router.replace).toHaveBeenCalledWith(`/checkout/${EVENT_ID}/confirm`);
  });
});
