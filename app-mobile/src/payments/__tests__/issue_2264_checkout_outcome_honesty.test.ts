/**
 * issue #2264 [abandoned payment told the wrong story] + #2265 [nothing tells
 * the buyer anything is happening] + #2253 [no in-flight guard in the shared
 * flow] — IMPLEMENTOR happy-path regression.
 *
 * SPEC #2264 §7: T-1, T-2, T-3, T-4, T-5, T-6, T-7, T-8, T-12, T-13, T-14,
 * T-15, T-16, and SC-15.
 *
 * These run the REAL `useNativeCheckoutFlow` with only the transport, the
 * browser and the Stripe SDK stubbed, so they assert what the flow actually
 * does with the server's reply — not that a symbol exists.
 *
 * FAILS ON REVERT — measured, not asserted (see the implementation report on
 * issue #2264 for the pasted runs; every revert below was a TRUE LINE DELETION,
 * never a comment-out):
 *   • delete the terminal branch + narrow the response type back to `{ order }`
 *     in both flows → T-1 and the four T-8 cases go red (5 failures), and
 *     `scripts/ci/check-checkout-status-consumers.sh` exits 1 on both files.
 *   • delete the single-flight guard → both T-12 cases and both SC-15 cases go
 *     red (4 failures).
 *   • delete ONLY the `finally` that clears the guard → T-13's throw case goes
 *     red (1 failure), which is what separates a guard that self-heals from one
 *     that deadens the buy control for the life of the process.
 *
 * T-4, T-5, T-6, T-7 deliberately stay GREEN under those reverts: they cover the
 * budget, the finalized-outranks-status rule and transport failures, none of
 * which the terminal branch touches. A test that goes red for every revert is
 * not localising anything.
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

import {
  clearAllHeldHandoffs,
  type NativeCheckoutPhase,
  useNativeCheckoutFlow,
} from "../nativeCheckoutFlow";
import {
  CHECKOUT_ABANDONED_MESSAGE,
  CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
  CHECKOUT_PAYMENT_FAILED_MESSAGE,
  CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
  CHECKOUT_UNAVAILABLE_MESSAGE,
  NATIVE_PAYSTACK_RETURN_MESSAGES,
  nativePaystackReturnMessage,
} from "../checkoutErrorMessages";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const CONSUMER_FLOW_SOURCE = readFileSync(
  join(REPO_ROOT, "app-mobile", "src", "payments", "nativeCheckoutFlow.ts"),
  "utf8",
);
const BUSINESS_FLOW_SOURCE = readFileSync(
  join(
    REPO_ROOT,
    "mingla-business",
    "src",
    "payments",
    "nativeCheckoutFlow.native.ts",
  ),
  "utf8",
);
const VERIFY_SOURCE = readFileSync(
  join(
    REPO_ROOT,
    "supabase",
    "functions",
    "_shared",
    "paystackTicketReturnVerify.ts",
  ),
  "utf8",
);

const AUTH_URL = "https://checkout.paystack.com/abc123xyz";

/** A distinct event per test keeps the module-level hold cache from bleeding. */
let eventSeq = 0;
const nextEventId = (): string => `event-2264-${++eventSeq}`;

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

/**
 * The server's #2198 terminal answer, EXACTLY as `ticket-checkout-status`
 * emits it: HTTP 200, so it arrives in `data`, not in `error`.
 */
const terminal = (code: string) => ({
  data: { checkoutSessionId: "cs", status: "failed", order: null, error: code },
  error: null,
});

const stillPending = (status = "awaiting_web_redirect") => ({
  data: { checkoutSessionId: "cs", status, order: null },
  error: null,
});

const finalized = (orderId: string, status = "paid") => ({
  data: { checkoutSessionId: "cs", status, order: { orderId } },
  error: null,
});

/**
 * The poll's own sleep, made instantaneous AND countable. T-1's whole claim is
 * that a terminal verdict costs the buyer ZERO sleeps; a test that could not
 * see the sleeps could not make that claim.
 */
let sleeps: number[] = [];

beforeEach(() => {
  // resetAllMocks, NOT clearAllMocks: `mockResolvedValueOnce` queues survive
  // `mockClear`, so an unconsumed queue entry silently becomes the NEXT test's
  // first server reply. That is a test-suite-shaped version of the very bug
  // this file is about — reading an answer that belongs to something else.
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

// ---------------------------------------------------------------------------
// T-1 — the whole of #2264 in one assertion.
// ---------------------------------------------------------------------------
describe("#2264 T-1 — an abandoned charge ends the poll on the FIRST tick", () => {
  it("says the buyer closed the page, in one poll, with no sleep at all", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(terminal("paystack_charge_abandoned"));

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_ABANDONED_MESSAGE,
      token: "paystack_charge_abandoned",
    });
    // ONE create + ONE status. Not seventeen.
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[1][0]).toBe("ticket-checkout-status");
    // The 25.5 seconds are gone: the loop never slept once.
    expect(sleeps).toEqual([]);
  });

  it("never shows the retired timeout copy for a buyer who did not pay", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(terminal("paystack_charge_abandoned"));

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") throw new Error("unreachable");
    expect(result.message).not.toContain("We couldn't confirm your payment yet");
  });
});

// ---------------------------------------------------------------------------
// T-2 / T-3 — the mapper.
// ---------------------------------------------------------------------------

/**
 * The terminal codes DERIVED from the server resolver, not transcribed. #2229's
 * CLOSE note (the 37-vs-39 token miscount) is why this reads the file.
 */
const DERIVED_TERMINAL_CODES: readonly string[] = ((): string[] => {
  const codes = new Set<string>();
  const re = /\bcode:\s*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(VERIFY_SOURCE)) !== null) {
    const chunk = VERIFY_SOURCE.slice(match.index, match.index + 240);
    const stop = chunk.search(/[;}]/);
    const window = stop === -1 ? chunk : chunk.slice(0, stop);
    for (const literal of window.matchAll(/"([a-z0-9_]+)"/g)) {
      codes.add(literal[1]);
    }
  }
  return [...codes].sort();
})();

describe("#2264 T-2 — the return mapper is TOTAL", () => {
  it("derives a non-empty terminal set from the server resolver itself", () => {
    expect(DERIVED_TERMINAL_CODES.length).toBeGreaterThan(0);
    // If the server ever DROPS one of these arms, this is where you find out.
    for (const code of [
      "paystack_charge_abandoned",
      "paystack_charge_failed",
      "paystack_payment_mismatch",
      "checkout_unavailable",
    ]) {
      expect(DERIVED_TERMINAL_CODES).toContain(code);
    }
  });

  it("maps every derived code — and null, empty and garbage — into its own codomain", () => {
    const owned = new Set(NATIVE_PAYSTACK_RETURN_MESSAGES);
    for (const code of [
      ...DERIVED_TERMINAL_CODES,
      "",
      "garbage",
      "a_code_invented_tomorrow",
    ]) {
      const out = nativePaystackReturnMessage(code);
      expect(owned.has(out)).toBe(true);
      expect(out).not.toBe(code);
      expect(out).not.toContain(code.length > 3 ? code : " ");
    }
    expect(owned.has(nativePaystackReturnMessage(null))).toBe(true);
  });

  it("routes the four codes the server actually emits", () => {
    expect(nativePaystackReturnMessage("paystack_charge_abandoned")).toBe(
      CHECKOUT_ABANDONED_MESSAGE,
    );
    expect(nativePaystackReturnMessage("paystack_charge_failed")).toBe(
      CHECKOUT_PAYMENT_FAILED_MESSAGE,
    );
    expect(nativePaystackReturnMessage("paystack_payment_mismatch")).toBe(
      CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
    );
    expect(nativePaystackReturnMessage("checkout_unavailable")).toBe(
      CHECKOUT_UNAVAILABLE_MESSAGE,
    );
  });

  it("degrades an UNRECOGNISED code to 'we don't know yet', never to a certainty", () => {
    expect(nativePaystackReturnMessage(null)).toBe(
      CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
    );
    expect(nativePaystackReturnMessage("paystack_something_new")).toBe(
      CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
    );
  });
});

describe("#2264 T-3 — every return-leg string states whether money moved", () => {
  it("says NOT CHARGED only where the server proves nothing was charged", () => {
    expect(CHECKOUT_ABANDONED_MESSAGE).toMatch(/not been charged/i);
    expect(CHECKOUT_PAYMENT_FAILED_MESSAGE).toMatch(/not been charged/i);
    expect(CHECKOUT_UNAVAILABLE_MESSAGE).toMatch(/not been charged/i);
  });

  it("NEVER claims 'not been charged' on an amount/currency mismatch — money moved", () => {
    expect(CHECKOUT_PAYMENT_MISMATCH_MESSAGE).not.toMatch(/not been charged/i);
    expect(CHECKOUT_PAYMENT_MISMATCH_MESSAGE).toContain("If money left your account");
    expect(CHECKOUT_PAYMENT_MISMATCH_MESSAGE).toContain("support@usemingla.com");
  });

  it("is honest rather than reassuring while the answer is genuinely unknown", () => {
    expect(CHECKOUT_AWAITING_CONFIRMATION_MESSAGE).not.toMatch(/not been charged/i);
    expect(CHECKOUT_AWAITING_CONFIRMATION_MESSAGE).toMatch(/don't pay again/i);
    expect(CHECKOUT_AWAITING_CONFIRMATION_MESSAGE).toContain("support@usemingla.com");
  });

  it("reads as a sentence, never as a machine token", () => {
    for (const message of NATIVE_PAYSTACK_RETURN_MESSAGES) {
      expect(message).not.toMatch(/^[a-z0-9_]+$/);
      expect(message.length).toBeGreaterThan(30);
      expect(message).toMatch(/[.!]$/);
    }
  });
});

// ---------------------------------------------------------------------------
// T-4 / T-5 / T-6 / T-7 — the loop's remaining rules.
// ---------------------------------------------------------------------------
describe("#2264 T-4 — a spent budget is the ONLY 'awaiting confirmation' case", () => {
  it("polls its full budget on a non-terminal status, then says we don't know yet", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId));
    for (let i = 0; i < 17; i++) mockInvoke.mockResolvedValueOnce(stillPending());

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({
      outcome: "failed",
      message: CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
      token: null,
    });
    // 1 create + 17 status polls, and 17 sleeps of 1500ms — the budget is
    // UNCHANGED, only what it is spent on has changed.
    expect(mockInvoke).toHaveBeenCalledTimes(18);
    expect(sleeps).toEqual(new Array(17).fill(1500));
  });
});

describe("#2264 T-5 — a finalized order OUTRANKS any status string", () => {
  it("succeeds even when the body also carries status:failed", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce(paystackCreate(eventId)).mockResolvedValueOnce({
      data: { status: "failed", order: { orderId: "o1" }, error: "whatever" },
      error: null,
    });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "succeeded", orderId: "o1" });
  });
});

describe("#2264 T-6 — non-terminal statuses keep polling", () => {
  it("does not treat pending / awaiting_web_redirect as an answer", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(stillPending("pending"))
      .mockResolvedValueOnce(stillPending("awaiting_web_redirect"))
      .mockResolvedValueOnce(finalized("ord-late"));

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-late" });
    expect(mockInvoke).toHaveBeenCalledTimes(4);
  });
});

describe("#2264 T-7 — a transport failure is NOT a terminal answer", () => {
  it("keeps polling through a rejection and through an invoke-level error", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ data: null, error: { message: "502" } })
      .mockResolvedValueOnce(finalized("ord-recovered"));

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-recovered" });
  });
});

// ---------------------------------------------------------------------------
// T-8 — neither flow may go back to discarding the answer.
// ---------------------------------------------------------------------------
describe("#2264 T-8 — neither native flow discards the server's answer", () => {
  const stripComments = (src: string): string =>
    src
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
      .join("\n");

  for (const [label, source] of [
    ["consumer nativeCheckoutFlow.ts", CONSUMER_FLOW_SOURCE],
    ["business nativeCheckoutFlow.native.ts", BUSINESS_FLOW_SOURCE],
  ] as const) {
    it(`${label} declares status AND error on the checkout-status response`, () => {
      const code = stripComments(source);
      // The generic that hid the answer named ONLY `order`.
      expect(code).toMatch(/status\?:\s*string;[\s\S]{0,200}?error\?:\s*string;/);
      expect(code).toMatch(/data\?\.status === "failed"/);
      expect(code).toMatch(/data\.error \?\? null/);
    });

    it(`${label} no longer carries the retired timeout string`, () => {
      expect(source).not.toContain("We couldn't confirm your payment yet");
    });

    it(`${label} keeps the protective comment that explains why`, () => {
      expect(source).toContain(
        "I-PROPOSED-CHECKOUT-STATUS-ANSWER-NOT-DISCARDED",
      );
      expect(source).toContain(
        "I-PROPOSED-PAYSTACK-ABANDONED-ONLY-AFTER-BROWSER-CLOSES",
      );
    });
  }
});

// ---------------------------------------------------------------------------
// T-12 / T-13 / SC-15 — #2253's contract, with NO screen involved.
// ---------------------------------------------------------------------------
describe("#2253 T-12 — the flow refuses a second concurrent checkout ITSELF", () => {
  it("two concurrent calls produce exactly ONE ticket-checkout-create", async () => {
    const eventId = nextEventId();
    let releaseCreate: (value: unknown) => void = () => {};
    const heldCreate = new Promise((resolve) => {
      releaseCreate = resolve;
    });
    mockInvoke
      .mockImplementationOnce(async () => await heldCreate)
      .mockResolvedValueOnce(finalized("ord-single"));

    // NO screen, NO component, NO checkoutInFlight — the hook's own function.
    const run = useNativeCheckoutFlow();
    const first = run(inputFor(eventId));
    const second = await run(inputFor(eventId));

    expect(second).toEqual({ outcome: "canceled" });

    releaseCreate({
      data: { kind: "free_completed", orderId: "ord-single" },
      error: null,
    });
    await expect(first).resolves.toEqual({
      outcome: "succeeded",
      orderId: "ord-single",
    });

    const creates = mockInvoke.mock.calls.filter(
      (call) => call[0] === "ticket-checkout-create",
    );
    expect(creates).toHaveLength(1);
  });

  it("refuses a second checkout for a DIFFERENT cart too — one at a time, full stop", async () => {
    let releaseCreate: (value: unknown) => void = () => {};
    const heldCreate = new Promise((resolve) => {
      releaseCreate = resolve;
    });
    mockInvoke.mockImplementationOnce(async () => await heldCreate);

    const run = useNativeCheckoutFlow();
    const first = run(inputFor(nextEventId()));
    const otherCart = await run(inputFor(nextEventId()));

    expect(otherCart).toEqual({ outcome: "canceled" });

    releaseCreate({
      data: { kind: "free_completed", orderId: "ord-a" },
      error: null,
    });
    await first;
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create"),
    ).toHaveLength(1);
  });
});

describe("#2253 T-13 — the guard clears on EVERY path, including a throw", () => {
  it("a third call proceeds normally after the first one throws", async () => {
    const run = useNativeCheckoutFlow();
    mockInvoke.mockRejectedValueOnce(new Error("boom"));

    await expect(run(inputFor(nextEventId()))).rejects.toThrow("boom");

    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "ord-after-throw" },
      error: null,
    });
    await expect(run(inputFor(nextEventId()))).resolves.toEqual({
      outcome: "succeeded",
      orderId: "ord-after-throw",
    });
  });

  it("clears after a normal settle, so back-to-back checkouts still work", async () => {
    const run = useNativeCheckoutFlow();
    mockInvoke
      .mockResolvedValueOnce({
        data: { kind: "free_completed", orderId: "ord-1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { kind: "free_completed", orderId: "ord-2" },
        error: null,
      });

    await expect(run(inputFor(nextEventId()))).resolves.toEqual({
      outcome: "succeeded",
      orderId: "ord-1",
    });
    await expect(run(inputFor(nextEventId()))).resolves.toEqual({
      outcome: "succeeded",
      orderId: "ord-2",
    });
  });
});

describe("#2264 SC-15 — sign-out clears the in-flight guard, not just the holds", () => {
  it("clearAllHeldHandoffs releases a stranded guard", async () => {
    const run = useNativeCheckoutFlow();
    let releaseCreate: (value: unknown) => void = () => {};
    mockInvoke.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          releaseCreate = resolve;
        }),
    );
    const inFlight = run(inputFor(nextEventId()));
    expect(await run(inputFor(nextEventId()))).toEqual({ outcome: "canceled" });

    // Sign-out lands mid-checkout.
    clearAllHeldHandoffs();

    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "ord-post-signout" },
      error: null,
    });
    await expect(run(inputFor(nextEventId()))).resolves.toEqual({
      outcome: "succeeded",
      orderId: "ord-post-signout",
    });

    releaseCreate({
      data: { kind: "free_completed", orderId: "ord-orig" },
      error: null,
    });
    await inFlight;
  });

  it("the sign-out funnel is wired to the flow's cleanup", () => {
    expect(CONSUMER_FLOW_SOURCE).toMatch(
      /clearAllHeldHandoffs[\s\S]{0,400}activeCheckoutFingerprint = null/,
    );
  });
});

// ---------------------------------------------------------------------------
// T-14 — #2265's half: the flow narrates itself.
// ---------------------------------------------------------------------------
describe("#2265 T-14 — the flow reports its phases, in order", () => {
  it("Paystack: creating -> opening_payment_page -> confirming_payment", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(terminal("paystack_charge_abandoned"));

    const phases: NativeCheckoutPhase[] = [];
    await useNativeCheckoutFlow()({
      ...inputFor(eventId),
      onPhase: (phase) => phases.push(phase),
    });

    expect(phases).toEqual([
      "creating",
      "opening_payment_page",
      "confirming_payment",
    ]);
  });

  it("free: creating, and nothing else — there is no page and no poll", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "ord-free" },
      error: null,
    });

    const phases: NativeCheckoutPhase[] = [];
    const result = await useNativeCheckoutFlow()({
      ...inputFor(nextEventId()),
      onPhase: (phase) => phases.push(phase),
    });

    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-free" });
    expect(phases).toEqual(["creating"]);
  });

  it("Stripe: creating -> presenting_sheet", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce({
        data: {
          kind: "requires_payment",
          checkoutSessionId: `cs-${eventId}`,
          buyerStatusToken: `bst-${eventId}`,
          totalCents: 5000,
          subtotalCents: 5000,
          taxCents: 0,
          taxBreakdown: [],
          currency: "usd",
          clientSecret: "pi_secret",
          paymentIntentId: "pi_1",
          publishableKey: "pk_test_x",
          stripeAccountId: "acct_1",
          customerId: null,
          customerEphemeralKeySecret: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { status: "present_allowed" }, error: null });
    mockInitPaymentSheet.mockResolvedValue({});
    mockPresentPaymentSheet.mockResolvedValue({});

    const phases: NativeCheckoutPhase[] = [];
    const result = await useNativeCheckoutFlow()({
      ...inputFor(eventId),
      onPhase: (phase) => phases.push(phase),
    });

    expect(result).toEqual({
      outcome: "succeeded",
      orderId: `cs-${eventId}`,
    });
    expect(phases).toEqual(["creating", "presenting_sheet"]);
  });

  it("a listener that THROWS cannot break the money path", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "ord-robust" },
      error: null,
    });
    await expect(
      useNativeCheckoutFlow()({
        ...inputFor(nextEventId()),
        onPhase: () => {
          throw new Error("a caller bug");
        },
      }),
    ).resolves.toEqual({ outcome: "succeeded", orderId: "ord-robust" });
  });
});

// ---------------------------------------------------------------------------
// T-15 — the recovery CHECKOUT_ABANDONED_MESSAGE promises must be real.
// ---------------------------------------------------------------------------
describe("#2264 T-15 — the held hand-off SURVIVES a terminal abandonment", () => {
  it("a re-tap re-opens the SAME Paystack page and creates nothing new", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce(terminal("paystack_charge_abandoned"));

    const run = useNativeCheckoutFlow();
    const first = await run(inputFor(eventId));
    expect(first.outcome).toBe("failed");

    // Second tap on the SAME cart: replay, no create, same URL.
    mockInvoke.mockResolvedValueOnce(finalized("ord-second-try"));
    const second = await run(inputFor(eventId));

    expect(second).toEqual({ outcome: "succeeded", orderId: "ord-second-try" });
    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(2);
    expect(mockOpenBrowserAsync).toHaveBeenNthCalledWith(2, AUTH_URL);
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === "ticket-checkout-create"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T-16 — nothing else moved.
// ---------------------------------------------------------------------------
describe("#2264 T-16 — free and Stripe request bodies are unchanged", () => {
  it("the free create body carries no new keys and no onPhase", async () => {
    const eventId = nextEventId();
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "ord-free" },
      error: null,
    });

    await useNativeCheckoutFlow()({
      ...inputFor(eventId),
      onPhase: () => {},
    });

    expect(mockInvoke).toHaveBeenCalledWith("ticket-checkout-create", {
      body: {
        eventId,
        surface: "native",
        returnContract: "host_v1",
        buyer: {
          name: "Ada Buyer",
          email: "ada@example.com",
          phone: "+2348012345678",
          marketingOptIn: false,
        },
        lines: [{ ticketTypeId: "tt-ga", quantity: 1 }],
      },
    });
  });

  it("a Stripe cancel is still a silent cancel", async () => {
    const eventId = nextEventId();
    mockInvoke
      .mockResolvedValueOnce({
        data: {
          kind: "requires_payment",
          checkoutSessionId: `cs-${eventId}`,
          buyerStatusToken: `bst-${eventId}`,
          totalCents: 5000,
          subtotalCents: 5000,
          taxCents: 0,
          taxBreakdown: [],
          currency: "usd",
          clientSecret: "pi_secret",
          paymentIntentId: "pi_1",
          publishableKey: "pk_test_x",
          stripeAccountId: "acct_1",
          customerId: null,
          customerEphemeralKeySecret: null,
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { status: "present_allowed" }, error: null });
    mockInitPaymentSheet.mockResolvedValue({});
    mockPresentPaymentSheet.mockResolvedValue({ error: { code: "Canceled" } });

    await expect(
      useNativeCheckoutFlow()(inputFor(eventId)),
    ).resolves.toEqual({ outcome: "canceled" });
  });
});
