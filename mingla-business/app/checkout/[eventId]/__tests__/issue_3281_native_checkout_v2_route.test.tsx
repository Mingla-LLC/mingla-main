/**
 * issue #3281 — the Host app's NATIVE paid event checkout sends checkout
 * contract v2: one attempt id per cart, reused across a PaymentSheet cancel or
 * a `checkout_in_progress` retry, new when the extras change, reset once paid.
 * A cart the contract refuses never reaches the native flow. Harness copied
 * from issue_3281_cancel_return_extras (itself from issue_2188).
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

const routeParams: { eventId: string; ticketLink?: string } = {
  eventId: EVENT_ID,
};
const nativeCheckout = jest.fn();

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

/** Captures every edge invocation. */
const invoke = jest.fn();

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
  useLocalSearchParams: () => routeParams,
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

jest.mock("../../../../src/payments/NativeCheckoutPaymentBoundary", () => ({
  __esModule: true,
  default: ({
    children,
  }: {
    children: (run: (input: unknown) => Promise<unknown>) => React.ReactElement;
  }) => children((input) => nativeCheckout(input)),
}));

import {
  CartProvider,
  useCart,
  type CartContextValue,
} from "../../../../src/components/checkout/CartContext";
import { ticketQuoteFromLines } from "../../../../src/components/checkout/__tests__/ticketQuoteFixture";
import PaymentScreen from "../payment";

const DINNER = "21880000-0000-4000-8000-0000000000d1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const baseLine = {
  ticketTypeId: TICKET_TYPE_ID,
  ticketName: "General admission",
  unitPrice: 150,
  unitPriceAllIn: 157.5,
  currency: "GBP",
  isFree: false,
  quantity: 1,
};

let cart: CartContextValue | null = null;
const SeedCart: React.FC<{ ticketTypeId?: string; termsAccepted?: boolean }> = ({
  ticketTypeId = TICKET_TYPE_ID,
  termsAccepted = true,
}) => {
  cart = useCart();
  const { setLineQuantity, setBuyer, setQuoteState } = cart;
  React.useEffect(() => {
    const line = { ...baseLine, ticketTypeId };
    setLineQuantity(line);
    setLineQuantity({ ...line, addOns: [{ addOnId: DINNER, quantity: 1 }] });
    setQuoteState(ticketQuoteFromLines([line]), "ready");
    setBuyer({
      name: "Ada Guest",
      email: "ada@example.test",
      phone: "+447700900123",
      termsAccepted,
      marketingOptIn: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
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

const mount = async (seed: React.ReactElement = <SeedCart />): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        {seed}
        <PaymentScreen />
      </CartProvider>,
    );
  });
  // The lazy boundary resolves on the next tick.
  await act(async () => undefined);
  return tree;
};

type NativeInput = {
  checkoutContractVersion?: number;
  checkoutAttemptId?: string;
  purchaseTermsAccepted?: boolean;
  ticketLinkToken?: string;
  lines: Array<{ ticketTypeId: string; addOns?: unknown }>;
  paymentPlanChoice?: unknown;
};
const nativeInputs = (): NativeInput[] =>
  nativeCheckout.mock.calls.map((call) => call[0] as NativeInput);

beforeEach(() => {
  nativeCheckout.mockReset();
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { order: null }, error: null });
  router.replace.mockClear();
  delete routeParams.ticketLink;
  cart = null;
  jest.replaceProperty(Platform, "OS", "ios");
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("issue #3281 — the native event checkout is contract v2", () => {
  test("Pay hands the native flow v2, a native attempt id, the terms, the link and the extras", async () => {
    routeParams.ticketLink = "link-tok-3281";
    nativeCheckout.mockResolvedValue({ outcome: "canceled" });
    const tree = await mount();
    await tap(tree);
    expect(nativeCheckout).toHaveBeenCalledTimes(1);
    const [input] = nativeInputs();
    expect(input.checkoutContractVersion).toBe(2);
    expect(input.checkoutAttemptId).toMatch(UUID);
    expect(input.purchaseTermsAccepted).toBe(true);
    expect(input.ticketLinkToken).toBe("link-tok-3281");
    expect(input.paymentPlanChoice).toBeUndefined();
    expect(input.lines[0]).toMatchObject({
      ticketTypeId: TICKET_TYPE_ID,
      paymentPlanChoice: "full",
      addOns: [{ addOnId: DINNER, quantity: 1 }],
    });
    await act(async () => tree.unmount());
  });

  test("no link token is sent when the guest did not arrive through one", async () => {
    nativeCheckout.mockResolvedValue({ outcome: "canceled" });
    const tree = await mount();
    await tap(tree);
    expect("ticketLinkToken" in nativeInputs()[0]).toBe(false);
    await act(async () => tree.unmount());
  });

  test("terms not accepted are passed through as false (the flow then refuses)", async () => {
    nativeCheckout.mockResolvedValue({ outcome: "failed", message: "Accept the terms" });
    const tree = await mount(<SeedCart termsAccepted={false} />);
    await tap(tree);
    expect(nativeInputs()[0]?.purchaseTermsAccepted).toBe(false);
    await act(async () => tree.unmount());
  });

  test("a PaymentSheet cancel keeps the attempt: the retry reuses it", async () => {
    nativeCheckout.mockResolvedValue({ outcome: "canceled" });
    const tree = await mount();
    await tap(tree);
    await tap(tree);
    const [first, second] = nativeInputs();
    expect(second.checkoutAttemptId).toBe(first.checkoutAttemptId);
    await act(async () => tree.unmount());
  });

  test("a checkout_in_progress refusal keeps the attempt: the retry reuses it", async () => {
    nativeCheckout.mockResolvedValue({
      outcome: "failed",
      message: "A checkout for this cart is already in progress.",
    });
    const tree = await mount();
    await tap(tree);
    await tap(tree);
    const [first, second] = nativeInputs();
    expect(second.checkoutAttemptId).toBe(first.checkoutAttemptId);
    await act(async () => tree.unmount());
  });

  test("a changed extra is a new attempt", async () => {
    nativeCheckout.mockResolvedValue({ outcome: "canceled" });
    const tree = await mount();
    await tap(tree);
    await act(async () =>
      cart!.setLineQuantity({ ...baseLine, addOns: [{ addOnId: DINNER, quantity: 2 }] }),
    );
    await tap(tree);
    const [first, second] = nativeInputs();
    expect(second.checkoutAttemptId).toMatch(UUID);
    expect(second.checkoutAttemptId).not.toBe(first.checkoutAttemptId);
    expect(second.lines[0].addOns).toEqual([{ addOnId: DINNER, quantity: 2 }]);
    await act(async () => tree.unmount());
  });

  test("a paid checkout resets the attempt and keeps Pay locked until the screen leaves", async () => {
    nativeCheckout.mockResolvedValue({ outcome: "succeeded", orderId: "cs_3281" });
    const tree = await mount();
    // The success path arms a confirm timeout and a delayed navigation.
    jest.useFakeTimers();
    await tap(tree);
    const [paid] = nativeInputs();
    // The spent attempt is gone: the same cart now mints a different id.
    const next = cart!.checkoutAttemptIdFor({ eventId: EVENT_ID, surface: "native" });
    expect(next).toMatch(UUID);
    expect(next).not.toBe(paid.checkoutAttemptId);
    // A re-tap during the success toast starts no second checkout.
    await tap(tree).catch(() => undefined);
    expect(nativeCheckout).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    expect(router.replace).toHaveBeenCalledWith("/e/minglanigeria/lagos-paid-night");
    await act(async () => tree.unmount());
  });

  test("a cart the contract refuses never reaches the native flow", async () => {
    const tree = await mount(<SeedCart ticketTypeId="tt_not_a_uuid" />);
    await tap(tree);
    expect(nativeCheckout).not.toHaveBeenCalled();
    expect(JSON.stringify((tree as unknown as { toJSON: () => unknown }).toJSON())).toContain(
      "You have not been charged",
    );
    await act(async () => tree.unmount());
  });

  test("a review refusal opens the review step instead of an error", async () => {
    nativeCheckout.mockResolvedValue({
      outcome: "failed",
      message: "review",
      review: { kind: "review_required", detail: "fingerprint", quote: null, previousTotalCents: null },
    });
    const tree = await mount();
    await tap(tree);
    expect(cart!.checkoutReview).toMatchObject({ kind: "review_required", detail: "fingerprint" });
    await act(async () => tree.unmount());
  });
});
