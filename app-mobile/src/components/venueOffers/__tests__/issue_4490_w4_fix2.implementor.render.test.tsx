/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * #4490 spec 06 W4 fix 2 (W4-D1, P2 seen on a device) — a session that ends
 * mid-checkout shows "Sign in again", survives the app-wide sign-out, and
 * comes back to the same step after signing in as the same account.
 *
 *   D1-1 auth error on QUOTE: the lost-session state (never "Something went
 *        wrong", never a Try again); kept at once; the forced sign-out that
 *        unmounts the tree keeps it; same account → the choose step, picks kept
 *   D1-2 auth error on HOLD: kept; same account → Review with the same quote;
 *        Pay holds with the SAME hold key (no second booking)
 *   D1-3 auth error on PAY: kept with the booking; same account → the booking
 *        re-read on the owner path, Review, Pay continues; another account →
 *        dropped, unseen
 *   D1-4 "Sign in again" while the app still holds the dead session: the app's
 *        own sign-out for that account, then back to the start (welcome)
 *   D1-5 a forced sign-out with no checkout call at all (the store only), the
 *        tree unmounting in the same turn: still kept
 *   D1-6 the hold ran out while signed out: the §6 line on step 1, picks kept
 *   D1-7 an ordinary failure still reads "Something went wrong. Try again."
 *   D1-8 Close on the lost-session state drops what was kept
 *   R1-1 W4-R1: "Pay to hold your date" for a hire whose balance date has
 *        passed says why everything is due now (the existing buyer-web line);
 *        without that reason (or with a deposit offered) it says nothing more
 *   R1-2 a group package quote folded into one payment (balance_due_passed)
 *        says the same on Review; a quote with Half now does not
 *
 * FAILS-ON-REVERT: drop the session-lost codes from the reducer and D1-1..D1-3
 * show the generic line; drop the fullNowReason line from the sheet and R1-1 /
 * R1-2 fail; drop the store subscription / keep-at-once and D1-1
 * (after the unmount) and D1-5 keep nothing; drop the sign-out in Sign in
 * again and D1-4 fails.
 */
import React from "react";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");

jest.mock("../../ui/BaseBottomSheet", () => {
  const R = require("react") as typeof import("react");
  return {
    BaseBottomSheet: (props: Record<string, unknown>) =>
      props.visible ? R.createElement(R.Fragment, null, props.children as never, props.stickyFooter as never) : null,
    BottomSheetTextInput: (props: Record<string, unknown>) => R.createElement("input", props),
  };
});
jest.mock("../VenueCheckoutWhenLine", () => ({ VenueCheckoutWhenLine: () => null }));
jest.mock("react-native-qrcode-svg", () => () => null);
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockNav: string[] = [];
jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: (p: string) => mockNav.push(`push:${p}`),
    canGoBack: () => true,
    dismissAll: () => mockNav.push("dismissAll"),
    replace: (p: string) => mockNav.push(`replace:${p}`),
  }),
}));
const mockBrowser: string[] = [];
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: async (url: string) => {
    mockBrowser.push(url);
    return { type: "dismiss" };
  },
  WebBrowserResultType: { CANCEL: "cancel", DISMISS: "dismiss", OPENED: "opened", LOCKED: "locked" },
}));
jest.mock("@stripe/stripe-react-native", () => ({ initStripe: async () => undefined }));
jest.mock("@mingla/payments-native", () => ({
  useStripePaymentSheet: () => ({ initPaymentSheet: async () => ({}), presentPaymentSheet: async () => ({}), isPaymentSheetSupported: true }),
  isStripeGooglePayTestEnv: () => true,
}));
jest.mock("../../../payments/explorerCheckoutContact.mjs", () => ({
  resolveExplorerCheckoutContact: () => ({ normalized: { name: "Ada Test", email: "ada@example.com", phone: "" } }),
}));
const mockSecure = new Map<string, string>();
jest.mock("../../../lib/secureStoreSafe", () => ({
  isSecureStoreAvailable: () => true,
  secureGetItem: async (k: string) => mockSecure.get(k) ?? null,
  secureSetItem: async (k: string, v: string) => void mockSecure.set(k, v),
  secureDeleteItem: async (k: string) => void mockSecure.delete(k),
}));
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: async () => ({ data: null, error: null }) } } }));
jest.mock("../../../services/postHogService", () => ({ postHogService: { capture: () => undefined } }));
const mockStore = { user: { id: "user-4490", email: "ada@example.com" } as { id: string; email: string } | null, profile: null };
const mockStoreListeners = new Set<() => void>();
const mockStoreSubscribers = new Set<(s: unknown) => void>();
const mockSignOuts: { reason: string; id: string }[] = [];
jest.mock("../../../utils/authCleanup", () => ({
  signOutWithPrivateCleanup: async (reason: string, id: string) => {
    mockSignOuts.push({ reason, id });
    return { error: null };
  },
}));
jest.mock("../../../store/appStore", () => {
  const R = require("react") as typeof import("react");
  const useAppStore = (sel: (s: typeof mockStore) => unknown) => {
    const [, force] = R.useReducer((n: number) => n + 1, 0);
    R.useEffect(() => {
      mockStoreListeners.add(force);
      return () => void mockStoreListeners.delete(force);
    }, []);
    return sel(mockStore);
  };
  useAppStore.getState = () => mockStore;
  // zustand's own subscribe: listeners run synchronously on a store change.
  useAppStore.subscribe = (l: (s: typeof mockStore) => void) => {
    mockStoreSubscribers.add(l);
    return () => void mockStoreSubscribers.delete(l);
  };
  return { useAppStore };
});
jest.mock("../../../services/venuePurchaseService", () => {
  class VenuePurchaseError extends Error {
    code: string;
    remaining: number | null;
    constructor(code: string, remaining: number | null = null) {
      super(code);
      this.code = code;
      this.remaining = remaining;
    }
  }
  return {
    VenuePurchaseError,
    VENUE_READ_TIMEOUT_MS: 10000,
    invokeVenueFunction: async () => null,
    getVenueBooking: async () => ({ passes: [{ qrPayload: "PASS-QR" }] }),
    getVenueOfferAvailability: async () => ({ days: [] }),
  };
});
const mockCalls: { fn: string; input: unknown }[] = [];
let mockScript: Record<string, (input: unknown) => Promise<unknown>> = {};
jest.mock("../../../services/venueOfferCheckoutService", () => {
  const call = (fn: string) => (input: unknown) => {
    mockCalls.push({ fn, input });
    const handler = mockScript[fn];
    if (handler === undefined) return Promise.reject(new Error(`unscripted ${fn}`));
    return handler(input);
  };
  return {
    venueOfferCheckoutService: Object.fromEntries(
      ["offer", "availability", "hireOptions", "hourDay", "quote", "hold", "pay", "confirmReturn", "get", "membershipJoin", "memberPay", "memberConfirm", "membershipGet"]
        .map((fn) => [fn, call(fn)]),
    ),
  };
});

const { VenueOfferCheckoutSheet } = require("../VenueOfferCheckoutSheet") as typeof import("../VenueOfferCheckoutSheet");
const resumeStore = require("../venueCheckoutResume") as typeof import("../venueCheckoutResume");
const { venueToday, addDays, weekdayOf } = require("@mingla/brand-rendering/venueOffers/entryModel");
const { venueMoneyText } = require("../venueMoneyText");

const TZ = "Africa/Lagos";
const TODAY = venueToday(new Date(), TZ);
const money = (m: number) => venueMoneyText(m, "NGN", 2);
const GROUP = "00000000-4490-4000-8000-0000000014a9";
const QUOTE_ID = "00000000-4490-4000-8000-0000000014aa";

const ENTRY_OFFER = {
  id: "offer-entry",
  name: "Arcade",
  currencyCode: "NGN",
  minorUnitExponent: 2,
  entryStyle: "day_pass",
  options: [
    { id: "p1", name: "Walk-in", priceMinor: 500000, guestMin: 1, guestMax: 10 },
    { id: "wk", name: "Weekday", priceMinor: 250000, guestMin: 1, guestMax: 10, weekdays: [0, 1, 2, 3, 4] },
    { id: "kid", name: "Under 5", priceMinor: 0, guestMin: 1, guestMax: 10 },
  ],
  venue: { name: "Gameland Lagos", timezone: TZ },
};
const dayRow = (date: string, i: number, extra: Record<string, unknown> = {}) => ({
  local_date: date,
  window_id: `win-${i}`,
  status: "available",
  remaining: 40,
  starts_at: `${date}T17:00:00Z`,
  ends_at: `${date}T21:00:00Z`,
  ...extra,
});
const strip = (date = TODAY) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(TODAY, i)).map((d, i) => dayRow(d, i)).filter((r) => r.local_date >= date);
// Per option: the server's price per window (a busy evening for Walk-in: 6,000, not the list 5,000).
const optionDays = (input: { priceOptionId?: string }) => {
  const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = addDays(TODAY, i);
    if (input.priceOptionId === "p1") return dayRow(d, i, { price_minor: 600000 });
    if (input.priceOptionId === "wk") {
      return weekdayOf(d) >= 5 ? dayRow(d, i, { status: "wrong_weekday", reason: "wrong_weekday", price_minor: 250000 }) : dayRow(d, i, { price_minor: 250000 });
    }
    if (input.priceOptionId === "kid") return dayRow(d, i, { price_minor: 0 });
    return dayRow(d, i);
  });
  return { days: rows };
};
const QUOTE = {
  quoteId: QUOTE_ID,
  currencyCode: "NGN",
  subtotalMinor: 600000,
  feeMinor: 0,
  taxMinor: 45000,
  totalMinor: 645000,
  vat: { mode: "added", ratePct: 7.5, amountMinor: 45000 },
  window: { windowId: "win-0", localDate: TODAY, startsAt: `${TODAY}T17:00:00Z`, endsAt: `${TODAY}T21:00:00Z` },
  lines: [{ priceOptionId: "p1", name: "Walk-in", guests: 1, unitPriceMinor: 600000, baseMinor: 600000, taxMinor: 45000, totalMinor: 645000 }],
};
const held = (over = {}) => ({
  groupId: GROUP,
  version: 1,
  state: "instant_payment_pending",
  totalMinor: 645000,
  amountDueNowMinor: 645000,
  holdUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  ...over,
});

type Tree = ReturnType<typeof create>;
const pressables = (tree: Tree, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function");
const press = (tree: Tree, id: string) => {
  const found = pressables(tree, id);
  if (found.length === 0) throw new Error(`no pressable ${id}`);
  act(() => found[0].props.onPress());
};
const texts = (tree: Tree): string =>
  tree.root
    .findAll((n) => typeof n.type === "string" || n.type === "Text")
    .flatMap((n) => (Array.isArray(n.children) ? n.children.filter((c) => typeof c === "string") : []))
    .join(" | ");
const flush = async (ms = 20) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

const VENUE_OPEN = (kind: string, offerId: string | null, plans: unknown[] = []) => ({
  from: "venue",
  kind,
  brandSlug: "harmattan-qa-local",
  venueSlug: "gamelandqa",
  venueId: "venue-1",
  venueName: "Gameland Lagos",
  offerId,
  plans,
  currencyCode: "NGN",
  exponent: 2,
  timezone: TZ,
  lat: 6.43,
  lng: 3.42,
  category: "play",
});

function mount(open: Record<string, unknown>, resume: unknown = null, onClose: () => void = () => undefined): Tree {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: Tree;
  act(() => {
    tree = create(
      <QueryClientProvider client={client}>
        <VenueOfferCheckoutSheet open={open} resume={resume} onClose={onClose} />
      </QueryClientProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}
// One sheet at a time, as in the app: every tree a test mounted is gone before the next.
const mounted: Tree[] = [];
afterEach(() => {
  for (const t of mounted.splice(0)) {
    try {
      act(() => t.unmount());
    } catch {
      // already unmounted by the test
    }
  }
});
/**
 * The device's forced sign-out (W4-D1): the store goes to nobody and, in the
 * same turn, the venue route leaves (the tree unmounts) before the sheet can
 * render again. Only the synchronous store subscription sees it.
 */
const forcedSignOutUnmounting = (tree: Tree) => {
  act(() => {
    mockStore.user = null;
    mockStoreSubscribers.forEach((f) => f(mockStore));
    tree.unmount();
  });
};

beforeEach(() => {
  mockCalls.length = 0;
  mockBrowser.length = 0;
  mockNav.length = 0;
  mockSignOuts.length = 0;
  mockSecure.clear();
  mockStore.user = { id: "user-4490", email: "ada@example.com" };
  resumeStore.dropVenueCheckout();
  mockScript = {
    offer: async () => ENTRY_OFFER,
    availability: async (input: { priceOptionId?: string }) => (input.priceOptionId ? optionDays(input) : { days: strip() }),
    quote: async () => QUOTE,
    hold: async () => held(),
    pay: async () => ({ provider: "paystack", authorizationUrl: "https://checkout.paystack.com/fix1" }),
    confirmReturn: async () => ({ outcome: "confirmed", booking: held({ state: "confirmed" }) }),
  };
});

describe("#4490 W4 fix 2 — D1 a lost session mid-checkout", () => {
  const { VenuePurchaseError } = require("../../../services/venuePurchaseService");
  const HOME = "venue:harmattan-qa-local:gamelandqa:entry";
  const ROUTE = "/b/harmattan-qa-local/v/gamelandqa?tab=entry";
  const ME = { id: "user-4490", email: "ada@example.com" };

  async function chooseOne(tree: Tree): Promise<void> {
    await flush(60);
    press(tree, "venue-checkout-count-p1-plus");
    await flush();
  }
  async function toReview(tree: Tree): Promise<void> {
    await chooseOne(tree);
    press(tree, "venue-checkout-next");
    await flush(40);
  }
  const lostShown = (tree: Tree) => {
    const shown = texts(tree);
    expect(shown).toContain("Sign in again to book");
    expect(shown).toContain("Your session ended. Everything you picked is kept, and you'll come straight back here.");
    expect(shown).not.toContain("Something went wrong. Try again.");
    expect(pressables(tree, "venue-checkout-retry")).toHaveLength(0);
    expect(pressables(tree, "venue-checkout-sign-in").length).toBeGreaterThan(0);
  };
  const signBackIn = (user = ME) => {
    act(() => {
      mockStore.user = user;
      mockStoreSubscribers.forEach((f) => f(mockStore));
    });
  };

  test("D1-1 auth error on quote → Sign in again; forced sign-out unmounts; same account → step 1 with picks", async () => {
    mockScript.quote = async () => {
      throw new VenuePurchaseError("auth_invalid");
    };
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    lostShown(first);
    // Kept the moment the server said so (before any sign-out).
    expect(resumeStore.heldVenueCheckoutForTests()).toMatchObject({ accountId: ME.id, route: ROUTE, state: { phase: "signed_out", failedStep: "quote" } });
    forcedSignOutUnmounting(first);
    expect(resumeStore.heldVenueCheckoutForTests()?.accountId).toBe(ME.id);
    signBackIn();
    expect(resumeStore.venueCheckoutRouteAfterSignIn(ME.id)).toBe(ROUTE);
    const kept = resumeStore.takeVenueCheckout(ME.id, HOME);
    mockScript.quote = async () => QUOTE;
    const again = mount(kept.open, kept);
    await flush(80);
    const stepper = again.root.findAll((n) => n.props.testID === "venue-checkout-count-p1" && n.props.accessibilityValue)[0];
    expect(stepper.props.accessibilityValue.now).toBe(1);
    expect(texts(again)).not.toContain("Sign in again to book");
    press(again, "venue-checkout-next");
    await flush(40);
    expect(texts(again)).toContain(`Pay ${money(645000)}`);
  });

  test("D1-2 auth error on hold → kept; same account → Review, Pay holds with the same key", async () => {
    mockScript.hold = async () => {
      throw new VenuePurchaseError("auth_invalid");
    };
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    press(first, "venue-checkout-pay");
    await flush(40);
    lostShown(first);
    const firstKey = mockCalls.filter((c) => c.fn === "hold")[0].input.idempotencyKey;
    forcedSignOutUnmounting(first);
    signBackIn();
    const kept = resumeStore.takeVenueCheckout(ME.id, HOME);
    expect(kept.state.phase).toBe("signed_out");
    mockScript.hold = async () => held();
    const again = mount(kept.open, kept);
    await flush(60);
    expect(texts(again)).toContain(`Pay ${money(645000)}`);
    press(again, "venue-checkout-pay");
    await flush(80);
    const holds = mockCalls.filter((c) => c.fn === "hold");
    expect(holds).toHaveLength(2);
    expect(holds[1].input.idempotencyKey).toBe(firstKey);
    expect(mockBrowser).toEqual(["https://checkout.paystack.com/fix1"]);
  });

  test("D1-3 auth error on pay → kept with the booking; same account re-reads and pays; another account drops it", async () => {
    mockScript.pay = async () => {
      throw new VenuePurchaseError("auth_invalid");
    };
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    press(first, "venue-checkout-pay");
    await flush(80);
    lostShown(first);
    expect(mockBrowser).toEqual([]);
    expect(resumeStore.heldVenueCheckoutForTests()?.state.booking?.id).toBe(GROUP);
    forcedSignOutUnmounting(first);
    signBackIn();
    const kept = resumeStore.takeVenueCheckout(ME.id, HOME);
    mockScript.get = async () => held();
    mockScript.pay = async () => ({ provider: "paystack", authorizationUrl: "https://checkout.paystack.com/after" });
    const again = mount(kept.open, kept);
    await flush(80);
    expect(mockCalls.filter((c) => c.fn === "get").map((c) => c.input)).toEqual([GROUP]);
    press(again, "venue-checkout-pay");
    await flush(80);
    expect(mockBrowser).toEqual(["https://checkout.paystack.com/after"]);
    expect(mockCalls.filter((c) => c.fn === "hold")).toHaveLength(1);

    // The same loss, then someone else signs in: nothing comes back.
    mockScript.pay = async () => {
      throw new VenuePurchaseError("auth_invalid");
    };
    act(() => again.unmount());
    const other = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(other);
    press(other, "venue-checkout-pay");
    await flush(80);
    forcedSignOutUnmounting(other);
    signBackIn({ id: "someone-else", email: "b@example.com" });
    expect(resumeStore.venueCheckoutRouteAfterSignIn("someone-else")).toBeNull();
    expect(resumeStore.heldVenueCheckoutForTests()).toBeNull();
  });

  test("D1-4 Sign in again with the dead session still held: the app's sign-out for that account, then the start", async () => {
    let closed = 0;
    mockScript.quote = async () => {
      throw new VenuePurchaseError("auth_invalid");
    };
    const tree = mount(VENUE_OPEN("entry", "offer-entry"), null, () => void (closed += 1));
    await toReview(tree);
    expect(mockStore.user?.id).toBe(ME.id);
    press(tree, "venue-checkout-sign-in");
    await flush();
    expect(closed).toBe(1);
    expect(mockSignOuts).toEqual([{ reason: "venue-checkout-session-ended", id: ME.id }]);
    expect(mockNav).toEqual(["dismissAll"]);
    expect(resumeStore.heldVenueCheckoutForTests()?.accountId).toBe(ME.id);
    expect([...mockSecure.keys()]).toEqual([]);
  });

  test("D1-5 a forced sign-out with no checkout call (store only) unmounting the tree in the same turn: kept", async () => {
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    forcedSignOutUnmounting(first);
    const kept = resumeStore.heldVenueCheckoutForTests();
    expect(kept).toMatchObject({ accountId: ME.id, route: ROUTE, state: { phase: "review" } });
    expect(kept.review.ref.quoteId).toBe(QUOTE_ID);
    expect(mockSignOuts).toEqual([]);
  });

  test("D1-6 the hold ran out while signed out: the §6 line on step 1, picks kept", async () => {
    mockScript.pay = async () => {
      throw new VenuePurchaseError("auth_invalid");
    };
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    press(first, "venue-checkout-pay");
    await flush(80);
    forcedSignOutUnmounting(first);
    signBackIn();
    const kept = resumeStore.takeVenueCheckout(ME.id, HOME);
    mockScript.get = async () => held({ holdUntil: new Date(Date.now() - 60_000).toISOString() });
    const again = mount(kept.open, kept);
    await flush(80);
    expect(texts(again)).toContain("Your hold ran out. Pick a time again.");
    const stepper = again.root.findAll((n) => n.props.testID === "venue-checkout-count-p1" && n.props.accessibilityValue)[0];
    expect(stepper.props.accessibilityValue.now).toBe(1);
  });

  test("D1-7 an ordinary failure still reads the generic line with Try again", async () => {
    mockScript.quote = async () => {
      throw new VenuePurchaseError("offer_request_failed");
    };
    const tree = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(tree);
    expect(texts(tree)).toContain("Something went wrong. Try again.");
    expect(pressables(tree, "venue-checkout-retry").length).toBeGreaterThan(0);
    expect(resumeStore.heldVenueCheckoutForTests()).toBeNull();
  });

  test("D1-8 Close on the lost-session state drops what was kept", async () => {
    mockScript.quote = async () => {
      throw new VenuePurchaseError("auth_invalid");
    };
    const tree = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(tree);
    expect(resumeStore.heldVenueCheckoutForTests()).not.toBeNull();
    press(tree, "venue-checkout-close");
    expect(resumeStore.heldVenueCheckoutForTests()).toBeNull();
    expect(mockSignOuts).toEqual([]);
  });
});

describe("#4490 W4 fix 2 — R1 everything due now says why", () => {
  const LINE = "This day is close, so it's paid in full now.";
  const PAY_OPEN = (fullNowReason: string | null, payOptions: unknown[] = []) => ({
    from: "purchases",
    kind: "private_hire",
    booking: { id: GROUP, version: 2, state: "approved_payment_required", totalMinor: 308000000, amountDueNowMinor: 308000000, holdUntil: new Date(Date.now() + 3600_000).toISOString() },
    payOptions,
    fullNowReason,
    venueId: "venue-1",
    venueName: "Gameland Lagos",
    currencyCode: "NGN",
    exponent: 2,
    timezone: TZ,
  });

  test("R1-1 balance date passed: Due now ₦3,080,000 with the reason; no reason → no line", async () => {
    const tree = mount(PAY_OPEN("balance_due_passed"));
    await flush(30);
    const shown = texts(tree);
    expect(shown).toContain("Due now");
    expect(shown).toContain(money(308000000));
    expect(shown).toContain(LINE);
    act(() => tree.unmount());
    for (const reason of [null, "deposit_covers_total"]) {
      const other = mount(PAY_OPEN(reason));
      await flush(30);
      expect(texts(other)).not.toContain(LINE);
      act(() => other.unmount());
    }
  });

  test("R1-2 a package quote folded into one payment says why on Review; Half now does not", async () => {
    const pkgQuote = (payPlan: Record<string, unknown>) => ({
      ...QUOTE,
      subtotalMinor: 10000000,
      taxMinor: 750000,
      totalMinor: 10750000,
      lines: [{ priceOptionId: "sq", name: "Squad", guests: 10, unitPriceMinor: 1000000, baseMinor: 10000000, taxMinor: 750000, totalMinor: 10750000 }],
      payPlan,
    });
    const model = require("../venueCheckoutModel");
    const folded = model.parseVenueReviewQuote(pkgQuote({ payModes: ["full"], depositMinor: null, depositKind: "percent", depositValue: 5000, collapsed: "balance_due_passed" }));
    expect(folded.fullNowReason).toBe("balance_due_passed");
    expect(folded.ref.payModes).toEqual(["full"]);
    const half = model.parseVenueReviewQuote(pkgQuote({ payModes: ["deposit", "full"], depositMinor: 5375000, depositKind: "percent", depositValue: 5000, balanceDueAt: "2026-12-01T10:00:00Z", collapsed: null }));
    expect(half.fullNowReason).toBeNull();
    expect(half.ref.payModes).toEqual(["deposit", "full"]);
    // On the sheet: the entry Review with a folded plan shows the line; the normal one does not.
    mockScript.quote = async () => ({ ...QUOTE, payPlan: { payModes: ["full"], depositMinor: null, depositKind: "percent", depositValue: 5000, collapsed: "balance_due_passed" } });
    const tree = mount(VENUE_OPEN("entry", "offer-entry"));
    await flush(60);
    press(tree, "venue-checkout-count-p1-plus");
    await flush();
    press(tree, "venue-checkout-next");
    await flush(40);
    expect(texts(tree)).toContain(LINE);
    act(() => tree.unmount());
    mockScript.quote = async () => QUOTE;
    const plain = mount(VENUE_OPEN("entry", "offer-entry"));
    await flush(60);
    press(plain, "venue-checkout-count-p1-plus");
    await flush();
    press(plain, "venue-checkout-next");
    await flush(40);
    expect(texts(plain)).not.toContain(LINE);
  });
});
