/**
 * issue #2198 [paystack-return-verify] — the guest-facing half.
 *
 * WHAT HAPPENED IN PRODUCTION. A guest paid ₦100 by bank transfer at 01:41:05.
 * The `charge.success` webhook — the ONLY thing that could finish the order —
 * arrived at 01:45:11. For 4m 06s the confirmation screen showed:
 *
 *     "Confirming your tickets… Payment received. Your tickets will appear
 *      here in a moment."
 *
 * and there was no path out of it other than the webhook. If the webhook had
 * been dropped, that screen would have said the same thing forever.
 *
 * WHY IT IS WRITTEN THIS WAY. It mounts the REAL confirmation screen inside the
 * REAL CartProvider and lets the REAL `confirmTicketCheckout` run, stubbing
 * only the Supabase transport. So it asserts what the guest actually SEES for
 * each server answer — not that some intermediate function was called.
 *
 * THE THREE CASES, and which ones distinguish:
 *
 *   - paid + order        → the tickets render. PASSES on the old code too
 *     (once the server answers "paid"), so it is never asserted on its own; it
 *     is here to prove the render path still works off the Paystack answer.
 *   - failed + reason     → the one that fails on today's code. The old screen
 *     had no `failed` branch at all: every non-paid answer became the spinner.
 *   - pending             → still the calm spinner. This is the case that must
 *     NOT regress — an in-flight charge must never be shown as a failure.
 *
 * FAILS-ON-REVERT: remove the `confirmResult.status === "failed"` branch from
 * `app/checkout/[eventId]/confirm.tsx` (restore the straight fall-through to
 * `setRealtimePending`) and the failure cases go red — the screen shows
 * "Confirming your tickets…" for a declined charge. Removing the three
 * `paystack_*` branches from `paidCheckoutErrorMessage` turns the copy
 * assertions red instead.
 *
 * Owner: mingla-implementor. Issue: #2198.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Renderer = {
  root: { findAllByProps: (p: Record<string, unknown>) => unknown[] };
  toJSON: () => unknown;
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const EVENT_ID = "evt-2198";
const SESSION_ID = "06fd4518-b4aa-48c8-b528-7f36f33dcbce";
const ORDER_ID = "56471853-07f8-4ed3-94c8-d83cd5260ad5";
const BUYER_TOKEN = "bst-2198";

/** Captures every edge invocation the screen makes. */
const invoke = jest.fn();

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
  useNavigation: () => ({ addListener: () => () => undefined }),
  // `tripEventId` is read by the trip copy of this screen (parity block below);
  // the event screen only ever reads `eventId`.
  useLocalSearchParams: () => ({ eventId: EVENT_ID, tripEventId: EVENT_ID }),
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
        id: EVENT_ID,
        name: "Lagos Paid Night",
        brandSlug: "minglanigeria",
        eventSlug: "lagos-paid-night",
        currency: "NGN",
        themeOverrides: null,
        tickets: [],
        // The summary card renders `formatDraftDateLine(event)`.
        whenMode: "single",
        date: "2026-09-12",
        doorsOpen: "20:00",
        endsAt: null,
        timezone: "Africa/Lagos",
        masterStartAtUtc: null,
        masterEndAtUtc: null,
        multiDates: null,
      },
      brand: { theme: null },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));
jest.mock("../../../../src/hooks/useOrderRealtimeSubscription", () => ({
  useOrderRealtimeSubscription: () => undefined,
}));
// The TRIP confirmation surface is a second copy of this screen and returns
// through the SAME server path, so it is mounted here too (surface parity).
jest.mock("../../../../src/hooks/usePublicTripById", () => ({
  usePublicTripById: () => ({
    data: null,
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
    Button: (props: { label: string; onPress?: () => void }) => (
      <Pressable
        testID={`btn-${props.label}`}
        accessibilityLabel={props.label}
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
import {
  PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE,
  PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE,
  PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
  paidCheckoutErrorMessage,
  PAID_CHECKOUT_IN_PROGRESS_MESSAGE,
  PAID_CHECKOUT_UNAVAILABLE_MESSAGE,
} from "../../../../src/services/ticketCheckoutService";
import ConfirmScreen from "../confirm";
import TripConfirmScreen from "../../../checkout-trip/[tripEventId]/confirm";

/** Everything the rendered tree says, flattened. */
const visibleText = (tree: Renderer): string => JSON.stringify(tree.toJSON());

/** Arrives exactly the way Paystack sends the guest back. */
const arriveFromPaystack = (): void => {
  const win = globalThis as unknown as {
    location?: { search?: string };
    sessionStorage?: Storage;
  };
  win.location = {
    search: `?cs=paystack&csi=${SESSION_ID}&bst=${BUYER_TOKEN}`,
  } as never;
};

const mountConfirm = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <CartProvider>
        <ConfirmScreen />
      </CartProvider>,
    );
  });
  // Let the isClient timeout + the confirm promise settle.
  await act(async () => {
    jest.advanceTimersByTime(10);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
};

describe("issue #2198 — the Paystack return leg the guest actually sees", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    invoke.mockReset();
    router.replace.mockReset();
    arriveFromPaystack();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("verified success → the tickets render, off the RETURN LEG, with no webhook", async () => {
    invoke.mockResolvedValue({
      data: {
        checkoutSessionId: SESSION_ID,
        status: "paid",
        order: {
          orderId: ORDER_ID,
          eventId: EVENT_ID,
          paymentStatus: "paid",
          totalCents: 10000,
          currency: "NGN",
          taxAmountCents: 0,
          tickets: [{
            ticketId: "t-2198",
            ticketTypeId: "tt-2198",
            ticketName: "General Admission",
            qrPayload: "mgl:2198:qr",
            qrImageDataUrl: "data:image/png;base64,AA",
            status: "valid",
          }],
          notificationStatus: "queued",
        },
      },
      error: null,
    });

    const tree = await mountConfirm();

    expect(invoke).toHaveBeenCalledWith(
      "ticket-checkout-confirm",
      expect.objectContaining({
        body: {
          checkoutSessionId: SESSION_ID,
          buyerStatusToken: BUYER_TOKEN,
        },
      }),
    );
    const text = visibleText(tree);
    expect(text).not.toContain("Confirming your tickets");
    await act(async () => {
      tree.unmount();
    });
  });

  it("Paystack says the charge FAILED → the guest is told why, instead of the endless spinner", async () => {
    invoke.mockResolvedValue({
      data: {
        checkoutSessionId: SESSION_ID,
        status: "failed",
        order: null,
        error: "paystack_charge_failed",
      },
      error: null,
    });

    const tree = await mountConfirm();
    const text = visibleText(tree);

    // The assertion the whole change exists for.
    expect(text).toContain(PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE);
    expect(text).not.toContain("Confirming your tickets");
    expect(text).not.toContain("Payment received");
    // And the guest is left on /confirm to read it, not bounced to the cart.
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it("Paystack says ABANDONED → its own reason, not the generic failure", async () => {
    invoke.mockResolvedValue({
      data: {
        checkoutSessionId: SESSION_ID,
        status: "failed",
        order: null,
        error: "paystack_charge_abandoned",
      },
      error: null,
    });

    const tree = await mountConfirm();
    const text = visibleText(tree);
    expect(text).toContain(PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE);
    expect(text).not.toContain(PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE);
    await act(async () => {
      tree.unmount();
    });
  });

  it("an amount/currency mismatch NEVER claims the guest was not charged", async () => {
    invoke.mockResolvedValue({
      data: {
        checkoutSessionId: SESSION_ID,
        status: "failed",
        order: null,
        error: "paystack_payment_mismatch",
      },
      error: null,
    });

    const tree = await mountConfirm();
    const text = visibleText(tree);
    expect(text).toContain(PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE);
    // This is the ONE case where money may genuinely have moved. Saying "you
    // have not been charged" here would be a lie.
    expect(PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE).not.toContain(
      "You have not been charged",
    );
    expect(PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE).toContain("support@usemingla.com");
    await act(async () => {
      tree.unmount();
    });
  });

  it("a still-in-flight charge keeps the calm spinner — an unresolved payment is never shown as failed", async () => {
    invoke.mockResolvedValue({
      data: { checkoutSessionId: SESSION_ID, status: "pending", order: null },
      error: null,
    });

    const tree = await mountConfirm();
    const text = visibleText(tree);
    expect(text).toContain("Confirming your tickets");
    expect(text).not.toContain(PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE);
    await act(async () => {
      tree.unmount();
    });
  });
});

describe("issue #2198 — the TRIP confirmation surface behaves identically", () => {
  // A trip sold by a Nigerian brand rides the exact same
  // create -> Paystack -> confirm path; the screen is just a second copy.
  // Surface parity is a standing contract, so it is asserted, not assumed.
  beforeEach(() => {
    jest.useFakeTimers();
    invoke.mockReset();
    router.replace.mockReset();
    const win = globalThis as unknown as { location?: { search?: string } };
    win.location = {
      search: `?cs=paystack&csi=${SESSION_ID}&bst=${BUYER_TOKEN}`,
    } as never;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const mountTrip = async (): Promise<Renderer> => {
    let tree!: Renderer;
    await act(async () => {
      tree = TestRenderer.create(
        <CartProvider>
          <TripConfirmScreen />
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

  it("a declined charge reads as a declined charge, not 'Confirming your reservation…'", async () => {
    invoke.mockResolvedValue({
      data: {
        checkoutSessionId: SESSION_ID,
        status: "failed",
        order: null,
        error: "paystack_charge_failed",
      },
      error: null,
    });
    const tree = await mountTrip();
    const text = visibleText(tree);
    expect(text).toContain(PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE);
    expect(text).not.toContain("Confirming your reservation");
    expect(router.replace).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
  });

  it("an in-flight charge still shows the calm spinner", async () => {
    invoke.mockResolvedValue({
      data: { checkoutSessionId: SESSION_ID, status: "pending", order: null },
      error: null,
    });
    const tree = await mountTrip();
    const text = visibleText(tree);
    expect(text).toContain("Confirming your reservation");
    expect(text).not.toContain(PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE);
    await act(async () => {
      tree.unmount();
    });
  });
});

describe("issue #2198 — the #2188 error mapper carries the new reasons", () => {
  it("maps each bounded return-leg token to its own copy", () => {
    expect(paidCheckoutErrorMessage({ code: "paystack_charge_failed" }))
      .toBe(PAID_CHECKOUT_PAYMENT_FAILED_MESSAGE);
    expect(paidCheckoutErrorMessage({ code: "paystack_charge_abandoned" }))
      .toBe(PAID_CHECKOUT_PAYMENT_ABANDONED_MESSAGE);
    expect(paidCheckoutErrorMessage({ code: "paystack_payment_mismatch" }))
      .toBe(PAID_CHECKOUT_PAYMENT_MISMATCH_MESSAGE);
  });

  it("leaves #2188's own tokens exactly as they were", () => {
    expect(paidCheckoutErrorMessage({ code: "checkout_in_progress" }))
      .toBe(PAID_CHECKOUT_IN_PROGRESS_MESSAGE);
    expect(paidCheckoutErrorMessage({ code: "checkout_unavailable" }))
      .toBe(PAID_CHECKOUT_UNAVAILABLE_MESSAGE);
    // A bare 409 with no readable body still means "wait a minute", NOT one of
    // the new terminal reasons.
    expect(paidCheckoutErrorMessage({ context: { status: 409 } }))
      .toBe(PAID_CHECKOUT_IN_PROGRESS_MESSAGE);
  });

  it("never emits a raw framework string for an unknown reason", () => {
    const message = paidCheckoutErrorMessage(
      new Error("Edge Function returned a non-2xx status code"),
    );
    expect(message).not.toContain("Edge Function");
    expect(message).toContain("You have not been charged");
  });
});
