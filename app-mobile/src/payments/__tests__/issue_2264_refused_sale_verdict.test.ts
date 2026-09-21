/**
 * Consumer native checkout — a sale REFUSED after payment is an answer.
 *
 * Extends #2264's contract ("the checkout-status answer is never discarded") to
 * the one answer that arrives as an HTTP error rather than a body:
 * `ticket-checkout-status` answers HTTP 409
 * `{ error: "checkout_unavailable" }` when the checkout was revoked or the
 * payment is being reversed (refunded automatically). supabase-js hands that
 * back as `error` with `data` null, and the Paystack poll read only `data` — so
 * the refusal counted as "no answer yet", the buyer waited out the whole budget,
 * and was then told Paystack "hasn't confirmed this payment yet".
 *
 * Runs the REAL `useNativeCheckoutFlow` with only the transport, the browser and
 * the Stripe SDK stubbed (same harness as
 * `issue_2264_checkout_outcome_honesty.test.ts`). Lives in the #2264 family so
 * the existing CI glob for this directory runs it.
 *
 * FAILS ON REVERT: restore `nativeCheckoutFlow.ts` and `checkoutErrorMessages.ts`
 * from origin/main and every flow case below goes red (17 polls, awaiting copy).
 */

const mockInvoke = jest.fn();
const mockOpenBrowserAsync = jest.fn();
const mockInitPaymentSheet = jest.fn();
const mockPresentPaymentSheet = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
  openAuthSessionAsync: jest.fn(),
  WebBrowserResultType: {
    CANCEL: "cancel",
    DISMISS: "dismiss",
    OPENED: "opened",
    LOCKED: "locked",
  },
}));

jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({
    initPaymentSheet: (...args: unknown[]) => mockInitPaymentSheet(...args),
    presentPaymentSheet: (...args: unknown[]) => mockPresentPaymentSheet(...args),
    isPaymentSheetSupported: true,
  }),
}));

jest.mock("@stripe/stripe-react-native", () => ({
  initStripe: jest.fn(),
}));

import {
  clearAllHeldHandoffs,
  useNativeCheckoutFlow,
} from "../nativeCheckoutFlow";
import {
  CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
  CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
  NATIVE_CHECKOUT_MESSAGES,
  NATIVE_CONFIRMATION_VERDICT_MESSAGES,
  NATIVE_PAYSTACK_RETURN_MESSAGES,
  nativePaystackReturnMessage,
} from "../checkoutErrorMessages";

const AUTH_URL = "https://checkout.paystack.com/refused-1";

let eventSeq = 0;
const nextEventId = (): string => `event-refused-${++eventSeq}`;

const inputFor = (eventId: string): Parameters<
  ReturnType<typeof useNativeCheckoutFlow>
>[0] => ({
  eventId,
  lines: [{ ticketTypeId: "tt-ga", quantity: 1 }],
  buyer: { name: "Ada Buyer", email: "ada@example.com", phone: "+2348012345678" },
});

const paystackCreate = (eventId: string) => ({
  data: {
    kind: "requires_paystack_redirect",
    checkoutSessionId: `cs-${eventId}`,
    buyerStatusToken: `bst-${eventId}`,
    authorizationUrl: AUTH_URL,
    returnUrl: `https://host.usemingla.com/checkout/${eventId}/confirm`,
    reference: "ref-1",
    totalCents: 10000,
    currency: "NGN",
  },
  error: null,
});

/** supabase-js wraps a non-2xx edge response in a FunctionsHttpError. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: { status, text: async () => JSON.stringify(body) },
  },
});

/** Exactly `ticket-checkout-status`'s refusal: `checkoutUnavailableResponse()` at 409. */
const refused = () =>
  httpError(409, {
    error: "checkout_unavailable",
    message: "This sale is no longer available.",
  });

const stillPending = () => ({
  data: { checkoutSessionId: "cs", status: "awaiting_web_redirect", order: null },
  error: null,
});

const countInvokes = (fn: string): number =>
  mockInvoke.mock.calls.filter((call) => call[0] === fn).length;

let sleeps: number[] = [];

beforeEach(() => {
  jest.resetAllMocks();
  sleeps = [];
  clearAllHeldHandoffs();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" });
  jest
    .spyOn(global, "setTimeout")
    .mockImplementation(((fn: () => void, ms?: number) => {
      sleeps.push(ms ?? 0);
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Paystack return — a 409 refusal ends the poll on the first answer", () => {
  it("says no tickets were issued and the payment is refunded, after ONE status read and no sleep", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(refused());

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
      token: "checkout_unavailable",
    });
    expect(countInvokes("ticket-checkout-status")).toBe(1);
    expect(sleeps).toEqual([]);
    if (result.outcome === "failed") {
      expect(result.message).not.toBe(CHECKOUT_AWAITING_CONFIRMATION_MESSAGE);
    }
  });

  it("a refusal after a pending answer still ends the wait", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(stillPending())
      .mockResolvedValueOnce(refused());

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(result.message).toBe(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE);
    }
    expect(countInvokes("ticket-checkout-status")).toBe(2);
    expect(sleeps).toEqual([1500]);
  });

  it("a 409 whose body cannot be read is still a refusal", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "FunctionsHttpError",
          message: "Edge Function returned a non-2xx status code",
          context: { status: 409 },
        },
      });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
      token: null,
    });
  });

  it("the refused checkout's page is released — the next tap creates afresh instead of re-opening it", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(refused());
    const run = useNativeCheckoutFlow();
    await run(inputFor(eventId));

    // The organiser's sale is closed now, so the second create is refused too.
    mockInvoke.mockResolvedValueOnce(refused());
    const second = await run(inputFor(eventId));

    expect(second.outcome).toBe("failed");
    expect(countInvokes("ticket-checkout-create")).toBe(2);
    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(1);
  });

  it("the SAME token at HTTP 200 is the same refusal, and releases the page too", async () => {
    // #2198's verifier emits `checkout_unavailable` at HTTP 200 for exactly one
    // state: `paid_reversal_pending` — the guest HAS paid and the sale moved
    // under the charge. Routing it to the ordinary terminal arm would keep the
    // held Paystack page alive and invite that guest to pay a second time.
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce({
        data: {
          checkoutSessionId: "cs-200-reversal",
          status: "failed",
          order: null,
          error: "checkout_unavailable",
        },
        error: null,
      });
    const run = useNativeCheckoutFlow();
    const result = await run(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
      token: "checkout_unavailable",
    });
    expect(countInvokes("ticket-checkout-status")).toBe(1);

    // The page is released: the next tap creates a fresh checkout rather than
    // re-opening the one whose charge is being reversed.
    mockInvoke.mockResolvedValueOnce(refused());
    await run(inputFor(eventId));
    expect(countInvokes("ticket-checkout-create")).toBe(2);
  });

  it("a non-409 error is NOT a refusal — it keeps waiting within the budget", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    for (let i = 0; i < 17; i++) {
      mockInvoke.mockResolvedValueOnce(httpError(503, { error: "status_lookup_failed" }));
    }

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
      token: null,
    });
    expect(countInvokes("ticket-checkout-status")).toBe(17);
  });
});

describe("the not-issued copy — its own codomain, and honest about the money", () => {
  it("is exact", () => {
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).toBe(
      "We couldn't issue your tickets for this sale. If your payment went through, we're sorting it out and will email you — please don't pay again. Contact support@usemingla.com and we'll pick it up from there.",
    );
  });

  it("lives in the confirmation-verdict array and in neither pinned codomain", () => {
    expect(NATIVE_CONFIRMATION_VERDICT_MESSAGES).toContain(
      CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
    );
    // The create-leg walkers require "you have not been charged" on every
    // member of NATIVE_CHECKOUT_MESSAGES. That clause is exactly what a
    // return-leg verdict must not carry.
    expect(NATIVE_CHECKOUT_MESSAGES).not.toContain(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE);
    expect(NATIVE_PAYSTACK_RETURN_MESSAGES).not.toContain(
      CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
    );
  });

  it("makes no claim about the charge and promises no refund", () => {
    // THE REGRESSION. `checkout_unavailable` reaches the return leg only after
    // a completed charge (#2198's paid_reversal_pending arm) or a revoked sale.
    // Saying "you have not been charged" is false for the one guest who most
    // needs the truth, and promising a refund pre-empts #2079, where two of the
    // three server refusals park the money for a person to resolve — possibly
    // by completing the sale.
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).not.toMatch(/been charged/i);
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).not.toMatch(/refund/i);
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).toMatch(/don't pay again/i);
    // A next step, never a dead end.
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).toMatch(/support@usemingla\.com/);
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).not.toMatch(/^[a-z0-9_]+$/);
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).toMatch(/[.!]$/);
  });

  it("the create-leg sentence never reaches a return-leg guest again", () => {
    // `nativePaystackReturnMessage` still maps this token to the create-leg
    // sentence as its totality fallback, and two suites already on main pin
    // that. What changed is that the FLOW no longer routes a return-leg
    // `checkout_unavailable` through that mapper at all — proved above, where
    // the HTTP 200 case comes back as the refusal verdict instead.
    expect(nativePaystackReturnMessage("checkout_unavailable")).toMatch(
      /have not been charged/i,
    );
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).not.toBe(
      nativePaystackReturnMessage("checkout_unavailable"),
    );
  });
});
