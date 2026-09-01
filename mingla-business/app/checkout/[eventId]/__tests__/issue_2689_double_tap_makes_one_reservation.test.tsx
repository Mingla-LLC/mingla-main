/**
 * issue #2689 [a free ticket that succeeds is reported as a failure] — the
 * behavioural proof, driven through the REAL buyer screen.
 *
 * PRODUCTION, 8 buyers on We Go Again: every buyer shown a failure had produced
 * TWO `record-consent` POSTs 0.51-1.65s apart; every buyer shown success had
 * produced one. 142 of 142 sessions minted an order — not one purchase failed.
 * Five of eight people were told their ticket did not exist while holding it.
 *
 * WHY THEY TAPPED TWICE. `setSubmitting(true)` sat BELOW `await recordConsent`,
 * a network round trip. The button gates only on `submitting`, so for the whole
 * of that await it stayed enabled and unspinnered — the screen carried no
 * evidence the first tap had registered. Measured dead window: 2.0s and 2.7s.
 *
 * WHY THIS TEST HOLDS THE CONSENT PROMISE OPEN. A resolved stub cannot see this
 * bug at all: the defect exists only DURING that await. The gate below keeps it
 * pending, presses twice — exactly as a guest facing an idle screen does — and
 * only then releases it. My first attempt at this test asserted statement ORDER
 * in the source instead, on the false belief that this screen could not be
 * rendered. It can, this file's own harness does it, and an order assertion
 * would not have caught the `useFocusEffect` regression that this one did.
 *
 * SCOPE, stated so the gap is not mistaken for coverage: this file proves the
 * ONE property that needed a live render — two taps produce one reservation.
 * The guard's RELEASE paths (the free rail's `finally`, the paid rail after its
 * navigate) are asserted in
 * `src/services/__tests__/issue_2689_submit_guard_precedes_await.test.ts`,
 * which fails on revert. Two further render cases were attempted here and
 * dropped: they tripped over this harness's renderer lifecycle rather than over
 * the code, and a flaky test that reds on unrelated changes is worse than an
 * honest gap.
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
// issue #2689 — the consent write is the await the bug hides behind, so this
// harness must be able to HOLD it open. A resolved stub cannot reproduce the
// defect: the whole failure is what the screen does WHILE this is in flight.
// EVERY pending consent write is held, not just the latest. My first version of
// this gate kept a single `release`, so a second call overwrote the first
// resolver and the first tap's flow hung forever — which made the test pass
// against the UNFIXED code and proved nothing. The mutation run caught it.
const consentGate = {
  pending: [] as Array<() => void>,
  releaseAll(): void {
    const waiting = consentGate.pending;
    consentGate.pending = [];
    for (const resolve of waiting) resolve();
  },
};
jest.mock("../../../../src/services/consentService", () => ({
  recordConsent: jest.fn(
    () =>
      new Promise<{ ok: boolean }>((resolve) => {
        consentGate.pending.push(() => resolve({ ok: true }));
      }),
  ),
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
  router.push.mockClear();
  consentGate.pending = [];
  jest.replaceProperty(Platform, "OS", "web");
});

const createCalls = (): unknown[][] =>
  invoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create");

const mountFreeCheckout = async (): Promise<{
  press: () => void;
  tree: Renderer;
}> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <SeedCart eventDateId={null} />
        <BuyerScreen />
      </CartProvider>,
    );
  });
  const button = tree.root.findAllByProps({
    testID: "btn-Reserve free ticket",
  })[0];
  if (button === undefined) throw new Error("free reserve button not rendered");
  return { press: button.props.onPress as () => void, tree };
};

describe("#2689 two taps during the consent write make ONE reservation", () => {
  it("the second tap does not start a second checkout", async () => {
    const { press, tree } = await mountFreeCheckout();

    // Two presses while the consent write is still pending — the production
    // sequence, 0.51-1.65s apart on a screen showing nothing.
    await act(async () => {
      press();
      press();
    });

    expect(createCalls()).toHaveLength(0); // still behind the consent gate

    await act(async () => {
      consentGate.releaseAll();
    });

    expect(createCalls()).toHaveLength(1);
    await act(async () => tree.unmount());
  });

});
