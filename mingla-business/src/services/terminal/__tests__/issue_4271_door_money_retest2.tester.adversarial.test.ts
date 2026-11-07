/**
 * #4271 retest 2 — adversarial: the eight fixes made after the final test.
 *
 * A different angle from the builder's tests, which pin the named cases:
 *   P1 a provider value the guest page can't trust (wrong case, another
 *      provider, a number, missing) reads as unknown, and an unknown or
 *      Paystack provider never says "weren't charged" on any closed status.
 *   P2 a guest back from the provider page (?paid=1) on a Stripe code that is
 *      closed with no late payment keeps waiting: the poll never settles on
 *      "You weren't charged". (The guest-copy DEFECT probe in
 *      issue_4271_door_sale_surfaces.render.test.tsx has no provider in its
 *      view, so since the Paystack fix it passes even with this guard removed.)
 *   T1 every PaymentIntent status Stripe can hand back that is neither
 *      succeeded nor requires_payment_method, with or without an error, is an
 *      unknown result: no decline, no "Nothing was charged", no pay code, and
 *      "Try again" confirms the SAME collected intent without a second tap.
 *   T2 the ready-screen limit is a relative timer: a phone clock jumping hours
 *      ahead or behind neither cancels early nor stops it cancelling at 10
 *      minutes.
 *   T3 a card read at the last moment before the limit is never cancelled:
 *      confirm may take far longer than 10 minutes and the sale still records.
 *   T4 the limit firing while the SDK has already finished reading the card
 *      (cancel refused) still records the sale; the refusal is reported.
 *   A1 Tap to Pay on Android checks and asks for COARSE location only, on every
 *      API level Tap to Pay runs on, never fine or Bluetooth, and a refusal
 *      (denied or never ask again) is false.
 *
 * fails-on-revert (verified by retest 2 at 63ac7e962b, recorded on the issue):
 *   P1: doorPayGuestEndCopy ignores the provider (67b598cf16 body)   -> P1 fails
 *   P2: doorPayGuestReturnSettled returns true for any status        -> P2 fails
 *   T1: confirm() back to `status !== "succeeded"` -> declined        -> T1 (no
 *       error) fails; the with-error cases also held before the fix and
 *       guard against a future narrowing
 *   T2-T4: TAP_READY_LIMIT timer removed from emit()                  -> T2, T4
 *       fail; T3 guards against a timer that would cancel mid-confirm
 *   A1: tapToPayAndroidLocation asks for ACCESS_FINE_LOCATION         -> A1 fails
 */
import { describe, expect, jest, test } from "@jest/globals";

const mockCheck = jest.fn<(permission: string) => Promise<boolean>>();
const mockRequest = jest.fn<(permission: string, rationale?: unknown) => Promise<string>>();
jest.mock("react-native", () => ({
  Platform: { OS: "android", Version: 33, select: (o: Record<string, unknown>) => o.android ?? o.default },
  PermissionsAndroid: {
    PERMISSIONS: {
      ACCESS_COARSE_LOCATION: "android.permission.ACCESS_COARSE_LOCATION",
      ACCESS_FINE_LOCATION: "android.permission.ACCESS_FINE_LOCATION",
      BLUETOOTH_CONNECT: "android.permission.BLUETOOTH_CONNECT",
      BLUETOOTH_SCAN: "android.permission.BLUETOOTH_SCAN",
    },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
    check: (permission: string) => mockCheck(permission),
    request: (permission: string, rationale?: unknown) => mockRequest(permission, rationale),
  },
}));
jest.mock("../../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../../ticketCheckoutService", () => ({ ticketCheckoutProviderHandoff: jest.fn() }));

import {
  TAP_READY_LIMIT_MS,
  TapToPaySaleFlow,
  type TapSaleState,
  type TapToPayServer,
  type TapToPayTerminalClient,
  type TerminalCallResult,
  type TerminalPaymentIntentLike,
} from "../tapToPayFlow";
import type { DoorTapIntent } from "../doorTapEdge";
import { hasTapToPayLocation, requestTapToPayLocation } from "../tapToPayAndroidLocation";
import { parseDoorPayCodeView } from "../../doorPayCodeServiceImpl";
import { doorPayGuestEndCopy, doorPayGuestReturnSettled } from "../../../components/door/doorPayGuestState";

// ---- P1 / P2: the guest page ------------------------------------------------

const VIEW_BASE: Record<string, unknown> = {
  status: "expired",
  eventId: "event-1",
  eventDateId: null,
  eventName: "Night",
  eventStartsAt: null,
  venueLabel: null,
  brandName: "Brand",
  lines: [],
  subtotalCents: 3000,
  feeCents: 135,
  totalCents: 3135,
  currency: "GBP",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const NOT_CHARGED = /weren't charged|not charged|wasn't charged|haven't been charged/i;

describe("#4271 retest 2 P1: an untrusted provider never reads as a confirmed close", () => {
  test.each([["PAYSTACK"], ["Stripe"], ["flutterwave"], [""], [42], [null], [undefined], [{ name: "stripe" }]])(
    "provider %p parses as unknown, and the closed-code copy then never says not charged",
    (provider) => {
      const view = parseDoorPayCodeView({ ...VIEW_BASE, ...(provider === undefined ? {} : { provider }) });
      expect(view.provider).toBeNull();
      for (const status of ["expired", "cancelled"] as const) {
        const copy = doorPayGuestEndCopy(status, view.provider);
        expect(`${copy.title} ${copy.body}`).not.toMatch(NOT_CHARGED);
        expect(copy.body).toContain("refunded to you in full");
      }
    },
  );

  // "failed" is left out: no server path writes a door code's status to failed
  // (a decline leaves the code open), so its copy is unreachable today.
  test("Paystack never says not charged on any closed status; only Stripe may on expired or cancelled", () => {
    for (const status of ["expired", "cancelled", "paid"] as const) {
      const paystack = doorPayGuestEndCopy(status, "paystack");
      expect(`${paystack.title} ${paystack.body}`).not.toMatch(NOT_CHARGED);
    }
    expect(parseDoorPayCodeView({ ...VIEW_BASE, provider: "stripe" }).provider).toBe("stripe");
    expect(parseDoorPayCodeView({ ...VIEW_BASE, provider: "paystack" }).provider).toBe("paystack");
    expect(doorPayGuestEndCopy("expired", "stripe").body).toMatch(NOT_CHARGED);
    expect(doorPayGuestEndCopy("cancelled", "stripe").body).toMatch(NOT_CHARGED);
  });
});

describe("#4271 retest 2 P2: a guest back from a paid provider page keeps waiting on a closed Stripe code", () => {
  test.each([["expired"], ["cancelled"], ["failed"], ["open"], ["opened"], ["payment_landing"], ["checking"]])(
    "a %s code with no late payment does not settle the return poll",
    (status) => {
      expect(doorPayGuestReturnSettled({ status: status as never, latePayment: null })).toBe(false);
    },
  );

  test("the return settles only on paid or a named late payment", () => {
    expect(doorPayGuestReturnSettled({ status: "paid", latePayment: null })).toBe(true);
    expect(
      doorPayGuestReturnSettled({
        status: "cancelled",
        latePayment: { state: "refunding", amountCents: 3135, currency: "GBP" } as never,
      }),
    ).toBe(true);
  });
});

// ---- T1-T4: the Tap to Pay flow ---------------------------------------------

const INTENT: DoorTapIntent = {
  paymentIntentId: "pi_r2",
  clientSecret: "pi_r2_secret",
  totalCents: 3135,
  currency: "GBP",
  stripeAccountId: "acct_1",
  locationId: "tml_1",
};
const PI_NEW = { id: "pi_r2", status: "requires_payment_method" };
const PI_COLLECTED = { id: "pi_r2", status: "requires_confirmation" };
const PI_SUCCEEDED = { id: "pi_r2", status: "succeeded" };

type Deferred = { promise: Promise<TerminalCallResult>; resolve: (value: TerminalCallResult) => void };
const deferred = (): Deferred => {
  let resolve: (value: TerminalCallResult) => void = () => undefined;
  const promise = new Promise<TerminalCallResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const harness = (opts: {
  collect?: Array<TerminalCallResult | Deferred>;
  confirm?: Array<TerminalCallResult | Deferred>;
  cancelCollect?: () => Promise<TerminalCallResult>;
} = {}) => {
  const states: TapSaleState[] = [];
  const collectQueue = [...(opts.collect ?? [])];
  const confirmQueue = [...(opts.confirm ?? [])];
  const collected: string[] = [];
  const confirmed: string[] = [];
  const reported: string[] = [];
  const next = async (queue: Array<TerminalCallResult | Deferred>, fallback: TerminalCallResult) => {
    const item = queue.shift();
    if (item === undefined) return fallback;
    return "promise" in item ? item.promise : item;
  };
  const terminal: TapToPayTerminalClient = {
    ensureReaderConnected: jest.fn(async () => ({})),
    retrievePaymentIntent: jest.fn(async () => ({ paymentIntent: PI_NEW })),
    collectPaymentMethod: jest.fn(async (pi: TerminalPaymentIntentLike) => {
      collected.push(String(pi.id));
      return next(collectQueue, { paymentIntent: PI_COLLECTED });
    }),
    confirmPaymentIntent: jest.fn(async (pi: TerminalPaymentIntentLike) => {
      confirmed.push(String(pi.id));
      return next(confirmQueue, { paymentIntent: PI_SUCCEEDED });
    }),
    cancelCollectPaymentMethod: jest.fn(opts.cancelCollect ?? (async () => ({}))),
  };
  const createIntent = jest.fn<TapToPayServer["createIntent"]>(async () => INTENT);
  const completeIntent = jest.fn<TapToPayServer["completeIntent"]>(async () => ({
    orderId: "ord_r2",
    ticketIds: ["t1"],
    receiptQueued: false,
    replayed: false,
  }));
  const cancelIntent = jest.fn<TapToPayServer["cancelIntent"]>(async () => undefined);
  const flow = new TapToPaySaleFlow({
    eventId: "evt_r2",
    draft: { lines: [{ ticketTypeId: "tt", quantity: 1 }], eventDateId: null, buyerPhone: null, phoneCountryIso: null },
    clientRequestId: "req-r2",
    terminal,
    server: { createIntent, completeIntent, cancelIntent },
    onState: (state) => states.push(state),
    report: (scope) => reported.push(scope),
  });
  return { flow, states, terminal, createIntent, completeIntent, cancelIntent, collected, confirmed, reported };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

const toldNothingCharged = (states: TapSaleState[]): boolean =>
  states.some(
    (s) =>
      s.kind === "declined" ||
      s.kind === "cancelled" ||
      s.kind === "needs_pin" ||
      s.kind === "timed_out" ||
      (s.kind === "failed" && /Nothing was charged/.test(s.message)),
  );

describe("#4271 retest 2 T1: an unsettled PaymentIntent is never a decline", () => {
  // "canceled" left this list in retest 3 P4-6: a canceled PaymentIntent is Stripe's
  // confirmed "no money moved", so it now reads cancelled and a retry makes a fresh
  // intent (pinned in issue_4271_tap_to_pay_flow.implementor.test.ts).
  const UNSETTLED = ["processing", "requires_capture", "requires_confirmation", "requires_action", "some_future_status"];

  test.each(UNSETTLED)("confirm answers %s with no error -> unknown; Try again confirms the same intent, no second tap", async (status) => {
    const h = harness({ confirm: [{ paymentIntent: { id: "pi_r2", status } }, { paymentIntent: PI_SUCCEEDED }] });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("unknown_result");
    expect(toldNothingCharged(h.states)).toBe(false);
    expect(h.completeIntent).not.toHaveBeenCalled();
    // While unknown, a pay code is refused unless the server confirms the cancel; here
    // the cancel succeeds, so the switch is allowed only after the server said so.
    await h.flow.retryConfirm();
    expect(h.flow.getState().kind).toBe("approved");
    expect(h.collected).toEqual(["pi_r2"]);
    expect(h.confirmed).toEqual(["pi_r2", "pi_r2"]);
    expect(h.createIntent).toHaveBeenCalledTimes(1);
    expect(h.completeIntent).toHaveBeenCalledTimes(1);
  });

  test.each(UNSETTLED)("confirm errors with a declined-looking card error but the intent is %s -> unknown", async (status) => {
    const h = harness({
      confirm: [
        {
          error: {
            code: "DECLINED_BY_STRIPE_API",
            apiError: { type: "card_error", code: "card_declined", declineCode: "generic_decline", message: "" },
            paymentIntent: { id: "pi_r2", status },
          },
        },
      ],
    });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("unknown_result");
    expect(toldNothingCharged(h.states)).toBe(false);
  });

  test("requires_payment_method is still the one decline", async () => {
    const h = harness({ confirm: [{ paymentIntent: { id: "pi_r2", status: "requires_payment_method" } }] });
    await h.flow.start();
    expect(h.flow.getState().kind).toBe("declined");
  });
});

describe("#4271 retest 2 T2-T4: the 10-minute ready limit", () => {
  test("T2 a phone clock jumping hours either way neither cancels early nor stops the limit", async () => {
    jest.useFakeTimers();
    try {
      const tap = deferred();
      const h = harness({
        collect: [tap],
        cancelCollect: async () => {
          tap.resolve({ error: { code: "CANCELED" } });
          return {};
        },
      });
      const started = h.flow.start();
      await flush();
      expect(h.flow.getState().kind).toBe("ready");
      jest.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
      await flush();
      jest.setSystemTime(Date.now() - 6 * 60 * 60 * 1000);
      await flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS - 1);
      await flush();
      expect(h.terminal.cancelCollectPaymentMethod).not.toHaveBeenCalled();
      expect(h.flow.getState().kind).toBe("ready");
      jest.advanceTimersByTime(1);
      await started;
      expect(h.terminal.cancelCollectPaymentMethod).toHaveBeenCalledTimes(1);
      expect(h.flow.getState().kind).toBe("cancelled");
      expect(h.confirmed).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  test("T3 a card read just before the limit is never cancelled, even if confirm takes 30 minutes", async () => {
    jest.useFakeTimers();
    try {
      const tap = deferred();
      const confirm = deferred();
      const h = harness({ collect: [tap], confirm: [confirm] });
      const started = h.flow.start();
      await flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS - 1);
      tap.resolve({ paymentIntent: PI_COLLECTED });
      await flush();
      expect(h.flow.getState().kind).toBe("reading");
      jest.advanceTimersByTime(30 * 60 * 1000);
      await flush();
      expect(h.terminal.cancelCollectPaymentMethod).not.toHaveBeenCalled();
      confirm.resolve({ paymentIntent: PI_SUCCEEDED });
      await started;
      expect(h.flow.getState().kind).toBe("approved");
      expect(h.completeIntent).toHaveBeenCalledTimes(1);
      expect(h.states.some((s) => s.kind === "cancelled")).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("T4 the limit firing after the SDK already read the card: cancel refused, sale still recorded", async () => {
    jest.useFakeTimers();
    try {
      const tap = deferred();
      const h = harness({
        collect: [tap],
        cancelCollect: async () => {
          throw new Error("collectPaymentMethod already completed");
        },
      });
      const started = h.flow.start();
      await flush();
      jest.advanceTimersByTime(TAP_READY_LIMIT_MS);
      await flush();
      expect(h.terminal.cancelCollectPaymentMethod).toHaveBeenCalledTimes(1);
      tap.resolve({ paymentIntent: PI_COLLECTED });
      await started;
      expect(h.flow.getState().kind).toBe("approved");
      expect(h.completeIntent).toHaveBeenCalledTimes(1);
      expect(h.states.some((s) => s.kind === "cancelled")).toBe(false);
      expect(h.reported).toContain("door-tap.ready-limit");
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---- A1: Android location ---------------------------------------------------

describe("#4271 retest 2 A1: Tap to Pay on Android asks for coarse location only", () => {
  test("the warm-up checks coarse location and never prompts", async () => {
    mockCheck.mockReset();
    mockRequest.mockReset();
    mockCheck.mockResolvedValue(true);
    expect(await hasTapToPayLocation()).toBe(true);
    expect(mockCheck.mock.calls.map((c) => c[0])).toEqual(["android.permission.ACCESS_COARSE_LOCATION"]);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  test.each([["granted", true], ["denied", false], ["never_ask_again", false]])(
    "a sale asks for coarse location only (answer %s -> %s), never fine or Bluetooth",
    async (answer, expected) => {
      mockCheck.mockReset();
      mockRequest.mockReset();
      mockRequest.mockResolvedValue(answer);
      expect(await requestTapToPayLocation()).toBe(expected);
      const asked = mockRequest.mock.calls.map((c) => c[0]);
      expect(asked).toEqual(["android.permission.ACCESS_COARSE_LOCATION"]);
      expect(asked.some((p) => /FINE|BLUETOOTH/.test(p))).toBe(false);
    },
  );
});
