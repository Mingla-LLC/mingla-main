/**
 * issue #2227 [paystack payment page never opens] — TESTER ADVERSARIAL.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR.
 * -------------------------------------
 * The implementor's suite is source assertions plus one happy path per branch,
 * with `expo-web-browser` mocked by a hand-written object. This suite attacks
 * the seams that shape leaves open:
 *
 *  1. THE MOCK ITSELF. Every "locked" assertion in this repo compares against a
 *     string the TEST supplied. If the pinned library ever renamed that enum
 *     member the product would poll for 25 silent seconds and every test would
 *     stay green — the #2113 shape. Here the value is read out of the installed
 *     `expo-web-browser` build and pinned against the source of the flow.
 *  2. THE BUYER-VISIBLE BOUNDARY, not the mapper in isolation. Every token the
 *     live edge function can emit is driven through the REAL flow and asserted
 *     on `outcome.message` — the string a screen actually renders.
 *  3. THE ERROR SHAPES SUPABASE ACTUALLY PRODUCES: a non-JSON body, an HTML
 *     gateway page, a `message`/`msg` key, a context with no readable body at
 *     all, and a network error with no context.
 *  4. THE HOLD AS A CACHE: exact TTL boundary, cross-event bleed, survival
 *     across a browser that never presented, and release on success.
 *  5. THE REDIRECT ARGUMENT the whole P0 was about — asserted at runtime as
 *     "the https returnUrl reached NO browser primitive", not as a grep.
 *
 * Fails on revert: restore `openAuthSessionAsync(data.authorizationUrl,
 * data.returnUrl)` (verified by true line edit — see the QA report on #2227).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockInvoke = jest.fn();
const mockOpenBrowserAsync = jest.fn();
const mockOpenAuthSessionAsync = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } },
}));

jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...a: unknown[]) => mockOpenBrowserAsync(...a),
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuthSessionAsync(...a),
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

import { useNativeCheckoutFlow } from "../nativeCheckoutFlow";
import {
  CHECKOUT_IN_PROGRESS_MESSAGE,
  CHECKOUT_NO_HANDOFF_MESSAGE,
  NATIVE_CHECKOUT_MESSAGES,
} from "../checkoutErrorMessages";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const FLOW_SOURCE = readFileSync(join(__dirname, "..", "nativeCheckoutFlow.ts"), "utf8");

/**
 * The flow with every comment removed. The protective comment #2227 mandates
 * NAMES the forbidden API and the forbidden argument, so a source assertion
 * that reads raw text can only ever assert the comment. Code-only is the only
 * honest way to assert what the file DOES.
 */
const FLOW_CODE = FLOW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const AUTH_URL = "https://checkout.paystack.com/live-page-abc";
/** The exact argument iOS destroyed the session over (#2227 root cause). */
const RETURN_URL = "https://host.usemingla.com/checkout/evt/confirm?cs=paystack";

let seq = 0;
const nextEvent = (): string => `adv-2227-${++seq}`;

const inputFor = (eventId: string, quantity = 1) => ({
  eventId,
  lines: [{ ticketTypeId: "tt-ga", quantity }],
  buyer: { name: "Ada Buyer", email: "ada@example.com", phone: "+2348012345678" },
});

const paystackCreate = (eventId: string, authorizationUrl = AUTH_URL) => ({
  data: {
    kind: "requires_paystack_redirect",
    checkoutSessionId: `cs-${eventId}`,
    buyerStatusToken: `bst-${eventId}`,
    authorizationUrl,
    returnUrl: RETURN_URL,
    reference: `ref-${eventId}`,
    totalCents: 10000,
    currency: "NGN",
  },
  error: null,
});

/** supabase-js wraps a non-2xx edge response in a FunctionsHttpError. */
const httpError = (status: number | undefined, body: unknown) => ({
  data: null,
  error: {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: {
      ...(status === undefined ? {} : { status }),
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    },
  },
});

const countInvokes = (fn: string): number =>
  mockInvoke.mock.calls.filter((call: unknown[]) => call[0] === fn).length;

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" });
});

// ---------------------------------------------------------------------------

describe("#2227 adversarial — the mock cannot lie about the library", () => {
  it("`locked` is the REAL value the installed expo-web-browser emits", () => {
    // Read from the installed package, not from this file's jest.mock. If the
    // pinned library renamed this member, the product's === would silently stop
    // matching and the buyer would get 25 seconds of nothing instead of copy.
    const typesSource = readFileSync(
      join(
        REPO_ROOT,
        "app-mobile",
        "node_modules",
        "expo-web-browser",
        "build",
        "WebBrowser.types.js",
      ),
      "utf8",
    );
    expect(typesSource).toMatch(/WebBrowserResultType\["LOCKED"\]\s*=\s*"locked"/);

    // ...and the flow compares against the ENUM MEMBER, never a bare literal,
    // so a library rename becomes a type error rather than a silent poll.
    expect(FLOW_CODE).toMatch(
      /opened\.type\s*===\s*WebBrowser\.WebBrowserResultType\.LOCKED/,
    );
  });

  it("the pinned expo-web-browser is the major that made an https redirect fatal", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "app-mobile", "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const range = pkg.dependencies["expo-web-browser"];
    expect(range).toBeDefined();
    // >= 15 is the branch that selects ASWebAuthenticationSession(.https(...))
    // on iOS >= 17.4 and needs a `webcredentials:` Associated Domain.
    expect(Number(/(\d+)/.exec(range)?.[1])).toBeGreaterThanOrEqual(15);
  });
});

describe("#2227 adversarial — the https returnUrl reaches no browser primitive", () => {
  it("openBrowserAsync gets the authorization URL and NOTHING else, ever", async () => {
    const eventId = nextEvent();
    mockInvoke
      .mockResolvedValueOnce(paystackCreate(eventId))
      .mockResolvedValueOnce({ data: { order: { orderId: "ord-1" } }, error: null });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled();
    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(1);
    const args = mockOpenBrowserAsync.mock.calls[0];
    expect(args).toEqual([AUTH_URL]);
    // The single strongest statement of the P0: the fatal argument is not
    // anywhere in the call, under any position or any spelling.
    expect(JSON.stringify(args)).not.toContain("host.usemingla.com");
    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-1" });
  });

  it("the server's returnUrl is still consumed by nobody on the client", () => {
    // The server must keep emitting it (Paystack's own callback_url and the
    // buyer-web rail depend on it) — but the native flow must not read it.
    // It may still be DECLARED on the response type — the server sends it. It
    // must never be READ.
    expect(FLOW_CODE).not.toMatch(/\bdata\.returnUrl\b/);
    expect(FLOW_CODE).toMatch(/returnUrl:\s*string;/);
  });
});

describe("#2227 adversarial — every live server token at the buyer boundary", () => {
  const deriveServerTokens = (): string[] => {
    const tokens = new Set<string>();
    for (const rel of [
      ["supabase", "functions", "ticket-checkout-create", "index.ts"],
      ["supabase", "functions", "_shared", "ticketCheckoutAccess.ts"],
    ]) {
      const source = readFileSync(join(REPO_ROOT, ...rel), "utf8");
      for (const m of source.matchAll(/\berror:\s*"([a-z][a-z0-9_]*)"/g)) {
        tokens.add(m[1]);
      }
    }
    // DB-produced, only visible in the function's own contract tests.
    tokens.add("checkout_unavailable");
    return [...tokens].sort();
  };

  it("no token, at any status, becomes the sentence a buyer reads", async () => {
    const tokens = deriveServerTokens();
    expect(tokens.length).toBeGreaterThanOrEqual(38);

    const failures: string[] = [];
    const run = useNativeCheckoutFlow();
    for (const token of tokens) {
      for (const status of [400, 401, 403, 409, 422, 426, 500]) {
        mockInvoke.mockResolvedValue(httpError(status, { error: token }));
        const result = await run(inputFor(`${nextEvent()}-${token}`));
        if (result.outcome !== "failed") {
          failures.push(`${token}@${status} outcome=${result.outcome}`);
          continue;
        }
        if (!NATIVE_CHECKOUT_MESSAGES.includes(result.message)) {
          failures.push(`${token}@${status} unowned="${result.message}"`);
        }
        if (result.message.includes(token)) {
          failures.push(`${token}@${status} LEAKED`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it("no browser and no poll ever run on a refused create", async () => {
    const eventId = nextEvent();
    mockInvoke.mockResolvedValue(httpError(409, { error: "checkout_in_progress" }));

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result.outcome).toBe("failed");
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    expect(countInvokes("ticket-checkout-status")).toBe(0);
  });
});

describe("#2227 adversarial — the error shapes supabase-js actually produces", () => {
  const CASES: [string, number | undefined, unknown][] = [
    ["a plain-text 5xx body", 500, "boom: pod crashed"],
    ["an HTML gateway page", 502, "<!doctype html><h1>502 Bad Gateway</h1>"],
    ["a `message` key instead of `error`", 400, { message: "buyer_email_invalid" }],
    ["a `msg` key carrying server detail", 400, { msg: "pg: relation does not exist" }],
    ["a body that is valid JSON but not an object", 400, "[1,2,3]"],
    ["an empty body", 400, ""],
    ["no status on the context at all", undefined, { error: "checkout_in_progress" }],
  ];

  it.each(CASES)(
    "%s still yields owned buyer copy",
    async (_label: string, status: number | undefined, body: unknown) => {
      mockInvoke.mockResolvedValue(httpError(status, body));
      const result = await useNativeCheckoutFlow()(inputFor(nextEvent()));
      expect(result.outcome).toBe("failed");
      if (result.outcome === "failed") {
        expect(NATIVE_CHECKOUT_MESSAGES).toContain(result.message);
        expect(result.message).not.toMatch(/pg:|doctype|pod crashed|relation/i);
      }
    },
  );

  it("a transport failure with no context leaks no stack and no SDK string", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" },
    });
    const result = await useNativeCheckoutFlow()(inputFor(nextEvent()));
    expect(result.outcome).toBe("failed");
    if (result.outcome === "failed") {
      expect(NATIVE_CHECKOUT_MESSAGES).toContain(result.message);
      expect(result.message).not.toMatch(/Edge Function|Failed to send/);
    }
  });
});

describe("#2227 adversarial — a browser that never presented", () => {
  it("`locked` fails fast, keeps the held page, and never polls", async () => {
    const eventId = nextEvent();
    mockInvoke.mockImplementation(async (fn: string) =>
      fn === "ticket-checkout-create"
        ? paystackCreate(eventId)
        : { data: { order: null }, error: null },
    );
    mockOpenBrowserAsync.mockResolvedValue({ type: "locked" });

    const first = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(first).toEqual({ outcome: "failed", message: CHECKOUT_NO_HANDOFF_MESSAGE });
    expect(countInvokes("ticket-checkout-status")).toBe(0);

    // The hold must SURVIVE — the buyer never saw the page, so their next tap
    // has to reach that same page rather than ask for a second checkout.
    mockOpenBrowserAsync.mockResolvedValue({ type: "dismiss" });
    mockInvoke.mockImplementation(async (fn: string) =>
      fn === "ticket-checkout-create"
        ? paystackCreate(eventId, "https://checkout.paystack.com/SHOULD-NEVER-BE-USED")
        : { data: { order: { orderId: "ord-locked" } }, error: null },
    );
    const second = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(second).toEqual({ outcome: "succeeded", orderId: "ord-locked" });
    expect(countInvokes("ticket-checkout-create")).toBe(1);
    expect(mockOpenBrowserAsync.mock.calls.map((c: unknown[]) => c[0])).toEqual([AUTH_URL, AUTH_URL]);
  });

  it("a throw fails fast with the same copy and never polls", async () => {
    const eventId = nextEvent();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockInvoke.mockImplementation(async (fn: string) =>
      fn === "ticket-checkout-create"
        ? paystackCreate(eventId)
        : { data: { order: null }, error: null },
    );
    mockOpenBrowserAsync.mockRejectedValue(new Error("ERR_WEB_BROWSER_MODULE_UNAVAILABLE"));

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "failed", message: CHECKOUT_NO_HANDOFF_MESSAGE });
    expect(countInvokes("ticket-checkout-status")).toBe(0);
    if (result.outcome === "failed") {
      // The thrown message is Expo's, not Mingla's — it must not be rendered.
      expect(result.message).not.toContain("ERR_WEB_BROWSER");
    }
  });
});

describe("#2227 adversarial — the hold is a cache with edges", () => {
  it("expires EXACTLY at the 15-minute session window, not a tick later", async () => {
    const eventId = nextEvent();
    const t0 = 1_800_000_000_000;
    const TTL = 15 * 60 * 1000;
    let now = t0;
    jest.spyOn(Date, "now").mockImplementation(() => now);

    // Seed the hold without paying the 25-second poll: the page is held BEFORE
    // the browser is opened, and `locked` returns immediately.
    mockOpenBrowserAsync.mockResolvedValue({ type: "locked" });
    mockInvoke.mockResolvedValue(paystackCreate(eventId));
    await useNativeCheckoutFlow()(inputFor(eventId)); // holds at t0

    expect(countInvokes("ticket-checkout-create")).toBe(1);

    // #2227 QA F-1 — the refusal path hands NOTHING back any more (`resumeUrl`
    // is deleted, because it could not see the fingerprint), so the only honest
    // observable for "the hold is still alive" is the fingerprint-gated replay:
    // the SAME cart re-opens the held page and asks the server for nothing.
    //
    // One millisecond BEFORE the window closes: the page is still live.
    now = t0 + TTL - 1;
    const justAlive = await useNativeCheckoutFlow()(inputFor(eventId));
    expect(justAlive.outcome).toBe("failed"); // still `locked`
    expect(countInvokes("ticket-checkout-create")).toBe(1);
    expect(mockOpenBrowserAsync.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      AUTH_URL,
      AUTH_URL,
    ]);

    // ON the boundary: the session can no longer be paid, so nothing is served
    // and the flow goes back to the server rather than replaying a dead page.
    now = t0 + TTL;
    mockInvoke.mockResolvedValue(httpError(409, { error: "checkout_in_progress" }));
    const dead = await useNativeCheckoutFlow()(inputFor(eventId));
    expect(countInvokes("ticket-checkout-create")).toBe(2);
    expect(dead.outcome).toBe("failed");
    if (dead.outcome === "failed") {
      expect(dead.message).toBe(CHECKOUT_IN_PROGRESS_MESSAGE);
      expect("resumeUrl" in dead).toBe(false);
    }
    // The dead page was never re-opened.
    expect(mockOpenBrowserAsync).toHaveBeenCalledTimes(2);
  });

  it("a hold for one event is never served to another", async () => {
    const eventA = nextEvent();
    const eventB = nextEvent();
    mockOpenBrowserAsync.mockResolvedValue({ type: "locked" });
    mockInvoke.mockResolvedValue(paystackCreate(eventA));
    await useNativeCheckoutFlow()(inputFor(eventA));

    mockInvoke.mockResolvedValue(httpError(409, { error: "checkout_in_progress" }));
    const other = await useNativeCheckoutFlow()(inputFor(eventB));

    expect(other.outcome).toBe("failed");
    if (other.outcome === "failed") {
      // #2227 QA F-1 — nothing is offered back on the refusal path at all.
      expect("resumeUrl" in other).toBe(false);
    }
    // Event B went to the server on its own account, and event A's live page
    // was never opened for it.
    expect(countInvokes("ticket-checkout-create")).toBe(2);
    expect(mockOpenBrowserAsync.mock.calls.map((c: unknown[]) => c[0])).toEqual([AUTH_URL]);
  });

  it("a finalized order releases the page — the next purchase creates afresh", async () => {
    const eventId = nextEvent();
    mockInvoke.mockImplementation(async (fn: string) =>
      fn === "ticket-checkout-create"
        ? paystackCreate(eventId)
        : { data: { order: { orderId: "ord-done" } }, error: null },
    );
    const run = useNativeCheckoutFlow();
    await run(inputFor(eventId));
    await run(inputFor(eventId));
    expect(countInvokes("ticket-checkout-create")).toBe(2);
  });

  it("the hold never touches disk — a payment URL is a bearer capability", () => {
    expect(FLOW_CODE).not.toMatch(/AsyncStorage|SecureStore|expo-secure-store/);
    expect(FLOW_CODE).not.toMatch(/zustand|persist\(/);
    expect(FLOW_CODE).toMatch(/new Map<string,\s*HeldPaystackHandoff>\(\)/);
  });
});

describe("#2227 adversarial — the free and Stripe rails are untouched", () => {
  it("a free reservation finalizes with no browser and no poll", async () => {
    const eventId = nextEvent();
    mockInvoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "ord-free" },
      error: null,
    });

    const result = await useNativeCheckoutFlow()(inputFor(eventId));

    expect(result).toEqual({ outcome: "succeeded", orderId: "ord-free" });
    expect(mockOpenBrowserAsync).not.toHaveBeenCalled();
    expect(mockOpenAuthSessionAsync).not.toHaveBeenCalled();
    expect(countInvokes("ticket-checkout-status")).toBe(0);
  });

  it("the create request still declares the Host return contract the server needs", async () => {
    const eventId = nextEvent();
    mockInvoke.mockResolvedValue({
      data: { kind: "free_completed", orderId: "ord-free-2" },
      error: null,
    });
    await useNativeCheckoutFlow()(inputFor(eventId));

    const body = mockInvoke.mock.calls[0][1].body as Record<string, unknown>;
    // #2050: dropping the client half of the browser contract must not have
    // touched the SERVER half — Paystack still needs its own callback_url.
    expect(body.surface).toBe("native");
    expect(body.returnContract).toBe("host_v1");
  });
});
