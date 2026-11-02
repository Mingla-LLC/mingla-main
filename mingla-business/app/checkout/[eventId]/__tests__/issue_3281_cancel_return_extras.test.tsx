/**
 * issue #3281 — Extras: a Stripe cancel return re-follows the page the cart was
 * already handed instead of quoting again (the first checkout holds the
 * guest's extras). Harness copied from issue_2188_paid_checkout_provider_handoff.
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

// [TEST-MOD-APPROVED #3859] Checkout v2 rejects identifiers the real database
// cannot issue, so this integration fixture now uses production-shaped UUIDs.
const EVENT_ID = "21880000-0000-4000-8000-000000000001";
const TICKET_TYPE_ID = "21880000-0000-4000-8000-000000000002";
const SESSION_ID = "ab33adf6-0000-4000-8000-000000002188";
const PAYSTACK_URL = "https://checkout.paystack.com/mgl2188authcode";
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_live_2188";

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
  useLocalSearchParams: () => ({ eventId: EVENT_ID }),
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
        id: EVENT_ID,
        name: "Lagos Paid Night",
        brandSlug: "minglanigeria",
        eventSlug: "lagos-paid-night",
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
jest.mock("../../../../src/services/mixpanelService", () => ({
  mixpanelService: { track: jest.fn() },
}));
jest.mock("../../../../src/services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../../../src/analytics/webAnalytics", () => ({
  captureWeb: jest.fn(),
  fireAdInitiateCheckout: jest.fn(),
  gaEvent: jest.fn(),
  // [TEST-MOD-APPROVED #3697] This provider-handoff fixture has no browser
  // match cookies; preserve that fail-open boundary explicitly.
  getStoredAdMatchData: () => ({
    fbp: null,
    fbc: null,
    scid: null,
    clientUserAgent: null,
  }),
  getStoredClickAttribution: () => ({ clickId: null }),
  // [TEST-MOD-APPROVED #2830] Optional Sites enrichment stays absent here.
  getStoredSiteAttribution: () => null,
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

import {
  CartProvider,
  useCart,
} from "../../../../src/components/checkout/CartContext";
import { ticketQuoteFromLines } from "../../../../src/components/checkout/__tests__/ticketQuoteFixture";
import { checkoutResumeStorageKey } from "../../../../src/components/checkout/checkoutPersistence";
import PaymentScreen from "../payment";


// issue #3281 — a Stripe cancel return re-follows the page this cart was
// already handed. The first checkout still holds the guest's places, extras
// included, so a fresh quote would count that hold against them; Pay must
// work without one, and must never create a second checkout.
const DINNER = "21880000-0000-4000-8000-0000000000d1";

const line = {
  ticketTypeId: TICKET_TYPE_ID,
  ticketName: "General admission",
  unitPrice: 150,
  unitPriceAllIn: 157.5,
  currency: "GBP",
  isFree: false,
  quantity: 1,
};
const buyerDetails = {
  name: "Ada Guest",
  email: "ada@example.test",
  phone: "+447700900123",
  termsAccepted: true,
  marketingOptIn: true,
};

const SeedCart: React.FC = () => {
  const { setLineQuantity, setBuyer, setQuoteState } = useCart();
  React.useEffect(() => {
    setLineQuantity(line);
    setLineQuantity({ ...line, addOns: [{ addOnId: DINNER, quantity: 1 }] });
    setQuoteState(ticketQuoteFromLines([line]), "ready");
    setBuyer(buyerDetails);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

const stripeEnvelope = {
  kind: "requires_web_redirect",
  checkoutSessionId: SESSION_ID,
  buyerStatusToken: "bst-3281",
  hostedCheckoutUrl: STRIPE_URL,
  totalCents: 15750,
  currency: "GBP",
};

const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
};

const payButton = (tree: Renderer) =>
  tree.root
    .findAllByProps({ accessibilityRole: "button" })
    .find((n) => String(n.props.testID ?? "").startsWith("btn-Pay"));

const tap = async (tree: Renderer): Promise<void> => {
  const onPress = payButton(tree)?.props.onPress;
  if (typeof onPress !== "function") throw new Error("Pay was not tappable");
  await act(async () => {
    (onPress as () => void)();
  });
};

const createCalls = (): unknown[][] =>
  invoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create");

let storage: Storage;
beforeEach(() => {
  invoke.mockReset();
  assign.mockReset();
  router.replace.mockClear();
  jest.replaceProperty(Platform, "OS", "web");
  (globalThis as unknown as { location: { assign: unknown } }).location = {
    assign,
  };
  storage = memoryStorage();
  (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage =
    storage;
});

afterEach(() => {
  jest.restoreAllMocks();
});

let sessionStatus = "awaiting_web_redirect";
const routeInvoke = (): void => {
  invoke.mockImplementation(async (fn: unknown) =>
    fn === "ticket-checkout-status"
      ? {
          data: { checkoutSessionId: SESSION_ID, status: sessionStatus, order: null },
          error: null,
        }
      : { data: stripeEnvelope, error: null },
  );
};

/** Hands the cart to Stripe, then reloads the payment step with an empty cart. */
const cancelReturn = async (Extra?: React.FC): Promise<Renderer> => {
  routeInvoke();
  let first!: Renderer;
  await act(async () => {
    first = TestRenderer.create(
      <CartProvider>
        <SeedCart />
        <PaymentScreen />
      </CartProvider>,
    );
  });
  await tap(first);
  await act(async () => first.unmount());
  assign.mockReset();
  let back!: Renderer;
  await act(async () => {
    back = TestRenderer.create(
      <CartProvider>
        {Extra !== undefined ? <Extra /> : null}
        <PaymentScreen />
      </CartProvider>,
    );
  });
  return back;
};

describe("issue #3281 — a Stripe cancel return keeps the guest's own hold", () => {
  beforeEach(() => {
    sessionStatus = "awaiting_web_redirect";
  });

  test("an expired checkout is forgotten, never re-followed", async () => {
    const back = await cancelReturn();
    sessionStatus = "expired";
    await tap(back);
    expect(assign).not.toHaveBeenCalled();
    expect(createCalls()).toHaveLength(1);
    const saved = JSON.parse(storage.getItem(checkoutResumeStorageKey(EVENT_ID)) ?? "{}");
    expect(saved.providerHandoff).toBeUndefined();
    await act(async () => back.unmount());
  });

  test("a checkout already paid goes to confirmation", async () => {
    const back = await cancelReturn();
    sessionStatus = "paid_completed";
    await tap(back);
    expect(assign).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(`/checkout/${EVENT_ID}/confirm`);
    await act(async () => back.unmount());
  });

  test("a fresh quote at another price starts a new checkout instead", async () => {
    const Repriced: React.FC = () => {
      const { lines, setQuoteState } = useCart();
      React.useEffect(() => {
        if (lines.length > 0) {
          setQuoteState(ticketQuoteFromLines([{ ...line, unitPriceAllIn: 200 }]), "ready");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [lines.length]);
      return null;
    };
    const back = await cancelReturn(Repriced);
    await tap(back);
    expect(createCalls()).toHaveLength(2);
    await act(async () => back.unmount());
  });

  test("Pay re-follows the page already handed, with no fresh quote and no second create", async () => {
    routeInvoke();
    let first!: Renderer;
    await act(async () => {
      first = TestRenderer.create(
        <CartProvider>
          <SeedCart />
          <PaymentScreen />
        </CartProvider>,
      );
    });
    await tap(first);
    expect(createCalls()).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith(STRIPE_URL);
    await act(async () => first.unmount());

    // The guest cancels on Stripe: a full reload, an empty cart, and no quote
    // (a fresh one would count the first checkout's hold on the last extra).
    assign.mockReset();
    let back!: Renderer;
    await act(async () => {
      back = TestRenderer.create(
        <CartProvider>
          <PaymentScreen />
        </CartProvider>,
      );
    });
    await tap(back);
    expect(assign).toHaveBeenCalledWith(STRIPE_URL);
    expect(createCalls()).toHaveLength(1);
    // The extras came back with the cart.
    expect(JSON.stringify(back.toJSON())).not.toContain("Updating");
    await act(async () => back.unmount());
  });

  test("a stored page that isn't https is never followed", async () => {
    storage.setItem(
      checkoutResumeStorageKey(EVENT_ID),
      JSON.stringify({
        checkoutSessionId: SESSION_ID,
        buyerStatusToken: "bst-3281",
        lines: [line],
        buyer: buyerDetails,
        providerHandoff: {
          fingerprint: "x",
          redirectUrl: "javascript:alert(1)",
          totalCents: 1,
          currency: "GBP",
        },
      }),
    );
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <PaymentScreen />
        </CartProvider>,
      );
    });
    const onPress = payButton(tree)?.props.onPress;
    if (typeof onPress === "function") {
      await act(async () => {
        (onPress as () => void)();
      });
    }
    expect(assign).not.toHaveBeenCalledWith("javascript:alert(1)");
    await act(async () => tree.unmount());
  });
});
