/**
 * issue #3281 (bundle 6b) — the Host app reopens the Paystack page a buyer was
 * already sent to, for the identical purchase only, and drops it when the sale
 * is refused, the order finalizes, the money mismatched, it expires, or the
 * user signs out. Mirror of Explorer's #2227 held hand-off.
 *
 * Runtime test: the REAL hook runs against mocked transport and browser.
 * Held pages live in module memory, so every test starts by clearing them
 * (never `jest.resetModules`, which would register a second sign-out cleanup
 * against a different map and let the sign-out test pass while proving
 * nothing).
 */

const invoke = jest.fn();
const openBrowserAsync = jest.fn(
  async (_url: string): Promise<{ type: string }> => ({ type: "cancel" }),
);

jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock(
  "@mingla/payments-native",
  () => ({
    isStripeGooglePayTestEnv: () => true,
    useStripePaymentSheet: () => ({
      initPaymentSheet: jest.fn(async () => ({})),
      presentPaymentSheet: jest.fn(async () => ({})),
      isPaymentSheetSupported: true,
    }),
  }),
  { virtual: true },
);
jest.mock(
  "@stripe/stripe-react-native",
  () => ({ initStripe: jest.fn(async () => undefined) }),
  { virtual: true },
);
jest.mock(
  "expo-web-browser",
  () => ({
    openBrowserAsync: (url: string) => openBrowserAsync(url),
    WebBrowserResultType: {
      CANCEL: "cancel",
      DISMISS: "dismiss",
      OPENED: "opened",
      LOCKED: "locked",
    },
  }),
  { virtual: true },
);

/* eslint-disable @typescript-eslint/no-require-imports */
const { useNativeCheckoutFlow } =
  require("../nativeCheckoutFlow.native") as typeof import("../nativeCheckoutFlow.native");
const { clearAllHeldHandoffs, PAYSTACK_HANDOFF_TTL_MS } =
  require("../paystackHeldHandoff") as typeof import("../paystackHeldHandoff");
const { clearAllStores } =
  require("../../utils/clearAllStores") as typeof import("../../utils/clearAllStores");
/* eslint-enable @typescript-eslint/no-require-imports */
type NativeCheckoutInput =
  import("../nativeCheckoutFlow.native").NativeCheckoutInput;

const EVENT = "32810000-0000-4000-8000-000000000001";
const OTHER_EVENT = "32810000-0000-4000-8000-000000000002";
const GENERAL = "32810000-0000-4000-8000-0000000000b2";
const DINNER = "32810000-0000-4000-8000-0000000000d1";
const SATURDAY = "32810000-0000-4000-8000-0000000000e1";
const ATTEMPT = "32810000-0000-4000-8000-0000000000f1";
const ATTEMPT_2 = "32810000-0000-4000-8000-0000000000f2";

const ABANDONED =
  "You closed the payment page before paying, so no tickets were issued. You have not been charged — reopen the payment page to finish, or start again.";
const NO_HANDOFF =
  "We couldn't open the secure payment page. You have not been charged — please try again.";
const NOT_ISSUED =
  "We couldn't issue your tickets for this sale. If your payment went through, we're sorting it out and will email you — please don't pay again. Contact support@usemingla.com and we'll pick it up from there.";
const AWAITING =
  "Paystack hasn't confirmed this payment yet. If you completed it, your tickets will arrive here and by email within a few minutes — don't pay again. If nothing arrives, contact support@usemingla.com.";
const MISMATCH =
  "Your payment came back with a different amount or currency than this order, so no tickets were issued. If money left your account, contact support@usemingla.com before paying again.";

const v2Input = (
  over: Partial<NativeCheckoutInput> = {},
): NativeCheckoutInput => ({
  eventId: EVENT,
  lines: [
    {
      ticketTypeId: GENERAL,
      quantity: 2,
      paymentPlanChoice: "full",
      addOns: [{ addOnId: DINNER, quantity: 2 }],
    },
  ],
  buyer: {
    name: "Ada Guest",
    email: "ada@example.test",
    phone: "+2348000000001",
  },
  checkoutContractVersion: 2,
  checkoutAttemptId: ATTEMPT,
  purchaseTermsAccepted: true,
  quoteDigest: "qd",
  quoteListDigest: "qld",
  eventDateIds: [SATURDAY],
  ...over,
});

// A trip / experience (v1) body: no attempt id, no contract version.
const v1Input = (
  over: Partial<NativeCheckoutInput> = {},
): NativeCheckoutInput => ({
  eventId: EVENT,
  lines: [{ ticketTypeId: GENERAL, quantity: 1 }],
  buyer: {
    name: "Ada Guest",
    email: "ada@example.test",
    phone: "+2348000000001",
  },
  quoteDigest: "qd",
  quoteListDigest: "qld",
  ...over,
});

let sessionSeq = 0;
/** What `ticket-checkout-create` answers next. Default: a fresh Paystack page. */
let createAnswer: () => { data: unknown; error: unknown };
/** What `ticket-checkout-status` answers, one per poll; the last repeats. */
let statusAnswers: ({ data: unknown; error: unknown } | "throw")[];
/** What the #1930 preflight answers before a held page is reopened. */
let preflightAnswer: () => { data: unknown; error: unknown };

const paystackPage = () => {
  sessionSeq += 1;
  return {
    data: {
      kind: "requires_paystack_redirect",
      authorizationUrl: `https://checkout.paystack.test/page-${sessionSeq}`,
      checkoutSessionId: `sess-${sessionSeq}`,
      buyerStatusToken: `tok-${sessionSeq}`,
    },
    error: null,
  };
};

const abandoned = {
  data: { status: "failed", order: null, error: "paystack_charge_abandoned" },
  error: null,
};
const finalized = {
  data: { status: "succeeded", order: { orderId: "ord-1" } },
  error: null,
};
const noAnswer = { data: { status: "pending", order: null }, error: null };
const http = (status: number, body: unknown = {}) => ({
  data: null,
  error: { context: { status, json: async () => body } },
});

const isPreflight = (call: unknown[]) =>
  (call[1] as { body?: { preflight?: boolean } } | undefined)?.body
    ?.preflight === true;
/** Calls to a function; status reads exclude the #1930 preflight. */
const calls = (name: string) =>
  invoke.mock.calls.filter((call) => call[0] === name && !isPreflight(call));
const preflights = () =>
  invoke.mock.calls.filter(
    (call) => call[0] === "ticket-checkout-status" && isPreflight(call),
  );
const statusBodies = () =>
  calls("ticket-checkout-status").map(
    (call) =>
      (call[1] as { body: { checkoutSessionId: string } }).body
        .checkoutSessionId,
  );

let checkout: ReturnType<typeof useNativeCheckoutFlow>;
beforeAll(() => {
  // The hook only reads the (mocked) Stripe sheet, so one instance serves all.
  checkout = useNativeCheckoutFlow();
});
const pay = (input: NativeCheckoutInput) => checkout(input);

/** Run a pay to completion while advancing the poll's 1.5 s waits. */
const payWithTimers = async (input: NativeCheckoutInput) => {
  const pending = pay(input);
  for (let i = 0; i < 40; i += 1) await jest.advanceTimersByTimeAsync(1500);
  return pending;
};

beforeEach(() => {
  clearAllHeldHandoffs();
  sessionSeq = 0;
  invoke.mockReset();
  openBrowserAsync.mockReset();
  openBrowserAsync.mockResolvedValue({ type: "cancel" });
  createAnswer = paystackPage;
  statusAnswers = [abandoned];
  preflightAnswer = () => ({
    data: { status: "present_allowed" },
    error: null,
  });
  let statusIndex = 0;
  invoke.mockImplementation(async (name: string, options?: unknown) => {
    if (name === "ticket-checkout-create") return createAnswer();
    if (
      name === "ticket-checkout-status" &&
      (options as { body?: { preflight?: boolean } } | undefined)?.body
        ?.preflight === true
    ) {
      return preflightAnswer();
    }
    if (name === "ticket-checkout-status") {
      const answer =
        statusAnswers[Math.min(statusIndex, statusAnswers.length - 1)];
      statusIndex += 1;
      if (answer === "throw") throw new Error("network down");
      return answer;
    }
    throw new Error(`unexpected function ${name}`);
  });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("#3281 6b — reopening the held Paystack page", () => {
  it("after an abandoned page, Pay again reopens the SAME page and never creates twice", async () => {
    expect(await pay(v2Input())).toEqual({
      outcome: "failed",
      message: ABANDONED,
    });
    expect(await pay(v2Input())).toEqual({
      outcome: "failed",
      message: ABANDONED,
    });

    expect(calls("ticket-checkout-create")).toHaveLength(1);
    expect(openBrowserAsync.mock.calls.map((c) => c[0])).toEqual([
      "https://checkout.paystack.test/page-1",
      "https://checkout.paystack.test/page-1",
    ]);
    // The poll, the re-check before reopening, then the poll again.
    expect(statusBodies()).toEqual(["sess-1", "sess-1", "sess-1"]);
    expect(preflights()).toHaveLength(1);
  });

  it("a reopened page that is then paid succeeds, and the next Pay starts fresh", async () => {
    await pay(v2Input());
    statusAnswers = [finalized];
    // Re-arm the status sequence for the new answers.
    invoke.mockImplementation(async (name: string) =>
      name === "ticket-checkout-create" ? createAnswer() : finalized,
    );
    expect(await pay(v2Input())).toEqual({
      outcome: "succeeded",
      orderId: "ord-1",
    });
    expect(calls("ticket-checkout-create")).toHaveLength(1);

    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it.each([
    [
      "the quantity",
      {
        lines: [
          {
            ticketTypeId: GENERAL,
            quantity: 3,
            paymentPlanChoice: "full" as const,
          },
        ],
      },
    ],
    [
      "the buyer's email",
      {
        buyer: {
          name: "Ada Guest",
          email: "other@example.test",
          phone: "+2348000000001",
        },
      },
    ],
    [
      "the extras",
      {
        lines: [
          {
            ticketTypeId: GENERAL,
            quantity: 2,
            paymentPlanChoice: "full" as const,
          },
        ],
      },
    ],
    ["the day", { eventDateIds: ["32810000-0000-4000-8000-0000000000e2"] }],
    ["the attempt id", { checkoutAttemptId: ATTEMPT_2 }],
    ["the quote", { quoteDigest: "qd-new" }],
    ["the quote list", { quoteListDigest: "qld-new" }],
    ["the discount code", { discountCode: "SAVE10" }],
    ["the private link", { ticketLinkToken: "link-tok" }],
    [
      "the buyer's phone",
      {
        buyer: {
          name: "Ada Guest",
          email: "ada@example.test",
          phone: "+2348000000009",
        },
      },
    ],
    ["the party size", { partySize: 4 }],
    ["the booked start", { bookedStartAt: "2026-12-01T18:00:00Z" }],
    ["the booked end", { bookedEndAt: "2026-12-01T22:00:00Z" }],
    ["the occurrence", { eventDateId: "32810000-0000-4000-8000-0000000000e3" }],
  ])(
    "a different purchase (%s) never reopens the held page",
    async (_label, change) => {
      await pay(v2Input());
      await pay(v2Input(change));
      expect(calls("ticket-checkout-create")).toHaveLength(2);
      expect(openBrowserAsync.mock.calls[1][0]).toBe(
        "https://checkout.paystack.test/page-2",
      );
    },
  );

  it("cart A, then cart B, then back to A reopens A's page (each cart keeps its own)", async () => {
    await pay(v2Input());
    await pay(v2Input({ checkoutAttemptId: ATTEMPT_2 }));
    await pay(v2Input());
    await pay(v2Input({ checkoutAttemptId: ATTEMPT_2 }));
    expect(calls("ticket-checkout-create")).toHaveLength(2);
    expect(openBrowserAsync.mock.calls.map((c) => c[0])).toEqual([
      "https://checkout.paystack.test/page-1",
      "https://checkout.paystack.test/page-2",
      "https://checkout.paystack.test/page-1",
      "https://checkout.paystack.test/page-2",
    ]);
  });

  it("v1 (trip) cart A, then B, then back to A reopens A's page", async () => {
    await pay(v1Input());
    await pay(v1Input({ lines: [{ ticketTypeId: GENERAL, quantity: 2 }] }));
    await pay(v1Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
    expect(openBrowserAsync.mock.calls[2][0]).toBe(
      "https://checkout.paystack.test/page-1",
    );
  });

  it("another event is never served this event's page", async () => {
    await pay(v2Input());
    await pay(v2Input({ eventId: OTHER_EVENT }));
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a name-only edit reopens the page: the server treats it as the same purchase", async () => {
    await pay(v1Input());
    await pay(
      v1Input({
        buyer: {
          name: "Ada G.",
          email: "ada@example.test",
          phone: "+2348000000001",
        },
      }),
    );
    expect(calls("ticket-checkout-create")).toHaveLength(1);
  });

  it("trip and experience (v1) checkouts reopen their held page too", async () => {
    await pay(v1Input());
    await pay(v1Input());
    expect(calls("ticket-checkout-create")).toHaveLength(1);
    // The poll, the re-check before reopening, then the poll again.
    expect(statusBodies()).toEqual(["sess-1", "sess-1", "sess-1"]);
    expect(preflights()).toHaveLength(1);
  });
});

describe("#3281 6b — when the held page is dropped", () => {
  it.each([
    [
      "a 409 from checkout-status",
      http(409, { error: "checkout_unavailable" }),
    ],
    ["a 409 with no body", http(409)],
    ["a 409 with another code", http(409, { error: "session_revoked" })],
    [
      "checkout_unavailable at HTTP 200",
      {
        data: { status: "failed", order: null, error: "checkout_unavailable" },
        error: null,
      },
    ],
  ])(
    "%s refuses at once, drops the page, and the next Pay creates again",
    async (_label, answer) => {
      statusAnswers = [answer];
      expect(await pay(v2Input())).toEqual({
        outcome: "failed",
        message: NOT_ISSUED,
      });
      expect(calls("ticket-checkout-status")).toHaveLength(1);

      await pay(v2Input());
      expect(calls("ticket-checkout-create")).toHaveLength(2);
    },
  );

  it("a payment mismatch drops the page, so the buyer is never sent back to pay again", async () => {
    statusAnswers = [
      {
        data: {
          status: "failed",
          order: null,
          error: "paystack_payment_mismatch",
        },
        error: null,
      },
    ];
    expect(await pay(v2Input())).toEqual({
      outcome: "failed",
      message: MISMATCH,
    });
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a failed charge keeps the page: the session is still live and payable", async () => {
    statusAnswers = [
      {
        data: {
          status: "failed",
          order: null,
          error: "paystack_charge_failed",
        },
        error: null,
      },
    ];
    await pay(v2Input());
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(1);
  });

  it("sign-out drops every held page (through clearAllStores)", async () => {
    await pay(v2Input());
    clearAllStores();
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a page expires before the server session does", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z") });
    await pay(v2Input());

    jest.setSystemTime(
      new Date("2026-11-12T10:00:00Z").getTime() + PAYSTACK_HANDOFF_TTL_MS - 1,
    );
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(1);

    jest.setSystemTime(
      new Date("2026-11-12T10:00:00Z").getTime() + PAYSTACK_HANDOFF_TTL_MS,
    );
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
    expect(PAYSTACK_HANDOFF_TTL_MS).toBeLessThan(15 * 60 * 1000);
  });

  it("the hold is timed from before the create call, not from when it answered", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-12T10:00:00Z") });
    const start = Date.now();
    createAnswer = () => {
      // The create takes 30 seconds to answer.
      jest.setSystemTime(start + 30_000);
      return paystackPage();
    };
    await pay(v2Input());
    jest.setSystemTime(start + PAYSTACK_HANDOFF_TTL_MS);
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });
});

const RECHECK_FAILED =
  "We couldn't check your payment page just now, so we didn't reopen it. Check your connection and try again.";
const UNAVAILABLE =
  "This sale is no longer available — the organiser may have paused or changed this event. You have not been charged.";

describe("#3281 6b — a held page is re-checked before it is reopened", () => {
  it("a session revoked between visits is refused and never reopened", async () => {
    statusAnswers = [abandoned, http(409, { error: "checkout_unavailable" })];
    await pay(v2Input());
    expect(await pay(v2Input())).toEqual({
      outcome: "failed",
      message: NOT_ISSUED,
    });
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(preflights()).toHaveLength(0);

    statusAnswers = [abandoned];
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it.each([
    ["paused or cancelled (409)", 409],
    ["no longer this buyer's (403)", 403],
    ["gone (404)", 404],
  ])(
    "a sale the preflight refuses — %s — is never reopened, and the page is dropped",
    async (_label, status) => {
      await pay(v2Input());
      preflightAnswer = () => http(status, { error: "checkout_unavailable" });
      expect(await pay(v2Input())).toEqual({
        outcome: "failed",
        message: UNAVAILABLE,
      });
      expect(openBrowserAsync).toHaveBeenCalledTimes(1);

      preflightAnswer = () => ({
        data: { status: "present_allowed" },
        error: null,
      });
      await pay(v2Input());
      expect(calls("ticket-checkout-create")).toHaveLength(2);
    },
  );

  it.each([
    [
      "the preflight throws",
      () => {
        throw new Error("offline");
      },
    ],
    ["the preflight answers 500", () => http(500)],
    [
      "the preflight answers nothing useful",
      () => ({ data: null, error: null }),
    ],
  ])("%s: the page is kept but not opened", async (_label, answer) => {
    await pay(v2Input());
    preflightAnswer = answer as () => { data: unknown; error: unknown };
    expect(await pay(v2Input())).toEqual({
      outcome: "failed",
      message: RECHECK_FAILED,
    });
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);

    preflightAnswer = () => ({
      data: { status: "present_allowed" },
      error: null,
    });
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(1);
    expect(openBrowserAsync.mock.calls[1][0]).toBe(
      "https://checkout.paystack.test/page-1",
    );
  });

  it.each([
    ["the status read throws", "throw" as const],
    ["the status read answers 500", http(500)],
    ["the status read answers nothing", { data: null, error: null }],
  ])(
    "%s: the page is kept but not opened, even when the preflight would pass",
    async (_label, answer) => {
      statusAnswers = [abandoned, answer, abandoned];
      await pay(v2Input());
      expect(await pay(v2Input())).toEqual({
        outcome: "failed",
        message: RECHECK_FAILED,
      });
      expect(openBrowserAsync).toHaveBeenCalledTimes(1);
      expect(preflights()).toHaveLength(0);

      await pay(v2Input());
      expect(calls("ticket-checkout-create")).toHaveLength(1);
      expect(openBrowserAsync.mock.calls[1][0]).toBe(
        "https://checkout.paystack.test/page-1",
      );
    },
  );

  it("a payment the server says is still pending is reopened after the preflight", async () => {
    statusAnswers = [abandoned, noAnswer, abandoned];
    await pay(v2Input());
    await pay(v2Input());
    expect(preflights()).toHaveLength(1);
    expect(openBrowserAsync).toHaveBeenCalledTimes(2);
  });

  it("an order that already finalized is returned, not reopened", async () => {
    statusAnswers = [abandoned, finalized];
    await pay(v2Input());
    expect(await pay(v2Input())).toEqual({
      outcome: "succeeded",
      orderId: "ord-1",
    });
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(preflights()).toHaveLength(0);
  });

  it("a mismatch found on the re-check drops the page without opening it", async () => {
    statusAnswers = [
      abandoned,
      {
        data: {
          status: "failed",
          order: null,
          error: "paystack_payment_mismatch",
        },
        error: null,
      },
    ];
    await pay(v2Input());
    expect(await pay(v2Input())).toEqual({
      outcome: "failed",
      message: MISMATCH,
    });
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
  });
});

describe("#3281 6b — signing out mid-checkout", () => {
  it("a create that answers after sign-out never holds or opens the old account's page", async () => {
    createAnswer = () => {
      clearAllStores();
      return paystackPage();
    };
    expect(await pay(v2Input())).toEqual({ outcome: "canceled" });
    expect(openBrowserAsync).not.toHaveBeenCalled();

    createAnswer = paystackPage;
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a finalized order found after sign-out is never confirmed for whoever is signed in now", async () => {
    await pay(v2Input());
    let reads = 0;
    invoke.mockImplementation(async (name: string) => {
      if (name !== "ticket-checkout-status") return createAnswer();
      reads += 1;
      clearAllStores();
      return finalized;
    });
    expect(await pay(v2Input())).toEqual({ outcome: "canceled" });
    expect(reads).toBe(1);
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
  });

  it("a sign-out during the re-check never reopens the old account's page", async () => {
    await pay(v2Input());
    preflightAnswer = () => {
      clearAllStores();
      return { data: { status: "present_allowed" }, error: null };
    };
    expect(await pay(v2Input())).toEqual({ outcome: "canceled" });
    expect(openBrowserAsync).toHaveBeenCalledTimes(1);
  });
});

describe("#3281 6b — the payment page never opened", () => {
  it.each([
    [
      "the browser throws",
      () => openBrowserAsync.mockRejectedValueOnce(new Error("no module")),
    ],
    [
      "iOS reports another browser is open (LOCKED)",
      () => openBrowserAsync.mockResolvedValueOnce({ type: "locked" }),
    ],
  ])(
    "%s: says so at once, never polls, and keeps the page for the next tap",
    async (_label, arrange) => {
      arrange();
      expect(await pay(v2Input())).toEqual({
        outcome: "failed",
        message: NO_HANDOFF,
      });
      expect(calls("ticket-checkout-status")).toHaveLength(0);

      await pay(v2Input());
      expect(calls("ticket-checkout-create")).toHaveLength(1);
      expect(openBrowserAsync).toHaveBeenCalledTimes(2);
      expect(openBrowserAsync.mock.calls[1][0]).toBe(
        "https://checkout.paystack.test/page-1",
      );
    },
  );

  it.each(["cancel", "dismiss", "opened"])(
    "a browser that closes with %s is asked about, never assumed",
    async (type) => {
      openBrowserAsync.mockResolvedValueOnce({ type });
      await pay(v2Input());
      expect(calls("ticket-checkout-status")).toHaveLength(1);
    },
  );
});

describe("#3281 6b — the poll only stops early on a real answer", () => {
  it.each([
    ["a 500", http(500)],
    ["a thrown transport error", "throw" as const],
    ["an empty response", { data: null, error: null }],
    ["a pending status", noAnswer],
  ])(
    "%s keeps polling, then the budget runs out with the page kept",
    async (_label, answer) => {
      jest.useFakeTimers();
      statusAnswers = [answer];
      expect(await payWithTimers(v2Input())).toEqual({
        outcome: "failed",
        message: AWAITING,
      });
      expect(calls("ticket-checkout-status")).toHaveLength(17);

      // The page is kept after a timeout: the next tap reopens it.
      await payWithTimers(v2Input());
      expect(calls("ticket-checkout-create")).toHaveLength(1);
    },
  );

  it("a 409 after a few unanswered polls still refuses and drops the page", async () => {
    jest.useFakeTimers();
    statusAnswers = [
      http(500),
      "throw",
      http(409, { error: "checkout_unavailable" }),
    ];
    expect(await payWithTimers(v2Input())).toEqual({
      outcome: "failed",
      message: NOT_ISSUED,
    });
    expect(calls("ticket-checkout-status")).toHaveLength(3);
  });
});

describe("#3281 6b — the create refusal with no held page", () => {
  it("checkout_in_progress says what is true on this app and holds nothing", async () => {
    createAnswer = () => http(409, { error: "checkout_in_progress" });
    const outcome = await pay(v2Input());
    expect(outcome).toEqual({
      outcome: "failed",
      message:
        "Your last payment for this order hasn't finished yet. If you paid, your tickets will arrive here and by email within a few minutes — don't pay again. If you didn't, try again in up to 15 minutes.",
    });
    expect(openBrowserAsync).not.toHaveBeenCalled();

    createAnswer = paystackPage;
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a free order for the same event drops an older cart's held page", async () => {
    await pay(v2Input());
    createAnswer = () => ({
      data: { kind: "free_completed", orderId: "ord-free" },
      error: null,
    });
    await pay(v2Input({ checkoutAttemptId: ATTEMPT_2 }));
    createAnswer = paystackPage;
    await pay(v2Input());
    expect(calls("ticket-checkout-create")).toHaveLength(3);
  });

  it("the Stripe and free rails are untouched: nothing is held", async () => {
    createAnswer = () => ({
      data: { kind: "free_completed", orderId: "ord-free" },
      error: null,
    });
    expect(await pay(v2Input())).toEqual({
      outcome: "succeeded",
      orderId: "ord-free",
    });
    expect(await pay(v2Input())).toEqual({
      outcome: "succeeded",
      orderId: "ord-free",
    });
    expect(calls("ticket-checkout-create")).toHaveLength(2);
    expect(openBrowserAsync).not.toHaveBeenCalled();
  });
});
