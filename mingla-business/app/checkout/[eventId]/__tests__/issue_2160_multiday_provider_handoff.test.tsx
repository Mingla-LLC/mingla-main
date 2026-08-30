/**
 * issue #2160 x #2188 — THE CART FINGERPRINT MUST INCLUDE THE CHOSEN DAY SET.
 *
 * ── THE DEFECT THIS GUARDS, WHICH NEITHER CHANGE HAS ALONE ────────────────
 * #2188 holds the resolved provider hand-off for the page lifetime, keyed by a
 * fingerprint of "what is actually being bought", so a second Pay tap re-follows
 * the URL already issued instead of creating a second checkout. Its own comment
 * promises: "change the tickets, the buyer or the CHOSEN DAY and the fingerprint
 * moves".
 *
 * That was true while `eventDateId` was the only way to carry a day. On a #2160
 * multi-date cart it is NULL — the days ride `eventDateIds` — so before the fix
 * a guest who picked Saturday, tapped Pay, went back, switched to Sunday and
 * tapped Pay again produced the SAME fingerprint (same lines, same buyer,
 * `eventDateId` null both times) and was replayed the SATURDAY provider URL.
 * They would have paid for the day they did not choose.
 *
 * Neither #2188 nor #2160 is wrong on its own. The gap exists only where they
 * meet, which is why it needs a test that exercises BOTH.
 *
 * ── HARNESS ────────────────────────────────────────────────────────────────
 * The environment mocks below are #2188's, reused verbatim: the REAL payment
 * screen, the REAL CartProvider and the REAL `createTicketCheckout` run, and
 * only the edge transport and the browser navigation are stubbed. #2188's own
 * file is NOT modified — this is a separate, append-only suite.
 *
 * FAILS-ON-REVERT: drop `eventDateIds` from `cartFingerprint` in
 * `app/checkout/[eventId]/payment.tsx` and F-2 goes red.
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
  update: (node: React.ReactElement) => void;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const EVENT_ID = "evt-2188";
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
  useLocalSearchParams: () => ({ eventId: "evt-2188" }),
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
        id: "evt-2188",
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
  gaEvent: jest.fn(),
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
import PaymentScreen from "../payment";

const DAY_1 = "occ-2160-day-1";
const DAY_2 = "occ-2160-day-2";

/**
 * Seeds the cart exactly as the real multi-day funnel does: a PAID line, a
 * buyer, and a chosen DAY SET — with `eventDateId` left NULL, which is what the
 * `?eventDateIds=` link actually produces.
 *
 * `days` is a PROP, not a module variable, so the day set can change WITHOUT
 * remounting. That matters: #2188 holds the provider hand-off in a `useRef`,
 * which a remount would reset — a remounting test would create again for the
 * wrong reason and pass even with the fingerprint broken. (It did, on the first
 * draft of this file. The fingerprint revert stayed GREEN until this became an
 * in-place update.)
 */
const SeedCart: React.FC<{ days: readonly string[] }> = ({ days }) => {
  const { setLineQuantity, setBuyer, setEventDateIds } = useCart();
  React.useEffect(() => {
    setLineQuantity({
      ticketTypeId: "tier-2160",
      ticketName: "General admission",
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    setEventDateIds(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);
  return null;
};

const treeFor = (days: readonly string[]): React.ReactElement => (
  <CartProvider>
    <SeedCart days={days} />
    <PaymentScreen />
  </CartProvider>
);

const paystackEnvelope = {
  kind: "requires_paystack_redirect",
  checkoutSessionId: SESSION_ID,
  buyerStatusToken: "bst-2160",
  authorizationUrl: PAYSTACK_URL,
  returnUrl:
    `https://host.usemingla.com/checkout/${EVENT_ID}/confirm?cs=paystack`,
  reference: `mingla_${SESSION_ID}`,
  totalCents: 1575000,
  currency: "NGN",
};

const payButton = (
  tree: Renderer,
): { props: Record<string, unknown> } | undefined =>
  tree.root
    .findAllByProps({ accessibilityRole: "button" })
    .find((n) => String(n.props.testID ?? "").startsWith("btn-Pay"));

const mountWith = async (days: readonly string[]): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(treeFor(days));
  });
  return tree;
};

/** Change the chosen days IN PLACE — same mount, so #2188's ref survives. */
const changeDays = async (
  tree: Renderer,
  days: readonly string[],
): Promise<void> => {
  await act(async () => {
    tree.update(treeFor(days));
  });
};

const tapPay = async (tree: Renderer): Promise<void> => {
  const onPress = payButton(tree)?.props.onPress;
  if (typeof onPress !== "function") {
    throw new Error("Pay button was not tappable");
  }
  await act(async () => {
    (onPress as () => void)();
  });
};

const createCalls = (): Array<Record<string, unknown>> =>
  invoke.mock.calls
    .filter((c) => c[0] === "ticket-checkout-create")
    .map((c) => (c[1] as { body: Record<string, unknown> }).body);

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

describe("issue #2160 x #2188 — the chosen days reach the provider create", () => {
  test("F-1 a multi-day cart sends eventDateIds on the create, and still reaches Paystack", async () => {
    invoke.mockResolvedValue({ data: paystackEnvelope, error: null });
    const tree = await mountWith([DAY_1]);
    await tapPay(tree);

    const calls = createCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].eventDateIds).toEqual([DAY_1]);
    // #2188's half must still hold: the guest actually goes to Paystack.
    expect(assign).toHaveBeenCalledWith(PAYSTACK_URL);
  });

  test("F-2 CHANGING THE DAY forces a fresh create — the held URL is not replayed", async () => {
    invoke.mockResolvedValue({ data: paystackEnvelope, error: null });
    // A browser with no usable `location.assign` — #2188's own scenario for the
    // one path that leaves the guest ON this screen with Pay re-enabled and the
    // hand-off held. That is exactly the state in which they can change their
    // day and tap Pay again, so it is the state this defect lives in.
    (globalThis as unknown as { location: Record<string, unknown> }).location =
      {};

    const tree = await mountWith([DAY_1]);
    await tapPay(tree);
    expect(createCalls()).toHaveLength(1);

    // The guest picks a DIFFERENT day WITHOUT leaving the page. Same tickets,
    // same buyer, `eventDateId` null throughout — only the day set moved, and
    // #2188's held hand-off is still in the ref.
    await changeDays(tree, [DAY_2]);
    await tapPay(tree);

    const calls = createCalls();
    // Before the fix this was 1: the fingerprint did not move, so the day-1
    // hand-off was replayed and the guest paid for a day they did not choose.
    expect(calls).toHaveLength(2);
    expect(calls[1].eventDateIds).toEqual([DAY_2]);
  });

  test("F-3 the SAME day set still replays rather than creating twice (#2188 preserved)", async () => {
    invoke.mockResolvedValue({ data: paystackEnvelope, error: null });
    const tree = await mountWith([DAY_1]);
    await tapPay(tree);
    expect(createCalls()).toHaveLength(1);

    // A second tap on the SAME cart must NOT create again — that is the
    // duplicate the server 409s, and #2188 exists to prevent it.
    const onPress = payButton(tree)?.props.onPress;
    if (typeof onPress === "function") {
      await act(async () => {
        (onPress as () => void)();
      });
    }
    expect(createCalls()).toHaveLength(1);
  });

  test("F-4 a single-date cart sends NO eventDateIds — byte-identical request", async () => {
    invoke.mockResolvedValue({ data: paystackEnvelope, error: null });
    const tree = await mountWith([]);
    await tapPay(tree);

    const calls = createCalls();
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0])).not.toContain("eventDateIds");
  });
});
