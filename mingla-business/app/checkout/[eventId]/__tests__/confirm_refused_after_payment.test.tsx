/**
 * Paid return leg — a sale refused after payment must END, not spin.
 *
 * WHAT THE GUEST SAW. After paying, `ticket-checkout-confirm` refused the sale
 * (closed or held after a completed payment) with
 * HTTP 409 `{status:"failed", order:null, error:"checkout_unavailable"}`. The
 * screen treated that throw as a network blip and showed
 *
 *     "Confirming your tickets… Payment received. Your tickets will appear
 *      here in a moment."
 *
 * forever. `status: "expired"` did the same, and a genuinely slow answer had no
 * end at all.
 *
 * HOW. Same harness as `issue_2198_paystack_return_confirm.test.tsx`: the REAL
 * screen inside the REAL CartProvider, the REAL `confirmTicketCheckout` and
 * `awaitTicketConfirmation`, with only the Supabase transport stubbed — so each
 * assertion is about what the guest actually sees for a real edge answer.
 *
 * FAILS ON REVERT: restore `app/checkout/[eventId]/confirm.tsx` (and the trip /
 * experience copies) from origin/main and the refusal, expiry and budget cases
 * go red — the screen keeps showing "Payment received".
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type TestInstance = { props: Record<string, unknown> };
type Renderer = {
  root: { findAllByProps: (p: Record<string, unknown>) => TestInstance[] };
  toJSON: () => unknown;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const EVENT_ID = "evt-refused";
const SESSION_ID = "0b6c1c55-6f0e-4a0e-9d3a-6c4b8f1f2a10";
const BUYER_TOKEN = "bst-refused";

const invoke = jest.fn();
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
/** The screen's native back guard, captured so the CTA's disarm is provable. */
const navListeners: Record<string, (e: { preventDefault: () => void }) => void> = {};
/** The Realtime safety net's callback, captured so a late order can be fired. */
let realtimeArgs: {
  checkoutSessionId: string | null;
  onOrderReady: (order: unknown) => void;
} | null = null;

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
  useNavigation: () => ({
    addListener: (name: string, cb: (e: { preventDefault: () => void }) => void) => {
      navListeners[name] = cb;
      return () => undefined;
    },
  }),
  useLocalSearchParams: () => ({
    eventId: EVENT_ID,
    tripEventId: EVENT_ID,
    experienceEventId: EVENT_ID,
  }),
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
    data: {
      event: {
        id: "evt-refused",
        name: "Refused Night",
        brandSlug: "refused-brand",
        eventSlug: "refused-night",
        currency: "GBP",
        themeOverrides: null,
        tickets: [],
        whenMode: "single",
        date: "2026-10-12",
        doorsOpen: "20:00",
        endsAt: null,
        timezone: "Europe/London",
        masterStartAtUtc: null,
        masterEndAtUtc: null,
        multiDates: null,
      },
      brand: { theme: null },
      occurrences: [],
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/hooks/useOrderRealtimeSubscription", () => ({
  useOrderRealtimeSubscription: (args: {
    checkoutSessionId: string | null;
    onOrderReady: (order: unknown) => void;
  }) => {
    realtimeArgs = args;
  },
}));
jest.mock("../../../../src/hooks/usePublicTripById", () => ({
  usePublicTripById: () => ({
    data: {
      trip: {
        id: "evt-refused",
        title: "Refused Trip",
        slug: "refused-trip",
        brandSlug: "refused-brand",
        businessTrip: { startAt: null, endAt: null, destinationLocationText: null },
      },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/hooks/usePublicExperience", () => ({
  usePublicExperienceById: () => ({
    data: {
      experience: {
        id: "evt-refused",
        title: "Refused Experience",
        slug: "refused-experience",
        brandSlug: "refused-brand",
        venueText: null,
        dates: [],
        whenMode: "single",
        recurrenceRule: null,
      },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
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
  return { GlassCard: ({ children }: { children: React.ReactNode }) => <View>{children}</View> };
});
jest.mock("../../../../src/components/ui/Button", () => {
  const { Pressable } = require("react-native");
  return {
    Button: (props: { label: string; onPress?: () => void; variant?: string }) => (
      <Pressable
        testID={`btn-${props.label}`}
        accessibilityLabel={props.label}
        data-variant={props.variant}
        onPress={props.onPress}
      />
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

import { CartProvider } from "../../../../src/components/checkout/CartContext";
import { eventPublicPath } from "../../../../src/constants/publicUrls";
import {
  PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE,
  TICKETS_EXPIRED_MESSAGE,
  TICKETS_EXPIRED_TITLE,
  TICKETS_NOT_ISSUED_MESSAGE,
  TICKETS_NOT_ISSUED_TITLE,
  TICKETS_STILL_CONFIRMING_MESSAGE,
  TICKETS_STILL_CONFIRMING_TITLE,
} from "../../../../src/services/ticketCheckoutService";
import ConfirmScreen from "../confirm";
import TripConfirmScreen from "../../../checkout-trip/[tripEventId]/confirm";
import ExperienceConfirmScreen from "../../../checkout-experience/[experienceEventId]/confirm";

const visibleText = (tree: Renderer): string => JSON.stringify(tree.toJSON());

/** supabase-js's shape for the edge function's 409 refusal body. */
const refusedAfterPayment = () => ({
  data: null,
  error: {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: {
      status: 409,
      json: async () => ({
        checkoutSessionId: SESSION_ID,
        status: "failed",
        order: null,
        error: "checkout_unavailable",
      }),
    },
  },
});

const answer = (status: string, extra: Record<string, unknown> = {}) => ({
  data: { checkoutSessionId: SESSION_ID, status, order: null, ...extra },
  error: null,
});

const arriveFromProvider = (): void => {
  (globalThis as unknown as { location?: { search?: string } }).location = {
    search: `?cs=cs_live_refused&csi=${SESSION_ID}&bst=${BUYER_TOKEN}`,
  } as never;
};

/** Let timers AND the promise chains between them run, inside act. */
const settle = async (ms = 0): Promise<void> => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const mount = async (Screen: React.ComponentType): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <Screen />
      </CartProvider>,
    );
  });
  await settle(10);
  await settle(0);
  await settle(0);
  return tree;
};

const press = async (tree: Renderer, testID: string): Promise<void> => {
  const matches = tree.root
    .findAllByProps({ testID })
    .filter((node) => typeof node.props.onPress === "function");
  expect(matches.length).toBeGreaterThan(0);
  await act(async () => {
    (matches[0].props.onPress as () => void)();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  invoke.mockReset();
  router.replace.mockReset();
  realtimeArgs = null;
  for (const key of Object.keys(navListeners)) delete navListeners[key];
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  arriveFromProvider();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("event confirm — a sale refused after payment ends in a clear state", () => {
  it("409 checkout_unavailable → 'Tickets not issued', no charge claim, no Try again — never 'Payment received'", async () => {
    invoke.mockResolvedValue(refusedAfterPayment());

    const tree = await mount(ConfirmScreen);
    const text = visibleText(tree);

    expect(invoke).toHaveBeenCalledWith("ticket-checkout-confirm", {
      body: { checkoutSessionId: SESSION_ID, buyerStatusToken: BUYER_TOKEN },
    });
    expect(text).toContain(TICKETS_NOT_ISSUED_TITLE);
    expect(text).toContain(TICKETS_NOT_ISSUED_MESSAGE);
    expect(text).not.toContain("Payment received");
    expect(text).not.toContain("Confirming your tickets");
    // THE MONEY ASSERTION. All three of this endpoint's 409s are raised AFTER
    // `paymentIntent.status === "succeeded"`, so the guest has paid. The screen
    // must not tell them they were not charged, must not promise a refund
    // #2079's attention path may never execute, and must NOT offer to start the
    // purchase again — that is how a charged guest pays twice.
    expect(text).not.toMatch(/been charged/i);
    expect(text).not.toMatch(/refunded/i);
    expect(tree.root.findAllByProps({ testID: "btn-Try again" })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: "ticket-confirm-ending-not_issued" }).length)
      .toBeGreaterThan(0);
    // A refusal is an answer: asked once, and the guest is not bounced to the cart.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it("the way out disarms the back guard and returns the guest to the event", async () => {
    invoke.mockResolvedValue(refusedAfterPayment());
    const tree = await mount(ConfirmScreen);

    // Before the CTA: the screen blocks native back, as always.
    const before = jest.fn();
    navListeners.beforeRemove?.({ preventDefault: before });
    expect(before).toHaveBeenCalledTimes(1);

    await press(tree, "btn-Back to event");

    expect(router.replace).toHaveBeenCalledWith(
      eventPublicPath({ brandSlug: "refused-brand", eventSlug: "refused-night" }),
    );
    // After the CTA: the same guard lets the sanctioned exit through.
    const after = jest.fn();
    navListeners.beforeRemove?.({ preventDefault: after });
    expect(after).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount();
    });
  });

  it("an expired checkout ends DIFFERENTLY — it is the one refusal that proves no charge", async () => {
    invoke.mockResolvedValue(answer("expired"));
    const tree = await mount(ConfirmScreen);
    const text = visibleText(tree);
    expect(text).toContain(TICKETS_EXPIRED_TITLE);
    expect(text).toContain(TICKETS_EXPIRED_MESSAGE);
    expect(text).not.toContain("Payment received");
    // The two refusals must never be shown as the same event: this one really
    // can say "you haven't been charged", and really can invite a retry.
    expect(text).not.toContain(TICKETS_NOT_ISSUED_MESSAGE);
    expect(tree.root.findAllByProps({ testID: "btn-Try again" }).length).toBeGreaterThan(0);
    await act(async () => {
      tree.unmount();
    });
  });

  it("a refusal that arrives after a pending answer replaces the spinner", async () => {
    invoke
      .mockResolvedValueOnce(answer("pending"))
      .mockResolvedValueOnce(refusedAfterPayment());
    const tree = await mount(ConfirmScreen);

    // Genuinely pending: the calm loading copy is unchanged (ORCH-0911).
    expect(visibleText(tree)).toContain("Payment received. Your tickets will appear here in a moment.");

    await settle(1000);
    await settle(0);
    const text = visibleText(tree);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(text).toContain(TICKETS_NOT_ISSUED_MESSAGE);
    expect(text).not.toContain("Payment received");
    await act(async () => {
      tree.unmount();
    });
  });

  it("the #2198 Paystack copy still wins for a Paystack token", async () => {
    invoke.mockResolvedValue(answer("failed", { error: "paystack_charge_failed" }));
    const tree = await mount(ConfirmScreen);
    const text = visibleText(tree);
    expect(text).toContain(PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE);
    expect(text).not.toContain(TICKETS_NOT_ISSUED_MESSAGE);
    await act(async () => {
      tree.unmount();
    });
  });
});

describe("event confirm — a slow answer is bounded at 60 s", () => {
  it("keeps polling, then says 'Still confirming' with Back to event; a late order still wins", async () => {
    invoke.mockResolvedValue(answer("pending"));
    const tree = await mount(ConfirmScreen);

    expect(visibleText(tree)).toContain("Payment received. Your tickets will appear here in a moment.");
    // Realtime runs alongside the poll.
    expect(realtimeArgs?.checkoutSessionId).toBe(SESSION_ID);

    for (let i = 0; i < 62; i += 1) await settle(1000);

    const text = visibleText(tree);
    expect(text).toContain(TICKETS_STILL_CONFIRMING_TITLE);
    expect(text).toContain(TICKETS_STILL_CONFIRMING_MESSAGE);
    expect(text).not.toContain("Payment received");
    expect(tree.root.findAllByProps({ testID: "btn-Back to event" }).length).toBeGreaterThan(0);

    // Polling, not a single call — and it stopped at the cap.
    const confirmCalls = invoke.mock.calls.filter((c) => c[0] === "ticket-checkout-confirm").length;
    expect(confirmCalls).toBeGreaterThan(5);
    for (let i = 0; i < 30; i += 1) await settle(1000);
    expect(invoke.mock.calls.filter((c) => c[0] === "ticket-checkout-confirm").length).toBe(confirmCalls);

    // Realtime is still listening, and a late order replaces "still confirming".
    expect(realtimeArgs?.checkoutSessionId).toBe(SESSION_ID);
    await act(async () => {
      realtimeArgs?.onOrderReady({
        orderId: "ord-late",
        checkoutSessionId: SESSION_ID,
        eventId: EVENT_ID,
        paymentStatus: "paid",
        totalCents: 2500,
        currency: "GBP",
        taxAmountCents: 0,
        tickets: [],
        notificationStatus: "queued",
      });
    });
    await settle(0);
    const late = visibleText(tree);
    expect(late).not.toContain(TICKETS_STILL_CONFIRMING_TITLE);
    expect(late).toContain("ord-late");

    await act(async () => {
      tree.unmount();
    });
  });
});

describe("trip and experience confirm — surface parity", () => {
  // Parity here is MANUAL: three separate route files render the same verdict.
  // The money rule has to hold on all three or a guest finds the honest copy on
  // one surface and the dishonest one on another.
  const surfaces: Array<[string, React.ComponentType, string, string]> = [
    ["trip", TripConfirmScreen, "/t/refused-brand/refused-trip", "Back to trip"],
    [
      "experience",
      ExperienceConfirmScreen,
      "/exp/refused-brand/refused-experience",
      "Back to experience",
    ],
  ];

  for (const [name, Screen, path, backLabel] of surfaces) {
    it(`${name}: 409 checkout_unavailable → not issued, no charge claim, no retry`, async () => {
      invoke.mockResolvedValue(refusedAfterPayment());
      const tree = await mount(Screen);
      const text = visibleText(tree);
      expect(text).toContain(TICKETS_NOT_ISSUED_MESSAGE);
      expect(text).not.toContain("Payment received");
      expect(text).not.toContain("Confirming your reservation");
      expect(text).not.toMatch(/been charged/i);
      expect(text).not.toMatch(/refunded/i);
      expect(tree.root.findAllByProps({ testID: "btn-Try again" })).toHaveLength(0);
      await press(tree, `btn-${backLabel}`);
      expect(router.replace).toHaveBeenCalledWith(path);
      await act(async () => {
        tree.unmount();
      });
    });

    it(`${name}: an expired checkout gets the unpaid ending, not the refusal`, async () => {
      invoke.mockResolvedValue(answer("expired"));
      const tree = await mount(Screen);
      const text = visibleText(tree);
      expect(text).toContain(TICKETS_EXPIRED_MESSAGE);
      expect(text).not.toContain(TICKETS_NOT_ISSUED_MESSAGE);
      expect(text).not.toContain("Payment received");
      await act(async () => {
        tree.unmount();
      });
    });
  }
});
