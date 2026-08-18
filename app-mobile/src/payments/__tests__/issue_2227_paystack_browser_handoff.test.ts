/**
 * issue #2227 [paystack payment page never opens] — implementor happy-path
 * regression.
 *
 * SPEC #2227 §7: T-1 (safe primitive), T-7 (locked → no poll), T-8 (throw → no
 * poll), T-9 (normal dismissal still polls), T-10/T-11 (resume-cache expiry and
 * hit), T-12 (never persisted), T-13 (free + Stripe byte-identical).
 *
 * Fails on revert: restore `openAuthSessionAsync(data.authorizationUrl,
 * data.returnUrl)` and T-1 goes red twice over — the source assertion AND the
 * runtime assertion that iOS is never handed an auth-session redirect again.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockInvoke = jest.fn();
const mockOpenBrowserAsync = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();
const mockInitPaymentSheet = jest.fn();
const mockPresentPaymentSheet = jest.fn();
const mockInitStripe = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
  openAuthSessionAsync: (...args: unknown[]) =>
    mockOpenAuthSessionAsync(...args),
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
  initStripe: (...args: unknown[]) => mockInitStripe(...args),
}));

import { useNativeCheckoutFlow } from "../nativeCheckoutFlow";
import { CHECKOUT_NO_HANDOFF_MESSAGE } from "../checkoutErrorMessages";

const FLOW_SOURCE = readFileSync(
  join(__dirname, "..", "nativeCheckoutFlow.ts"),
  "utf8",
);

const AUTH_URL = "https://checkout.paystack.com/abc123xyz";

/** A distinct event per test keeps the module-level hold-cache from bleeding. */
let eventSeq = 0;
const nextEventId = (): string => `event-2227-${++eventSeq}`;

const inputFor = (eventId: string) => ({
  eventId,
  lines: [{ ticketTypeId: "tt-ga", quantity: 1 }],
  buyer: { name: "Ada Buyer", email: "Ada@Example.com ", phone: " +2348012345678" },
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

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" });
});

describe("#2227 T-1 — the Paystack hand-off uses the SAFE browser primitive", () => {
  it("opens the authorization URL with openBrowserAsync and never an auth session", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce({ data: { order: { orderId: "ord-1" } }, error: null });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(1);
    expect(mockOpenBrowserAsync).toHaveBeenCalledWith(AUTH_URL);
    expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-1" });
  });

  it("passes NO redirect argument — that argument is what iOS destroyed the session over", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce({ data: { order: { orderId: "ord-2" } }, error: null });

    await useNativeCheckoutFlow()(inputFor(eventId));

    expect(mockOpenBrowserAsync.mock.calls[0]).toHaveLength(1);
  });

  it("the source contains no openAuthSessionAsync CALL and carries the protective comment", () => {
    expect(FLOW_SOURCE).not.toMatch(/openAuthSessionAsync\s*\(/);
    expect(FLOW_SOURCE).toMatch(
      /WebBrowser\.openBrowserAsync\(\s*authorizationUrl\s*\)/,
    );
    expect(FLOW_SOURCE).toMatch(/followPaystackHandoff\([\s\S]{0,240}data\.authorizationUrl/);
    expect(FLOW_SOURCE).toContain(
      "DO NOT change this back to openAuthSessionAsync with an https redirect",
    );
    expect(FLOW_SOURCE).toContain(
      "I-PROPOSED-NATIVE-BROWSER-NO-HTTPS-AUTHSESSION",
    );
  });
});

describe("#2227 T-7 / T-8 — a browser that never presented is never polled", () => {
  it("T-7: {type:'locked'} fails immediately with the no-handoff copy, zero status calls", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "locked" });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_NO_HANDOFF_MESSAGE,
    });
    const statusCalls = mockInvoke.mock.calls.filter(
      (call) => call[0] === "ticket-checkout-status",
    );
    expect(statusCalls).toHaveLength(0);
  });

  it("T-8: a thrown browser fails immediately with the same copy, zero status calls", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockRejectedValueOnce(new Error("no browser module"));

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_NO_HANDOFF_MESSAGE,
    });
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === "ticket-checkout-status"),
    ).toHaveLength(0);
  });
});

describe("#2227 T-9 — a normal dismissal still polls the server", () => {
  it("polls ticket-checkout-status and returns the finalized orderId", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce({ data: { order: { orderId: "ord-9" } }, error: null });
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "dismiss" });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-9" });
    const statusCall = mockInvoke.mock.calls.find(
      (c) => c[0] === "ticket-checkout-status",
    );
    expect(statusCall?.[1]).toEqual({
      body: { checkoutSessionId: `cs-${eventId}`, buyerStatusToken: `bst-${eventId}` },
    });
  });
});

describe("#2227 T-11 — a re-tap REPLAYS the held page instead of creating again", () => {
  it("a second tap on the SAME cart re-opens the held page and creates nothing", async () => {
    const eventId = nextEventId();
    const input = inputFor(eventId);

    // Tap 1 — create runs, the page is held, the browser refuses to present.
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "locked" });
    const first = await useNativeCheckoutFlow()(input);
    expect(first).toEqual({
      outcome: "failed",
      message: CHECKOUT_NO_HANDOFF_MESSAGE,
    });

    // Tap 2 — same cart. The buyer's CTA re-opens the page they were already
    // given. NO second create: the server would 409 it, and rightly.
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "dismiss" });
    mockInvoke.mockResolvedValueOnce({
      data: { order: { orderId: "ord-replay" } },
      error: null,
    });
    const second = await useNativeCheckoutFlow()(input);

    expect(second).toEqual({ outcome: "succeeded", orderId: "ord-replay" });
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create"),
    ).toHaveLength(1);
    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(2);
    expect(mockOpenBrowserAsync).toHaveBeenNthCalledWith(2, AUTH_URL);
  });

  it("a CHANGED cart is never replayed — the fingerprint moves and a create runs", async () => {
    const eventId = nextEventId();
    const input = inputFor(eventId);

    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "locked" });
    await useNativeCheckoutFlow()(input);

    // Three tickets instead of one is a DIFFERENT purchase. Replaying the old
    // page would send the buyer to pay the wrong amount.
    mockInvoke.mockResolvedValueOnce(
      httpError(409, { error: "checkout_in_progress" }),
    );
    await useNativeCheckoutFlow()({
      ...input,
      lines: [{ ticketTypeId: "tt-ga", quantity: 3 }],
    });

    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create"),
    ).toHaveLength(2);
  });

  it("a successful order releases the held page", async () => {
    const eventId = nextEventId();
    const input = inputFor(eventId);

    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce({
        data: { order: { orderId: "ord-done" } },
        error: null,
      });
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "dismiss" });
    await useNativeCheckoutFlow()(input);

    // Buying again for the same cart must go back to the server, not replay a
    // page that has already been paid.
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "locked" });
    await useNativeCheckoutFlow()(input);

    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create"),
    ).toHaveLength(2);
  });

  // #2227 QA F-1 — this test previously asserted the OPPOSITE: that the 409
  // handed the held page back as `resumeUrl`. It did so WITHOUT comparing the
  // fingerprint, so a cart that had changed since the hold was written would be
  // offered the page for the old cart — 1x GA's ₦100 page for a 3x VIP cart.
  // `resumeUrl` is deleted; the fingerprint-gated replay above is the only way
  // a held page is ever re-opened. This test now pins the deletion.
  it("T-11: a CHANGED cart is refused with a sentence and offered NO stale page", async () => {
    const eventId = nextEventId();
    const input = inputFor(eventId);

    // Tap 1 — create succeeds, browser opens, buyer walks away, poll finds
    // nothing yet. The page is HELD.
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "locked" });
    await useNativeCheckoutFlow()(input);
    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(1);

    // Tap 2 — a DIFFERENT cart for the same event, so the fingerprint moves and
    // the create actually runs; the server refuses it with 409.
    mockInvoke.mockResolvedValueOnce(
      httpError(409, { error: "checkout_in_progress" }),
    );
    const result = await useNativeCheckoutFlow()({
      ...input,
      lines: [{ ticketTypeId: "tt-ga", quantity: 3 }],
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") throw new Error("unreachable");
    expect(result.token).toBe("checkout_in_progress");
    expect(result.message).not.toContain("checkout_in_progress");
    // The field is GONE from the outcome, not merely empty.
    expect("resumeUrl" in result).toBe(false);
    expect(Object.keys(result)).toEqual(["outcome", "message", "token"]);
    // ...and the wrong-cart page was never opened either.
    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(1);
  });
});

describe("#2227 T-10 — an expired hold is deleted, never served", () => {
  it("a hold older than the 15-minute session window is deleted, not served", async () => {
    const eventId = nextEventId();
    const input = inputFor(eventId);
    const t0 = Date.parse("2026-08-18T12:00:00.000Z");
    const now = jest.spyOn(Date, "now").mockReturnValue(t0);

    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "locked" });
    await useNativeCheckoutFlow()(input);

    // 15 minutes + 1 second later the held page can no longer be paid.
    now.mockReturnValue(t0 + 15 * 60 * 1000 + 1000);
    mockInvoke.mockResolvedValueOnce(
      httpError(409, { error: "checkout_in_progress" }),
    );
    const result = await useNativeCheckoutFlow()({
      ...input,
      lines: [{ ticketTypeId: "tt-ga", quantity: 2 }],
    });

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") throw new Error("unreachable");
    // Nothing is ever handed back on the refusal path (#2227 QA F-1), so the
    // observable for "the expired entry is gone" is the NEXT tap on the SAME
    // cart: it re-creates rather than replaying a dead payment page.
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "locked" });
    await useNativeCheckoutFlow()(input);
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create"),
    ).toHaveLength(3);
    now.mockRestore();
  });
});

describe("#2227 T-12 — the held page is memory-only", () => {
  it("the flow never persists an authorization URL", () => {
    // Usage, not prose — the module's own comment names AsyncStorage in order
    // to forbid it, so match imports and calls rather than the bare word.
    expect(FLOW_SOURCE).not.toMatch(/from\s+["'][^"']*async-storage/);
    expect(FLOW_SOURCE).not.toMatch(/AsyncStorage\s*\./);
    expect(FLOW_SOURCE).not.toMatch(/SecureStore\s*\./);
    expect(FLOW_SOURCE).not.toMatch(/\bpersist\s*\(/);
    expect(FLOW_SOURCE).not.toMatch(/zustand/);
    expect(FLOW_SOURCE).toContain("const heldPaystackHandoffs = new Map<");
    expect(FLOW_SOURCE).toContain("MEMORY ONLY");
  });
});

describe("#2227 T-13 — the free and Stripe rails are unchanged", () => {
  it("a free checkout still finalizes on the server, no browser, no poll", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "ord-free" },
      error: null,
    });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-free" });
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("the create request body is byte-identical to the pre-change shape", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "ord-free-2" },
      error: null,
    });

    await useNativeCheckoutFlow()(inputFor(eventId));

    expect(mockInvoke.mock.calls[0][0]).toBe("ticket-checkout-create");
    expect(mockInvoke.mock.calls[0][1]).toEqual({
      body: {
        eventId,
        surface: "native",
        returnContract: "host_v1",
        buyer: {
          name: "Ada Buyer",
          email: "Ada@Example.com ",
          phone: " +2348012345678",
          marketingOptIn: false,
        },
        lines: [{ ticketTypeId: "tt-ga", quantity: 1 }],
      },
    });
  });

  it("a Stripe card checkout still presents the PaymentSheet", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce({
        data: {
          kind: "requires_payment",
          checkoutSessionId: "cs-stripe",
          buyerStatusToken: "bst-stripe",
          totalCents: 5000,
          subtotalCents: 5000,
          taxCents: 0,
          taxBreakdown: [],
          currency: "usd",
          clientSecret: "pi_secret",
          paymentIntentId: "pi_1",
          publishableKey: "pk_live_x",
          stripeAccountId: "acct_1",
          customerId: null,
          customerEphemeralKeySecret: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { status: "present_allowed" }, error: null });
    mockInitPaymentSheet.mockResolvedValueOnce({});
    mockPresentPaymentSheet.mockResolvedValueOnce({});

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "succeeded", orderId: "cs-stripe" });
    expect(mockPresentPaymentSheet).toHaveBeenCalledTimes(1);
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
  });
});
