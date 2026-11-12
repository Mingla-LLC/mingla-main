// @ts-nocheck
/**
 * issue #3281 (bundle 6d) — Explorer gets the Host app's Paystack held-page
 * fixes (6b, 6c):
 *   - on Android the browser call returns `opened` while the buyer is still
 *     paying, so the poll waits until they are back (and never believes
 *     `abandoned` while the page may still be open);
 *   - a held page is re-checked with the server before it reopens, and is
 *     never reopened past the server's own session expiry;
 *   - one held page per cart; a sign-out mid-checkout never holds, opens,
 *     persists or clears anything for the account that left;
 *   - the recovery pointer (#3859) is only ever deleted for its own session.
 *
 * Runtime test: the REAL flow against mocked transport, browser, AppState and
 * secure store.
 */
const mockInvoke = jest.fn();
const mockOpenBrowserAsync = jest.fn();
let mockSecureValue: string | null = null;
/** How many times a recovery pointer was written (not just what is left). */
let mockSecureWrites = 0;

const mockAppStateListeners = new Set<(state: string) => void>();
const mockAppState = {
  currentState: "active",
  addEventListener: (_type: string, listener: (state: string) => void) => {
    mockAppStateListeners.add(listener);
    return { remove: () => mockAppStateListeners.delete(listener) };
  },
};
const setAppState = (state: string) => {
  mockAppState.currentState = state;
  for (const listener of [...mockAppStateListeners]) listener(state);
};

// The factory runs during the hoisted imports, before `mockAppState` is
// initialised, so AppState is read lazily.
jest.mock("react-native", () => ({
  Platform: { OS: "android" },
  get AppState() {
    return mockAppState;
  },
}));
jest.mock("../../lib/secureStoreSafe", () => ({
  isSecureStoreAvailable: () => true,
  secureGetItem: jest.fn(async () => mockSecureValue),
  secureSetItem: jest.fn(async (_key: string, value: string) => {
    mockSecureWrites += 1;
    mockSecureValue = value;
  }),
  secureDeleteItem: jest.fn(async () => {
    mockSecureValue = null;
  }),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
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
    initPaymentSheet: jest.fn(),
    presentPaymentSheet: jest.fn(),
    isPaymentSheetSupported: true,
  }),
}));
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: jest.fn() }));

import {
  clearAllHeldHandoffs,
  useNativeCheckoutFlow,
} from "../nativeCheckoutFlow";
import {
  clearNativeCheckoutRecoveryFor,
  purgeNativeCheckoutRecovery,
} from "../nativeCheckoutRecovery";
import {
  CHECKOUT_ABANDONED_MESSAGE,
  CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
  CHECKOUT_PAGE_EXPIRED_MESSAGE,
  CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
  CHECKOUT_RECHECK_FAILED_MESSAGE,
  CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
} from "../checkoutErrorMessages";

const EVENT = "32810000-0000-4000-8000-0000000006d1";
const TICKET = "32810000-0000-4000-8000-0000000006d2";
const ACCOUNT = "32810000-0000-4000-8000-0000000006d3";

const input = (quantity = 1) => ({
  checkoutContractVersion: 2 as const,
  purchaseTermsAccepted: true,
  accountId: ACCOUNT,
  eventId: EVENT,
  lines: [{ ticketTypeId: TICKET, quantity, paymentPlanChoice: "full" as const }],
  buyer: { name: "Ada", email: "ada@example.test", phone: "+2348000000001" },
});

// A trip / experience (v1) body: no contract version, no recovery pointer.
const v1Input = (quantity = 1) => ({
  eventId: EVENT,
  lines: [{ ticketTypeId: TICKET, quantity }],
  buyer: { name: "Ada", email: "ada@example.test", phone: "+2348000000001" },
});

let sessionSeq = 0;
let createAnswer: () => unknown;
let preflightAnswer: () => unknown;
let statusAnswers: unknown[];

const paystackPage = (extra: Record<string, unknown> = {}) => {
  sessionSeq += 1;
  return {
    data: {
      kind: "requires_paystack_redirect",
      checkoutSessionId: `sess-${sessionSeq}`,
      buyerStatusToken: `tok-${sessionSeq}`,
      authorizationUrl: `https://checkout.paystack.test/page-${sessionSeq}`,
      returnUrl: "https://host.usemingla.com/checkout/confirm",
      reference: `ref-${sessionSeq}`,
      totalCents: 1250,
      currency: "NGN",
      ...extra,
    },
    error: null,
  };
};

const abandoned = {
  data: { status: "failed", order: null, error: "paystack_charge_abandoned" },
  error: null,
};
const pending = { data: { status: "pending", order: null }, error: null };
const issued = {
  data: { status: "paid", order: { orderId: "ord-1", tickets: [{ id: "t1" }] } },
  error: null,
};
const mismatch = {
  data: { status: "failed", order: null, error: "paystack_payment_mismatch" },
  error: null,
};
const http = (status: number) => ({
  data: null,
  error: {
    context: {
      status,
      text: async () => JSON.stringify({ error: "checkout_unavailable" }),
      json: async () => ({ error: "checkout_unavailable" }),
    },
  },
});
const allowed = (expiresInSeconds?: number) => ({
  data: {
    status: "present_allowed",
    ...(expiresInSeconds === undefined ? {} : { expiresInSeconds }),
  },
  error: null,
});

const calls = (name: string) =>
  mockInvoke.mock.calls.filter(
    (c) => c[0] === name && c[1]?.body?.preflight !== true,
  );
const preflights = () =>
  mockInvoke.mock.calls.filter(
    (c) => c[0] === "ticket-checkout-status" && c[1]?.body?.preflight === true,
  );
const opened = () => mockOpenBrowserAsync.mock.calls.map((c) => c[0]);
const pointer = () => (mockSecureValue ? JSON.parse(mockSecureValue) : null);

const pay = (i = input()) => useNativeCheckoutFlow()(i);
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

beforeEach(async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockAppState.currentState = "active";
  mockAppStateListeners.clear();
  mockSecureValue = null;
  mockSecureWrites = 0;
  clearAllHeldHandoffs();
  await purgeNativeCheckoutRecovery();
  sessionSeq = 0;
  createAnswer = () => paystackPage();
  preflightAnswer = () => allowed();
  statusAnswers = [abandoned];
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (name: string, opts) => {
    if (name === "ticket-checkout-create") return createAnswer();
    if (name === "ticket-checkout-status" && opts?.body?.preflight === true) {
      return preflightAnswer();
    }
    if (name === "ticket-checkout-status") {
      // A queue: answers are used in order, and the last one repeats.
      const answer =
        statusAnswers.length > 1 ? statusAnswers.shift() : statusAnswers[0];
      if (answer === "throw") throw new Error("offline");
      return answer;
    }
    throw new Error(`unexpected ${name}`);
  });
  mockOpenBrowserAsync.mockReset();
  mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("#3281 6d — Android: the buyer is still paying when the browser call returns", () => {
  it("no status read happens until the buyer is back in the app", async () => {
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "opened" });
    statusAnswers = [issued];
    const run = pay();
    await flush();
    expect(calls("ticket-checkout-status")).toHaveLength(0);
    setAppState("background");
    await flush();
    expect(calls("ticket-checkout-status")).toHaveLength(0);
    setAppState("active");
    expect(await run).toMatchObject({ outcome: "succeeded", orderId: "ord-1" });
    expect(calls("ticket-checkout-status")).toHaveLength(1);
  });

  it("after the buyer is back, `abandoned` is believed and the page is kept", async () => {
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "opened" });
    const run = pay();
    await flush();
    setAppState("background");
    setAppState("active");
    expect(await run).toMatchObject({
      outcome: "failed",
      message: CHECKOUT_ABANDONED_MESSAGE,
    });
  });

  it("a page that never covers the app (split screen) never shows the abandoned copy", async () => {
    jest.useFakeTimers({ doNotFake: ["performance", "nextTick"] });
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "opened" });
    statusAnswers = [abandoned];
    const run = pay();
    let outcome;
    run.then((o) => {
      outcome = o;
    });
    for (let i = 0; i < 60 && outcome === undefined; i += 1) {
      await flush();
      jest.advanceTimersByTime(1500);
    }
    await flush();
    // v2: an unconfirmed outcome is pending, never "you closed the page".
    expect(outcome.outcome).not.toBe("failed");
    expect(JSON.stringify(outcome)).not.toContain(CHECKOUT_ABANDONED_MESSAGE);
    expect(calls("ticket-checkout-status")).toHaveLength(17);
  });

  it("a trip or experience (v1) page that never covers the app never shows the abandoned copy either", async () => {
    jest.useFakeTimers({ doNotFake: ["performance", "nextTick"] });
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "opened" });
    statusAnswers = [abandoned];
    const run = pay(v1Input());
    let outcome;
    run.then((o) => {
      outcome = o;
    });
    for (let i = 0; i < 60 && outcome === undefined; i += 1) {
      await flush();
      jest.advanceTimersByTime(1500);
    }
    await flush();
    expect(outcome).toEqual({
      outcome: "failed",
      message: CHECKOUT_AWAITING_CONFIRMATION_MESSAGE,
      token: null,
    });
    expect(calls("ticket-checkout-status")).toHaveLength(17);
  });

  it("a payment mismatch still ends the wait while the page may be open", async () => {
    jest.useFakeTimers({ doNotFake: ["performance", "nextTick"] });
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "opened" });
    statusAnswers = [mismatch];
    const run = pay();
    let outcome;
    run.then((o) => {
      outcome = o;
    });
    for (let i = 0; i < 10 && outcome === undefined; i += 1) {
      await flush();
      jest.advanceTimersByTime(1500);
    }
    await flush();
    expect(outcome).toMatchObject({
      outcome: "failed",
      message: CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
    });
  });

  it("a sign-out while the buyer is away returns nothing to whoever signs in", async () => {
    mockOpenBrowserAsync.mockResolvedValueOnce({ type: "opened" });
    statusAnswers = [issued];
    const run = pay();
    await flush();
    setAppState("background");
    clearAllHeldHandoffs();
    setAppState("active");
    expect(await run).toEqual({ outcome: "canceled" });
    expect(calls("ticket-checkout-status")).toHaveLength(0);
  });
});

describe("#3281 6d — a held page is re-checked before it reopens", () => {
  const abandonFirst = async () => {
    await pay(); // page held, abandoned: pointer cleared, page kept
    expect(opened()).toHaveLength(1);
  };

  it("a session revoked since is refused, never reopened, and dropped", async () => {
    await abandonFirst();
    statusAnswers = [http(409)];
    expect(await pay()).toMatchObject({
      outcome: "failed",
      message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
    });
    expect(opened()).toHaveLength(1);
    expect(preflights()).toHaveLength(0);
    statusAnswers = [abandoned];
    await pay();
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("an order that already finalized is returned, not reopened", async () => {
    await abandonFirst();
    statusAnswers = [issued];
    expect(await pay()).toMatchObject({ outcome: "succeeded", orderId: "ord-1" });
    expect(opened()).toHaveLength(1);
  });

  it("an order whose tickets are not out yet is pending: never reopened, pointer kept", async () => {
    await abandonFirst();
    expect(pointer()).toBeNull();
    statusAnswers = [
      { data: { status: "paid", order: { orderId: "ord-1", tickets: [] } }, error: null },
    ];
    expect(await pay()).toMatchObject({ outcome: "pending" });
    expect(opened()).toHaveLength(1);
    expect(pointer()).toMatchObject({
      checkoutSessionId: "sess-1",
      provider: "paystack",
    });
  });

  it("a trip or experience (v1) re-check: an order is the success it is, tickets or not", async () => {
    await pay(v1Input());
    statusAnswers = [
      { data: { status: "paid", order: { orderId: "ord-v1", tickets: [] } }, error: null },
    ];
    const outcome = await pay(v1Input());
    expect(outcome).toMatchObject({ outcome: "succeeded", orderId: "ord-v1" });
    expect("provider" in outcome).toBe(false);
    expect(opened()).toHaveLength(1);
  });

  it("after a v2 timeout the next tap is answered by recovery, then the page is reopened, never created twice", async () => {
    jest.useFakeTimers({ doNotFake: ["performance", "nextTick"] });
    statusAnswers = [pending];
    const run = pay();
    let first;
    run.then((o) => {
      first = o;
    });
    for (let i = 0; i < 60 && first === undefined; i += 1) {
      await flush();
      jest.advanceTimersByTime(1500);
    }
    await flush();
    jest.useRealTimers();
    // Timed out: "Confirming payment", with the pointer and the page kept.
    expect(first).toMatchObject({ outcome: "pending" });
    expect(pointer()).toMatchObject({ checkoutSessionId: "sess-1" });
    // The next tap asks the server through restart recovery first.
    const recovered = await pay();
    expect(recovered.outcome).toBeDefined();
    // Once the session has an answer that is not "still settling", the held
    // page is what the buyer gets back, not a second checkout.
    statusAnswers = [abandoned, pending, abandoned];
    mockSecureValue = null; // the recovery pointer has been resolved
    await pay();
    expect(calls("ticket-checkout-create")).toHaveLength(1);
  });

  it("a mismatch found on the re-check drops the page without opening it", async () => {
    await abandonFirst();
    statusAnswers = [mismatch];
    expect(await pay()).toMatchObject({
      outcome: "failed",
      message: CHECKOUT_PAYMENT_MISMATCH_MESSAGE,
    });
    expect(opened()).toHaveLength(1);
  });

  it.each([
    ["throws", "throw"],
    ["answers 500", http(500)],
    ["answers nothing", { data: null, error: null }],
  ])(
    "a status read that %s keeps the page but does not open it, and runs no preflight",
    async (_label, answer) => {
      await abandonFirst();
      statusAnswers = [answer];
      expect(await pay()).toEqual({
        outcome: "failed",
        message: CHECKOUT_RECHECK_FAILED_MESSAGE,
      });
      expect(opened()).toHaveLength(1);
      expect(preflights()).toHaveLength(0);
      expect(pointer()).toBeNull();
      statusAnswers = [pending, abandoned];
      await pay();
      expect(calls("ticket-checkout-create")).toHaveLength(1);
      expect(opened()).toEqual([
        "https://checkout.paystack.test/page-1",
        "https://checkout.paystack.test/page-1",
      ]);
    },
  );

  it("a paused sale (preflight 409) is not reopened, but the page is kept", async () => {
    await abandonFirst();
    statusAnswers = [pending];
    preflightAnswer = () => http(409);
    // A refusal never says "not charged": a payment could have settled since.
    expect(await pay()).toEqual({
      outcome: "failed",
      message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
    });
    expect(opened()).toHaveLength(1);
    preflightAnswer = () => allowed();
    statusAnswers = [pending, abandoned];
    await pay();
    expect(calls("ticket-checkout-create")).toHaveLength(1);
    expect(opened()).toHaveLength(2);
  });

  it.each([403, 404])(
    "a session the preflight no longer knows (%s) drops the page",
    async (status) => {
      await abandonFirst();
      statusAnswers = [pending];
      preflightAnswer = () => http(status);
      expect(await pay()).toEqual({
        outcome: "failed",
        message: CHECKOUT_TICKETS_NOT_ISSUED_MESSAGE,
      });
      preflightAnswer = () => allowed();
      statusAnswers = [abandoned];
      await pay();
      expect(calls("ticket-checkout-create")).toHaveLength(2);
    },
  );

  it("a failed admission check (503) keeps the page closed but held", async () => {
    await abandonFirst();
    statusAnswers = [pending];
    preflightAnswer = () => http(503);
    expect(await pay()).toEqual({
      outcome: "failed",
      message: CHECKOUT_RECHECK_FAILED_MESSAGE,
    });
    expect(opened()).toHaveLength(1);
  });

  it.each([
    [60, false],
    [0, false],
    [61, true],
  ])(
    "the server saying %s seconds are left: reopened = %s",
    async (seconds, reopens) => {
      await abandonFirst();
      statusAnswers = [pending, abandoned];
      preflightAnswer = () => allowed(seconds);
      const outcome = await pay();
      expect(opened()).toHaveLength(reopens ? 2 : 1);
      if (!reopens) {
        expect(outcome).toEqual({
          outcome: "failed",
          message: CHECKOUT_PAGE_EXPIRED_MESSAGE,
        });
        expect(pointer()).toBeNull();
      }
    },
  );

  it("the server's seconds left shorten the hold: a slow pointer write past that deadline never opens", async () => {
    const t0 = 1_900_000_000_000;
    const now = jest.spyOn(Date, "now").mockReturnValue(t0);
    await abandonFirst(); // held with the 14-minute fallback
    now.mockReturnValue(t0 + 10_000);
    statusAnswers = [pending, abandoned];
    preflightAnswer = () => allowed(65); // 5 s inside the margin
    const secure = jest.requireMock("../../lib/secureStoreSafe");
    secure.secureSetItem.mockImplementationOnce(async (_key, value) => {
      now.mockReturnValue(t0 + 20_000); // the write took 10 s
      mockSecureValue = value;
    });
    expect(await pay()).toEqual({
      outcome: "failed",
      message: CHECKOUT_PAGE_EXPIRED_MESSAGE,
    });
    expect(opened()).toHaveLength(1);
    expect(pointer()).toBeNull();
  });

  it("a recovery pointer that cannot be written for a pending order keeps the held page, and never reopens it", async () => {
    await abandonFirst();
    const unpaidTickets = {
      data: { status: "paid", order: { orderId: "ord-1", tickets: [] } },
      error: null,
    };
    statusAnswers = [unpaidTickets];
    const secure = jest.requireMock("../../lib/secureStoreSafe");
    secure.secureSetItem.mockImplementationOnce(async () => {
      throw new Error("secure store full");
    });
    expect(await pay()).toMatchObject({ outcome: "pending" });
    expect(pointer()).toBeNull();
    // The page is still the way back to this session: the next tap re-checks
    // it (no second create), and with the write working the pointer lands.
    expect(await pay()).toMatchObject({ outcome: "pending" });
    expect(calls("ticket-checkout-create")).toHaveLength(1);
    expect(opened()).toHaveLength(1);
    expect(pointer()).toMatchObject({ checkoutSessionId: "sess-1" });
  });

  it("the recovery pointer is written only after the re-check passes, and before the page opens", async () => {
    await abandonFirst();
    let pointerDuringRecheck = "unread";
    statusAnswers = [
      {
        get data() {
          pointerDuringRecheck = pointer();
          return { status: "pending", order: null };
        },
        error: null,
      },
      abandoned,
    ];
    let pointerWhenOpened;
    mockOpenBrowserAsync.mockImplementationOnce(async () => {
      pointerWhenOpened = pointer();
      return { type: "dismiss" };
    });
    await pay();
    expect(pointerDuringRecheck).toBeNull();
    expect(pointerWhenOpened).toMatchObject({ checkoutSessionId: "sess-1" });
  });
});

describe("#3281 6d — one held page per cart, timed by the server", () => {
  it("v2 cart A, then cart B, then back to A reopens A's page", async () => {
    statusAnswers = [abandoned];
    await pay(input(1));
    await pay(input(2));
    statusAnswers = [pending, abandoned];
    await pay(input(1));
    expect(calls("ticket-checkout-create")).toHaveLength(2);
    expect(opened()).toEqual([
      "https://checkout.paystack.test/page-1",
      "https://checkout.paystack.test/page-2",
      "https://checkout.paystack.test/page-1",
    ]);
  });

  it("v1 (trip) cart A, then B, then back to A reopens A's page", async () => {
    await pay(v1Input(1));
    await pay(v1Input(2));
    statusAnswers = [pending, abandoned];
    await pay(v1Input(1));
    expect(calls("ticket-checkout-create")).toHaveLength(2);
    expect(opened()[2]).toBe("https://checkout.paystack.test/page-1");
  });

  it("a session with 5 minutes left stops being reopened a minute before it ends", async () => {
    const t0 = 1_900_000_000_000;
    const now = jest.spyOn(Date, "now").mockReturnValue(t0);
    createAnswer = () => paystackPage({ expiresInSeconds: 300 });
    await pay();
    now.mockReturnValue(t0 + 240_000 - 1);
    statusAnswers = [pending, abandoned];
    await pay();
    expect(calls("ticket-checkout-create")).toHaveLength(1);
    now.mockReturnValue(t0 + 240_000);
    statusAnswers = [abandoned];
    await pay();
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a phone clock moved back cannot stretch the hold", async () => {
    const t0 = 1_900_000_000_000;
    const now = jest.spyOn(Date, "now").mockReturnValue(t0);
    const mono = jest.spyOn(performance, "now").mockReturnValue(1_000);
    createAnswer = () => paystackPage({ expiresInSeconds: 300 });
    await pay();
    now.mockReturnValue(t0 - 3_600_000); // clock corrected back an hour
    mono.mockReturnValue(1_000 + 240_000); // four real minutes passed
    statusAnswers = [abandoned];
    await pay();
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a deadline that passes during the re-check is caught before the page opens", async () => {
    const t0 = 1_900_000_000_000;
    const now = jest.spyOn(Date, "now").mockReturnValue(t0);
    createAnswer = () => paystackPage({ expiresInSeconds: 300 });
    await pay();
    now.mockReturnValue(t0 + 200_000);
    statusAnswers = [pending];
    preflightAnswer = () => {
      now.mockReturnValue(t0 + 245_000);
      return allowed();
    };
    const writesBefore = mockSecureWrites;
    expect(await pay()).toEqual({
      outcome: "failed",
      message: CHECKOUT_PAGE_EXPIRED_MESSAGE,
    });
    expect(opened()).toHaveLength(1);
    expect(pointer()).toBeNull();
    // Never even written: the deadline is checked before the pointer is.
    expect(mockSecureWrites).toBe(writesBefore);
  });

  it("a session that arrives with no time left is never opened", async () => {
    createAnswer = () => paystackPage({ expiresInSeconds: 0 });
    expect(await pay()).toEqual({
      outcome: "failed",
      message: CHECKOUT_PAGE_EXPIRED_MESSAGE,
    });
    expect(opened()).toHaveLength(0);
    expect(pointer()).toBeNull();
    expect(CHECKOUT_PAGE_EXPIRED_MESSAGE).not.toMatch(/not been charged/);
  });
});

describe("#3281 6d — a sign-out mid-checkout leaves nothing behind for the next account", () => {
  it("a create that answers after sign-out never persists, holds or opens", async () => {
    createAnswer = () => {
      clearAllHeldHandoffs();
      return paystackPage();
    };
    expect(await pay()).toEqual({ outcome: "canceled" });
    expect(opened()).toHaveLength(0);
    expect(pointer()).toBeNull();
    // The old account's pointer is never written at all.
    expect(mockSecureWrites).toBe(0);
    createAnswer = () => paystackPage();
    await pay();
    expect(calls("ticket-checkout-create")).toHaveLength(2);
  });

  it("a sign-out during the re-check never reopens the old account's page", async () => {
    await pay();
    statusAnswers = [pending];
    preflightAnswer = () => {
      clearAllHeldHandoffs();
      return allowed();
    };
    expect(await pay()).toEqual({ outcome: "canceled" });
    expect(opened()).toHaveLength(1);
    expect(pointer()).toBeNull();
  });

  it("a sign-out while the held page's recovery pointer is being written: nothing opens, nothing is left", async () => {
    await pay(); // held, abandoned: pointer cleared
    statusAnswers = [pending, abandoned];
    const secure = jest.requireMock("../../lib/secureStoreSafe");
    secure.secureSetItem.mockImplementationOnce(async (_key, value) => {
      // The sign-out runs (generation bump, then the purge) while the write
      // is in flight, and the write lands after it.
      clearAllHeldHandoffs();
      // The sign-out's purge queues behind this write (recovery-key ops run
      // one at a time), so it runs after the write lands.
      void purgeNativeCheckoutRecovery();
      mockSecureWrites += 1;
      mockSecureValue = value;
    });
    expect(await pay()).toEqual({ outcome: "canceled" });
    expect(opened()).toHaveLength(1);
    expect(pointer()).toBeNull();
  });

  it("a sign-out while an order-pending pointer is being written leaves nothing behind", async () => {
    await pay();
    statusAnswers = [
      { data: { status: "paid", order: { orderId: "ord-1", tickets: [] } }, error: null },
    ];
    const secure = jest.requireMock("../../lib/secureStoreSafe");
    secure.secureSetItem.mockImplementationOnce(async (_key, value) => {
      clearAllHeldHandoffs();
      // The sign-out's purge queues behind this write (recovery-key ops run
      // one at a time), so it runs after the write lands.
      void purgeNativeCheckoutRecovery();
      mockSecureValue = value;
    });
    expect(await pay()).toEqual({ outcome: "canceled" });
    expect(pointer()).toBeNull();
  });

  it("a stale checkout's guard release never frees a newer checkout's claim", async () => {
    let releaseFirst;
    createAnswer = () =>
      new Promise((resolve) => {
        releaseFirst = () => resolve(paystackPage());
      });
    const first = pay();
    await flush();
    clearAllHeldHandoffs(); // sign-out frees the guard

    let releaseSecond;
    createAnswer = () =>
      new Promise((resolve) => {
        releaseSecond = () => resolve(paystackPage());
      });
    const second = pay(input(2));
    await flush();

    releaseFirst();
    expect(await first).toEqual({ outcome: "canceled" });

    // The second checkout still holds the guard: a third tap is refused.
    expect(await pay(input(3))).toEqual({ outcome: "canceled" });
    expect(calls("ticket-checkout-create")).toHaveLength(2);

    releaseSecond();
    await second;
  });

  it("a newer pointer written while an old checkout's clear is reading survives", async () => {
    mockSecureValue = JSON.stringify({
      version: 1, checkoutSessionId: "old-session", buyerStatusToken: "t",
      accountId: ACCOUNT, eventId: EVENT, provider: "paystack",
      createdAt: Date.now(), expiresAt: Date.now() + 60_000,
    });
    const secure = jest.requireMock("../../lib/secureStoreSafe");
    let releaseRead;
    secure.secureGetItem.mockImplementationOnce(() => {
      // The read sees the store as it was when it started.
      const seen = mockSecureValue;
      return new Promise((resolve) => {
        releaseRead = () => resolve(seen);
      });
    });
    // The old checkout starts clearing its own pointer; its read is slow.
    const clearing = clearNativeCheckoutRecoveryFor("old-session");
    await flush();
    // Meanwhile a newer checkout writes its pointer (queued behind the clear,
    // so it lands after the clear has finished).
    const { persistNativeCheckoutRecovery, createNativeCheckoutRecoveryPointer } =
      jest.requireActual("../nativeCheckoutRecovery");
    const writing = persistNativeCheckoutRecovery(
      createNativeCheckoutRecoveryPointer({
        checkoutSessionId: "new-session", buyerStatusToken: "t2",
        accountId: ACCOUNT, eventId: EVENT, provider: "paystack",
      }),
    );
    await flush();
    releaseRead();
    await clearing;
    await writing;
    expect(pointer()).toMatchObject({ checkoutSessionId: "new-session" });
  });

  it("a recovery pointer is only ever deleted for its own session", async () => {
    mockSecureValue = JSON.stringify({
      version: 1,
      checkoutSessionId: "someone-elses-session",
      buyerStatusToken: "tok",
      accountId: ACCOUNT,
      eventId: EVENT,
      provider: "paystack",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    await clearNativeCheckoutRecoveryFor("sess-1");
    expect(pointer()).toMatchObject({ checkoutSessionId: "someone-elses-session" });
    await clearNativeCheckoutRecoveryFor("someone-elses-session");
    expect(pointer()).toBeNull();
  });
});

describe("#3281 6d — the shared modules load under Explorer's babel without runtime helpers", () => {
  it.each(["paystackHeldHandoff", "paymentPageReturn"])(
    "packages/payments-native/%s.ts compiles with no @babel/runtime require",
    (name) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const babel = require("@babel/core");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readFileSync } = require("node:fs");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { join } = require("node:path");
      const file = join(
        __dirname, "..", "..", "..", "..", "packages", "payments-native", `${name}.ts`,
      );
      const out = babel.transformSync(readFileSync(file, "utf8"), {
        filename: file,
        cwd: join(__dirname, "..", "..", ".."),
        caller: { name: "babel-jest", supportsStaticESM: false },
      });
      expect(out.code).not.toMatch(/@babel\/runtime/);
    },
  );
});
