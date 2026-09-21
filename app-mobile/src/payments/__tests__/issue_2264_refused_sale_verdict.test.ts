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
      "We couldn't issue your tickets. You haven't been charged — any payment is being refunded in full. Try again or contact the organiser.",
    );
  });

  it("lives in the confirmation-verdict array and in neither pinned codomain", () => {
    expect(NATIVE_CONFIRMATION_VERDICT_MESSAGES).toContain(
      CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
    );
    expect(NATIVE_CHECKOUT_MESSAGES).not.toContain(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE);
    expect(NATIVE_PAYSTACK_RETURN_MESSAGES).not.toContain(
      CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
    );
  });

  it("every confirmation verdict says what happened to the money and reads as a sentence", () => {
    for (const message of NATIVE_CONFIRMATION_VERDICT_MESSAGES) {
      expect(message).toMatch(/charged|pay again/i);
      expect(message).not.toMatch(/^[a-z0-9_]+$/);
      expect(message).toMatch(/[.!]$/);
    }
    expect(CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE).toMatch(/refunded in full/);
  });
});
