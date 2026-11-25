/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * #4490 spec 06 W4 fix 1 — the checkout sheet, mounted (react-test-renderer,
 * #2774 lane), with stubs for the server, the in-app browser and the store.
 *
 *   N1-1 an entry option row shows the server's price for the CHOSEN window
 *        (its own availability row: a dearer busy time), never the list price
 *   N1-2 while those prices load (and before a day exists), a row shows no amount
 *   N1-3 a weekday-only price on a weekend: dimmed, the server's reason, cannot be added
 *   N1-4 a free price beside a paid one shows its own server price
 *   N1-5 a group package row shows the chosen start's server price; the quote stays the total
 *   N1-6 the row price equals the quote's line price for the same choice
 *   N2-1 a plan: Join shows Review with the server's amount due (VAT added)
 *        and "Pay ₦53,750"; the payment page opens only on Pay, for that amount
 *   N2-2 VAT included: Review says "Includes VAT", Pay is the plan price
 *   N4-1 the session ends mid-checkout: "Sign in again" keeps the checkout in
 *        memory for that account, closes and goes to sign-in; nothing on disk
 *   N4-2 signed in again as the same account: the sheet reopens at Review with
 *        the same quote and details; a held booking is re-read and Pay continues
 *   N4-3 the hold ran out meanwhile: the §6 line on the choose step, picks kept
 *   N4-4 another account signs in: the kept checkout is dropped, unseen
 *   N4-5 Close instead of signing in drops it
 *   N4-6 the venue pane takes it for whoever is signed in now, once
 *
 * FAILS-ON-REVERT: pass `new Map()` to entryOptionRows again (list prices) and
 * N1-1 / N1-6 fail; send join_ok straight to paying and N2-1 fails (the page
 * opens before any Review); remove the Sign in again button / the resume
 * props and N4-1..N4-3 fail.
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
const mockCalls: Array<{ fn: string; input: unknown }> = [];
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
// The first day in the strip that is a Saturday or a Sunday (0 = Monday).
const WEEKEND = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(TODAY, i)).find((d) => weekdayOf(d) >= 5);

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
const textOf = (tree: Tree, id: string): string | null => {
  const n = tree.root.findAll((x) => x.props.testID === id);
  if (n.length === 0) return null;
  return n[0].findAll((x) => typeof x.type === "string" || x.type === "Text").flatMap((x) => (Array.isArray(x.children) ? x.children.filter((c) => typeof c === "string") : [])).join("");
};
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
  return tree;
}
const setUser = (user: { id: string; email: string } | null) => {
  act(() => {
    mockStore.user = user;
    mockStoreListeners.forEach((f) => f());
  });
};

beforeEach(() => {
  mockCalls.length = 0;
  mockBrowser.length = 0;
  mockNav.length = 0;
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

describe("#4490 W4 fix 1 — N1 option rows carry the server's price for the chosen day", () => {
  test("N1-1/N1-4 the chosen window's server price (busy 6,000, not list 5,000); free shows its own price", async () => {
    const tree = mount(VENUE_OPEN("entry", "offer-entry"));
    await flush(60);
    expect(textOf(tree, "venue-checkout-option-price-p1")).toBe(`${money(600000)} each`);
    expect(texts(tree)).not.toContain(`${money(500000)} each`);
    expect(textOf(tree, "venue-checkout-option-price-kid")).toBe(`${money(0)} each`);
    // Every option was read for its own prices.
    const reads = mockCalls.filter((c) => c.fn === "availability").map((c) => c.input.priceOptionId ?? "all").sort();
    expect(reads).toEqual(["all", "kid", "p1", "wk"]);
  });

  test("N1-2 while the day's prices load, a row shows no amount (never the list price)", async () => {
    let release: () => void = () => undefined;
    mockScript.availability = (input: { priceOptionId?: string }) =>
      input.priceOptionId
        ? new Promise((resolve) => {
            const prev = release;
            release = () => {
              prev();
              resolve(optionDays(input));
            };
          })
        : Promise.resolve({ days: strip() });
    const tree = mount(VENUE_OPEN("entry", "offer-entry"));
    await flush(40);
    expect(textOf(tree, "venue-checkout-option-price-p1")).toBeNull();
    expect(texts(tree)).not.toContain(money(500000));
    expect(texts(tree)).toContain("Checking what's left…");
    release();
    await flush(40);
    expect(textOf(tree, "venue-checkout-option-price-p1")).toBe(`${money(600000)} each`);
  });

  test("N1-3 a weekday-only price on a weekend: dimmed with the server's reason, cannot be added", async () => {
    const tree = mount(VENUE_OPEN("entry", "offer-entry"));
    await flush(60);
    press(tree, `venue-checkout-day-${WEEKEND}`);
    await flush(20);
    expect(textOf(tree, "venue-checkout-option-price-wk")).toMatch(/^Weekday is for Mon to Fri\. On (Saturday|Sunday) it isn't available\.$/);
    const plus = pressables(tree, "venue-checkout-count-wk-plus")[0];
    expect(plus.props.disabled).toBe(true);
  });

  test("N1-6 the row price is the quote's line price for the same choice", async () => {
    const tree = mount(VENUE_OPEN("entry", "offer-entry"));
    await flush(60);
    press(tree, "venue-checkout-count-p1-plus");
    await flush();
    const row = textOf(tree, "venue-checkout-option-price-p1");
    press(tree, "venue-checkout-next");
    await flush(40);
    expect(mockCalls.find((c) => c.fn === "quote")?.input.body.windowId).toBe("win-0");
    expect(row).toBe(`${money(QUOTE.lines[0].unitPriceMinor)} each`);
    expect(texts(tree)).toContain(`Pay ${money(645000)}`);
  });

  test("N1-5 a group package row is the chosen start's server price, never the list price", async () => {
    mockScript.offer = async () => ({
      id: "offer-group",
      kind: "group_package",
      name: "Squad",
      currencyCode: "NGN",
      minorUnitExponent: 2,
      options: [{ id: "g1", name: "Squad", priceMinor: 1000000, guestMin: 10, guestMax: 20, unit: "guest" }],
      inclusions: [],
      extras: [{ id: "x1", name: "Cake", priceMinor: 1500000, per: "booking" }],
      payModes: ["full"],
      deposit: { kind: "none" },
      venue: { name: "Gameland Lagos", timezone: TZ },
    });
    mockScript.availability = async (input: { priceOptionId?: string }) =>
      input.priceOptionId === "g1"
        ? { days: strip().map((r) => ({ ...r, price_minor: 1200000 })) }
        : { days: strip() };
    const tree = mount(VENUE_OPEN("group_package", "offer-group"));
    await flush(80);
    const line = texts(tree);
    expect(line).toContain(`${money(1200000)} a guest · 10 to 20 guests`);
    expect(line).not.toContain(money(1000000));
    expect(line).toContain(`${money(1500000)} a booking`);
  });
});

describe("#4490 W4 fix 1 — N2 a plan's amount due is shown before the payment page", () => {
  const PLAN = { id: "plan-1", name: "P6 Flex desk", summary: null, priceMinor: 5000000, period: "month", joinMode: "instant", full: false };
  // The service's own answer shape: the id, the status and the raw member read (tokens stripped).
  const joined = (due: Record<string, unknown>) => async () => ({
    subscriptionId: "00000000-4490-4000-8000-00000000c001",
    status: "pending",
    raw: {
      subscriptionId: "00000000-4490-4000-8000-00000000c001",
      status: "pending",
      paymentDue: { periodId: "per-1", currencyCode: "NGN", unit: "minor", ...due },
    },
  });

  test("N2-1 VAT added: Review shows 50,000 + VAT 3,750 = 53,750 and Pay ₦53,750; the page opens only on Pay", async () => {
    mockScript.membershipJoin = joined({ amountMinor: 5375000, baseMinor: 5000000, taxMinor: 375000, feeMinor: 0, totalMinor: 5375000, vatMode: "added", vatRatePct: 7.5 });
    mockScript.memberPay = async () => ({ provider: "paystack", authorizationUrl: "https://checkout.paystack.com/plan" });
    mockScript.memberConfirm = async () => ({ outcome: "confirmed", member: { status: "active" } });
    const tree = mount(VENUE_OPEN("plan", "plan-1", [PLAN]));
    await flush(20);
    press(tree, "venue-checkout-next");
    await flush(60);
    const shown = texts(tree);
    expect(shown).toContain("Review");
    expect(shown).toContain("1 × P6 Flex desk");
    expect(shown).toContain("VAT 7.5%");
    expect(shown).toContain(money(375000));
    expect(shown).toContain(`Pay ${money(5375000)}`);
    expect(mockCalls.some((c) => c.fn === "memberPay")).toBe(false);
    expect(mockBrowser).toEqual([]);
    press(tree, "venue-checkout-pay");
    await flush(80);
    expect(mockCalls.filter((c) => c.fn === "memberPay").length).toBe(1);
    expect(mockBrowser).toEqual(["https://checkout.paystack.com/plan"]);
  });

  test("N2-2 VAT included: Includes VAT, Pay is the plan price", async () => {
    mockScript.membershipJoin = joined({ amountMinor: 3000000, baseMinor: 3000000, taxMinor: 209302, feeMinor: 0, totalMinor: 3000000, vatMode: "included", vatRatePct: 7.5 });
    const tree = mount(VENUE_OPEN("plan", "plan-1", [{ ...PLAN, priceMinor: 3000000 }]));
    await flush(20);
    press(tree, "venue-checkout-next");
    await flush(60);
    const shown = texts(tree);
    expect(shown).toContain("Includes VAT 7.5%");
    expect(shown).toContain(`Pay ${money(3000000)}`);
  });
});

describe("#4490 W4 fix 1 — N4 a session that ends mid-checkout comes back to the same step", () => {
  async function toReview(tree: Tree): Promise<void> {
    await flush(60);
    press(tree, "venue-checkout-count-p1-plus");
    await flush();
    press(tree, "venue-checkout-next");
    await flush(40);
  }

  test("N4-1 Sign in again keeps the checkout in memory for that account and goes to sign-in", async () => {
    let closed = 0;
    const tree = mount(VENUE_OPEN("entry", "offer-entry"), null, () => void (closed += 1));
    await toReview(tree);
    setUser(null);
    await flush();
    const shown = texts(tree);
    expect(shown).toContain("Sign in again to book");
    expect(shown).toContain("Your session ended. Everything you picked is kept, and you'll come straight back here.");
    press(tree, "venue-checkout-sign-in");
    expect(closed).toBe(1);
    expect(mockNav).toEqual(["dismissAll"]);
    const kept = resumeStore.heldVenueCheckoutForTests();
    expect(kept?.accountId).toBe("user-4490");
    expect(kept?.route).toBe("/b/harmattan-qa-local/v/gamelandqa?tab=entry");
    expect(kept?.state.phase).toBe("review");
    expect(kept?.choice).toMatchObject({ kind: "entry", windowId: "win-0", lines: [{ priceOptionId: "p1", guests: 1 }] });
    // Never on the device: nothing was written to secure storage by keeping it.
    expect([...mockSecure.keys()]).toEqual([]);
  });

  test("N4-2 same account again: reopens at Review with the same quote; a held booking is re-read and Pay goes on", async () => {
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    press(first, "venue-checkout-pay");
    // The session ends while the hold exists (before the page opens).
    mockScript.pay = () => new Promise(() => undefined);
    await flush(30);
    setUser(null);
    await flush();
    press(first, "venue-checkout-sign-in");
    act(() => first.unmount());
    setUser({ id: "user-4490", email: "ada@example.com" });
    expect(resumeStore.venueCheckoutRouteAfterSignIn("user-4490")).toBe("/b/harmattan-qa-local/v/gamelandqa?tab=entry");
    const kept = resumeStore.takeVenueCheckout("user-4490", "venue:harmattan-qa-local:gamelandqa:entry");
    expect(kept).not.toBeNull();
    mockScript.get = async () => held();
    mockScript.pay = async () => ({ provider: "paystack", authorizationUrl: "https://checkout.paystack.com/again" });
    const again = mount(kept.open, kept);
    await flush(60);
    expect(mockCalls.filter((c) => c.fn === "get").length).toBe(1);
    const shown = texts(again);
    expect(shown).toContain("Review");
    expect(shown).toContain(`Pay ${money(645000)}`);
    expect(mockCalls.filter((c) => c.fn === "hold").length).toBe(1);
    press(again, "venue-checkout-pay");
    await flush(80);
    expect(mockBrowser).toEqual(["https://checkout.paystack.com/again"]);
    expect(mockCalls.filter((c) => c.fn === "hold").length).toBe(1);
  });

  test("N4-3 the hold ran out while signed out: the §6 line on the choose step with the picks kept", async () => {
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    mockScript.pay = () => new Promise(() => undefined);
    press(first, "venue-checkout-pay");
    await flush(30);
    setUser(null);
    await flush();
    press(first, "venue-checkout-sign-in");
    act(() => first.unmount());
    setUser({ id: "user-4490", email: "ada@example.com" });
    const kept = resumeStore.takeVenueCheckout("user-4490", "venue:harmattan-qa-local:gamelandqa:entry");
    mockScript.get = async () => held({ holdUntil: new Date(Date.now() - 60_000).toISOString() });
    const again = mount(kept.open, kept);
    await flush(80);
    const shown = texts(again);
    expect(shown).toContain("Your hold ran out. Pick a time again.");
    const stepper = again.root.findAll((n) => n.props.testID === "venue-checkout-count-p1" && n.props.accessibilityValue)[0];
    expect(stepper.props.accessibilityValue.now).toBe(1);
  });

  test("N4-4 another account signs in: the kept checkout is dropped, unseen", async () => {
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    setUser(null);
    await flush();
    press(first, "venue-checkout-sign-in");
    expect(resumeStore.venueCheckoutRouteAfterSignIn("someone-else")).toBeNull();
    expect(resumeStore.heldVenueCheckoutForTests()).toBeNull();
    expect(resumeStore.takeVenueCheckout("user-4490", "venue:harmattan-qa-local:gamelandqa:entry")).toBeNull();
  });

  test("N4-6 the venue pane's take is for whoever is signed in now, and only once", async () => {
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    setUser(null);
    await flush();
    press(first, "venue-checkout-sign-in");
    setUser({ id: "user-4490", email: "ada@example.com" });
    expect(resumeStore.takeVenueCheckoutForSignedIn("venue:harmattan-qa-local:gamelandqa:plan")).toBeNull();
    expect(resumeStore.takeVenueCheckoutForSignedIn("venue:harmattan-qa-local:gamelandqa:entry")?.accountId).toBe("user-4490");
    expect(resumeStore.takeVenueCheckoutForSignedIn("venue:harmattan-qa-local:gamelandqa:entry")).toBeNull();
  });

  test("N4-5 Close instead of signing in drops it", async () => {
    const first = mount(VENUE_OPEN("entry", "offer-entry"));
    await toReview(first);
    setUser(null);
    await flush();
    press(first, "venue-checkout-close");
    expect(resumeStore.heldVenueCheckoutForTests()).toBeNull();
  });
});
