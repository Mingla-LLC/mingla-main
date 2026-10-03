/**
 * issue #2190 [paid-checkout-redirect] — a signed-out guest on a Paystack brand
 * must actually ARRIVE at the provider's payment page for TRIPS.
 *
 * Mirrors `app/checkout/[eventId]/__tests__/issue_2188_paid_checkout_provider_handoff.test.tsx`
 * on the trip payment screen. Same production failure mode: the screen
 * hard-required Stripe's `requires_web_redirect` envelope, threw away a live
 * Paystack `authorizationUrl`, re-enabled Pay, and the guest tapped again
 * straight into the duplicate-checkout 409.
 *
 * WHAT IT ASSERTS. Mounts the REAL trip payment screen inside the REAL
 * CartProvider and lets the REAL `createTicketCheckout` run, stubbing only the
 * Supabase transport and `location.assign`. So it asserts what actually reaches
 * the wire and where the browser is actually sent — not that some intermediate
 * function was called.
 *
 * Never assert "session created" alone — that passes on the broken code.
 *
 * FAILS-ON-REVERT: delete the `ticketCheckoutProviderHandoff` branch in
 * `app/checkout-trip/[tripEventId]/payment.tsx` (restore the
 * `kind !== "requires_web_redirect"` throw) and every Paystack case goes red.
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
  toJSON: () => unknown;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const TRIP_EVENT_ID = "trip-2190";
const SESSION_ID = "ab33adf6-0000-4000-8000-000000002190";
const PAYSTACK_URL = "https://checkout.paystack.com/mgl2190tripauth";
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_live_2190_trip";

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

/** Captures every edge invocation. */
const invoke = jest.fn();
/** Captures every full-page navigation the screen attempts. */
const assign = jest.fn();

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com",
      },
    },
  },
}));
jest.mock(
  "react-native-svg",
  () => ({
    __esModule: true,
    default: () => null,
    Path: () => null,
    Circle: () => null,
  }),
  { virtual: true },
);
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({ tripEventId: "trip-2190" }),
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("../../../../src/services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock("../../../../src/hooks/usePublicTripById", () => ({
  usePublicTripById: () => ({
    data: {
      trip: {
        id: "trip-2190",
        title: "Lagos Paid Trip",
        slug: "lagos-paid-trip",
        brandSlug: "minglanigeria",
        currency: "NGN",
        pricingTiers: [],
      },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/hooks/useIntakeSchema", () => ({
  useTripIntakeSchemasByEvent: () => ({
    // tripIntakeState expects a Map (ticketTypeId → schema), not an array.
    data: new Map(),
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/services/mixpanelService", () => ({
  mixpanelService: { track: jest.fn() },
}));
jest.mock("../../../../src/services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../../../src/components/ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (
      props: { label: string; onPress: () => void; disabled?: boolean },
    ) => (
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
  return {
    GlassCard: ({ children }: { children: React.ReactNode }) => (
      <View>{children}</View>
    ),
  };
});
jest.mock("../../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../src/components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../../src/components/checkout/CheckoutHeader", () => ({
  CheckoutHeader: () => null,
}));
jest.mock("../../../../src/components/trip/TripPaymentChoice", () => ({
  TripPaymentChoice: () => null,
}));

import {
  CartProvider,
  useCart,
} from "../../../../src/components/checkout/CartContext";
import PaymentScreen from "../payment";

/** Seeds the cart exactly as the real funnel does, with a PAID line. */
const SeedCart: React.FC = () => {
  const { setLineQuantity, setBuyer } = useCart();
  React.useEffect(() => {
    setLineQuantity({
      ticketTypeId: "tier-2190-trip",
      ticketName: "Shared room",
      unitPrice: 15000,
      unitPriceAllIn: 15750,
      currency: "NGN",
      isFree: false,
      quantity: 1,
    });
    setBuyer({
      name: "Ada Guest",
      email: "ada@example.test",
      phone: "+2348012345678",
      termsAccepted: true,
      marketingOptIn: true,
    });
    // Seed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

/** What the Paystack arm of ticket-checkout-create really returns. */
const paystackEnvelope = {
  kind: "requires_paystack_redirect",
  checkoutSessionId: SESSION_ID,
  buyerStatusToken: "bst-2190-trip",
  authorizationUrl: PAYSTACK_URL,
  returnUrl:
    `https://host.usemingla.com/checkout-trip/${TRIP_EVENT_ID}/confirm?cs=paystack`,
  reference: `mingla_${SESSION_ID}`,
  totalCents: 1575000,
  currency: "NGN",
};

/** What the Stripe arm returns, for the no-regression half. */
const stripeEnvelope = {
  kind: "requires_web_redirect",
  checkoutSessionId: SESSION_ID,
  buyerStatusToken: "bst-2190-trip",
  hostedCheckoutUrl: STRIPE_URL,
  totalCents: 1575000,
  currency: "GBP",
};

/**
 * The 409 the server returns for a SECOND create on a cart that already has a
 * checkout in flight. Shaped exactly like supabase-js's FunctionsHttpError.
 */
const duplicateCreateRefusal = {
  name: "FunctionsHttpError",
  message: "Edge Function returned a non-2xx status code",
  context: {
    status: 409,
    json: async (): Promise<unknown> => ({ error: "checkout_in_progress" }),
  },
};

const payButton = (
  tree: Renderer,
): { props: Record<string, unknown> } | undefined =>
  tree.root
    .findAllByProps({ accessibilityRole: "button" })
    .find((n) => String(n.props.testID ?? "").startsWith("btn-Pay"));

/** True when the Pay button can still be tapped (see the Button mock). */
const payIsTappable = (tree: Renderer): boolean =>
  typeof payButton(tree)?.props.onPress === "function";

const mountPaymentScreen = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <SeedCart />
        <PaymentScreen />
      </CartProvider>,
    );
  });
  return tree;
};

/**
 * Tap Pay `taps` times. A tap on a DISABLED button is a no-op, exactly as it is
 * for a real guest — the loop does not force the handler.
 */
const tapPay = async (taps: number): Promise<Renderer> => {
  const tree = await mountPaymentScreen();
  for (let i = 0; i < taps; i++) {
    const onPress = payButton(tree)?.props.onPress;
    if (i === 0 && typeof onPress !== "function") {
      throw new Error("Pay button was not tappable on the first tap");
    }
    if (typeof onPress !== "function") continue;
    await act(async () => {
      (onPress as () => void)();
    });
  }
  return tree;
};

const createCalls = (): unknown[][] =>
  invoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create");

beforeEach(() => {
  invoke.mockReset();
  assign.mockReset();
  router.replace.mockClear();
  jest.replaceProperty(Platform, "OS", "web");
  (globalThis as unknown as { location: { assign: unknown } }).location = {
    assign,
  };
  (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage =
    undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("issue #2190 — a Paystack trip guest reaches Paystack", () => {
  test("the browser is sent to the Paystack authorization URL", async () => {
    invoke.mockResolvedValue({ data: paystackEnvelope, error: null });

    await tapPay(1);

    expect(assign).toHaveBeenCalledWith(PAYSTACK_URL);
  });

  test("the guest arrives at the PROVIDER, not somewhere on our own site", async () => {
    invoke.mockResolvedValue({ data: paystackEnvelope, error: null });

    await tapPay(1);

    const destination = String(assign.mock.calls[0]?.[0] ?? "");
    expect(destination).toContain("checkout.paystack.com");
    expect(destination).not.toContain("host.usemingla.com");
  });

  test("exactly ONE create call and ONE provider attempt, on two Pay taps", async () => {
    invoke.mockResolvedValue({ data: paystackEnvelope, error: null });

    const tree = await tapPay(2);

    expect(createCalls()).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(payIsTappable(tree)).toBe(false);
    expect(assign).toHaveBeenCalledWith(PAYSTACK_URL);
  });

  test(
    "when the redirect cannot run, a re-tap REPLAYS the held URL instead of creating again",
    async () => {
      invoke.mockResolvedValue({ data: paystackEnvelope, error: null });
      (globalThis as unknown as { location: Record<string, unknown> }).location =
        {};

      const tree = await tapPay(2);

      expect(createCalls()).toHaveLength(1);
      const rendered = JSON.stringify(tree.toJSON());
      expect(rendered).toContain("secure payment page");
      expect(rendered).toContain("have not been charged");
    },
  );
});

describe("issue #2190 — Stripe trip brands are unaffected", () => {
  test("the browser is still sent to the Stripe hosted Checkout page", async () => {
    invoke.mockResolvedValue({ data: stripeEnvelope, error: null });

    await tapPay(1);

    expect(assign).toHaveBeenCalledWith(STRIPE_URL);
    expect(createCalls()).toHaveLength(1);
  });
});

describe("issue #2190 — the trip guest never sees a framework string", () => {
  test("a duplicate-create 409 reads as a human sentence", async () => {
    invoke.mockResolvedValue({ data: null, error: duplicateCreateRefusal });

    const tree = await tapPay(1);

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).not.toContain("Edge Function returned a non-2xx");
    expect(rendered).toContain("payment in progress");
    expect(rendered).toContain("have not been charged");
  });

  test("a restricted-sale 403 reads as a restricted sale, not as a network fault", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: {
          status: 403,
          json: async (): Promise<unknown> => ({
            error: "checkout_restricted",
          }),
        },
      },
    });

    const tree = await tapPay(1);

    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).not.toContain("Edge Function returned a non-2xx");
    expect(rendered).toContain("limited this sale to specific Mingla accounts");
  });
});
