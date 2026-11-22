/* eslint-disable @typescript-eslint/no-require-imports */
// @ts-nocheck
/**
 * #4490 Explorer W4 — the checkout sheet, mounted (react-test-renderer, #2774
 * lane) with stubs for the server, the in-app browser, the card sheet and the
 * device store. The real reducer and the real payment leg run.
 *
 *   E-1  Entry end to end: day + tickets → Review shows ONLY the server's
 *        quote (I-NATIVE-OFFER-CHECKOUT-NO-CLIENT-PRICE) → Pay holds with the
 *        profile's details → pay → the payment page → confirmed → "You're
 *        booked" with the pass and "See in Purchases"; one
 *        venue_checkout_finished {outcome: confirmed, channel: app}, no amount
 *   E-2  a declined payment returns to Review with the §6 line and Try again
 *   E-3  rule 7: a free hold confirms with no payment page
 *   E-4  offers_not_enabled → "Bookings are paused here right now. Try again later."
 *   E-5  N139: a reserved-domain email is refused in words before any hold
 *   H-1  Private hire: "Send request" → quote + hold, no payment → the §6 line
 *   B-1  while the payment page is open the sheet cannot be dismissed
 *
 * FAILS-ON-REVERT: render the total from the lines (not the quote) and E-1's
 * "Pay ₦12,345.67" fails; send a free hold to `pay` and E-3 fails; map
 * offers_not_enabled to the generic line and E-4 fails.
 */
import React from "react";

const { act, create } = require("react-test-renderer") as typeof import("react-test-renderer");
const { QueryClient, QueryClientProvider } = require("@tanstack/react-query") as typeof import("@tanstack/react-query");

const mockSheetProps: Array<Record<string, unknown>> = [];
jest.mock("../../ui/BaseBottomSheet", () => {
  const R = require("react") as typeof import("react");
  return {
    BaseBottomSheet: (props: Record<string, unknown>) => {
      mockSheetProps.push(props);
      return props.visible ? R.createElement(R.Fragment, null, props.children as never, props.stickyFooter as never) : null;
    },
    BottomSheetTextInput: (props: Record<string, unknown>) => R.createElement("input", props),
  };
});
jest.mock("../VenueCheckoutWhenLine", () => ({ VenueCheckoutWhenLine: () => null }));
jest.mock("react-native-qrcode-svg", () => () => null);
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockPush: string[] = [];
jest.mock("expo-router", () => ({ useRouter: () => ({ push: (p: string) => mockPush.push(p) }) }));
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
const mockCaptured: Array<{ event: string; props: Record<string, unknown> }> = [];
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: (event: string, props: Record<string, unknown>) => mockCaptured.push({ event, props }) },
}));
jest.mock("../../../store/appStore", () => {
  const state = { user: { id: "user-4490", email: "ada@example.com" }, profile: { id: "user-4490", display_name: "Ada Test", phone: null, country: "NG" } };
  const useAppStore = (sel: (s: typeof state) => unknown) => sel(state);
  useAppStore.getState = () => state;
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
    venueOfferCheckoutService: {
      offer: call("offer"),
      availability: call("availability"),
      hireOptions: call("hireOptions"),
      hourDay: call("hourDay"),
      quote: call("quote"),
      hold: call("hold"),
      pay: call("pay"),
      confirmReturn: call("confirmReturn"),
      get: call("get"),
      membershipJoin: call("membershipJoin"),
      memberPay: call("memberPay"),
      memberConfirm: call("memberConfirm"),
      membershipGet: call("membershipGet"),
    },
  };
});

const { VenueOfferCheckoutSheet } = require("../VenueOfferCheckoutSheet") as typeof import("../VenueOfferCheckoutSheet");
const { VenuePurchaseError } = require("../../../services/venuePurchaseService");
const { venueToday, addDays } = require("@mingla/brand-rendering/venueOffers/entryModel");

const TZ = "Africa/Lagos";
const TODAY = venueToday(new Date(), TZ);
const GROUP = "00000000-4490-4000-8000-0000000004a9";
const QUOTE_ID = "00000000-4490-4000-8000-0000000004aa";

const ENTRY_OFFER = {
  id: "offer-entry",
  name: "Arcade day pass",
  currencyCode: "NGN",
  minorUnitExponent: 2,
  entryStyle: "day_pass",
  options: [{ id: "p1", name: "Day pass", priceMinor: 400000, guestMin: 1, guestMax: 10 }],
  venue: { name: "Gameland Lagos", timezone: TZ },
};
const days = (status = "available") => ({
  days: [0, 1, 2].map((i) => ({
    local_date: addDays(TODAY, i),
    window_id: `win-${i}`,
    status,
    remaining: 40,
    starts_at: `${addDays(TODAY, i)}T09:00:00Z`,
    ends_at: `${addDays(TODAY, i)}T21:00:00Z`,
  })),
});
const QUOTE = {
  quoteId: QUOTE_ID,
  currencyCode: "NGN",
  subtotalMinor: 1200000,
  feeMinor: 34567,
  taxMinor: 0,
  totalMinor: 1234567,
  vat: { mode: "none" },
  window: { windowId: "win-0", localDate: TODAY, startsAt: `${TODAY}T09:00:00Z`, endsAt: `${TODAY}T21:00:00Z` },
  lines: [{ priceOptionId: "p1", name: "Day pass", guests: 1, unitPriceMinor: 400000, baseMinor: 400000, taxMinor: 0, totalMinor: 400000 }],
};
const held = (over = {}) => ({
  groupId: GROUP,
  version: 1,
  state: "instant_payment_pending",
  totalMinor: 1234567,
  amountDueNowMinor: 1234567,
  holdUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  ...over,
});

type Tree = ReturnType<typeof create>;
const all = (tree: Tree, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function");
const press = (tree: Tree, id: string) => {
  const found = all(tree, id);
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

function mountEntry(kind = "entry", offerId = "offer-entry"): Tree {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: Tree;
  act(() => {
    tree = create(
      <QueryClientProvider client={client}>
        <VenueOfferCheckoutSheet
          open={{
            from: "venue",
            kind,
            brandSlug: "harmattan-qa-local",
            venueSlug: "gamelandqa",
            venueId: "venue-1",
            venueName: "Gameland Lagos",
            offerId,
            plans: [],
            currencyCode: "NGN",
            exponent: 2,
            timezone: TZ,
            lat: 6.43,
            lng: 3.42,
            category: "play",
          }}
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    );
  });
  return tree;
}

async function toReview(tree: Tree): Promise<void> {
  await flush(30);
  press(tree, "venue-checkout-count-p1-plus");
  await flush();
  press(tree, "venue-checkout-next");
  await flush(30);
}

beforeEach(() => {
  mockCalls.length = 0;
  mockBrowser.length = 0;
  mockCaptured.length = 0;
  mockPush.length = 0;
  mockSecure.clear();
  mockSheetProps.length = 0;
  mockScript = {
    offer: async () => ENTRY_OFFER,
    availability: async () => days(),
    quote: async () => QUOTE,
    hold: async () => held(),
    pay: async () => ({ provider: "paystack", authorizationUrl: "https://checkout.paystack.test/w4" }),
    confirmReturn: async () => ({ outcome: "confirmed", booking: held({ state: "confirmed" }) }),
  };
});

describe("#4490 W4 checkout sheet", () => {
  test("E-1 Entry end to end; Review shows only the server's quote; one finished event, no amount", async () => {
    const tree = mountEntry();
    await toReview(tree);
    const quote = mockCalls.find((c) => c.fn === "quote");
    expect(quote?.input.body).toEqual({ offeringId: "offer-entry", windowId: "win-0", lines: [{ priceOptionId: "p1", guests: 1 }] });
    // I-NATIVE-OFFER-CHECKOUT-NO-CLIENT-PRICE: the total is the quote's (1234567), not the lines' sum.
    const shown = texts(tree);
    expect(shown).toContain("Pay ₦12,345.67");
    expect(shown).toContain("₦12,345.67");
    expect(shown).not.toContain("₦4,345.67");
    press(tree, "venue-checkout-pay");
    await flush(60);
    const hold = mockCalls.find((c) => c.fn === "hold");
    expect(hold?.input.guest).toEqual({ name: "Ada Test", email: "ada@example.com" });
    expect(hold?.input.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    const pay = mockCalls.find((c) => c.fn === "pay");
    expect(pay?.input).toMatchObject({ groupId: GROUP, expectedVersion: 1, payMode: null });
    expect(mockBrowser).toEqual(["https://checkout.paystack.test/w4"]);
    await flush(60);
    expect(texts(tree)).toContain("You're booked");
    expect(texts(tree)).toContain("See in Purchases");
    const finished = mockCaptured.filter((c) => c.event === "venue_checkout_finished");
    expect(finished).toEqual([{ event: "venue_checkout_finished", props: { venue_id: "venue-1", offer_kind: "entry", outcome: "confirmed", channel: "app" } }]);
    // The pointer was written and cleared on the confirmed answer.
    expect(mockSecure.has("mingla_venue_checkout_recovery_v1")).toBe(false);
    press(tree, "venue-checkout-see-purchases");
    expect(mockPush).toEqual(["/purchases"]);
  });

  test("E-2 a declined payment returns to Review with the §6 line and Try again (a new pay key)", async () => {
    mockScript.confirmReturn = async () => ({ outcome: "failed", booking: held() });
    const tree = mountEntry();
    await toReview(tree);
    press(tree, "venue-checkout-pay");
    await flush(120);
    expect(texts(tree)).toContain("Payment didn't go through. You haven't been charged.");
    expect(texts(tree)).toContain("Try again");
    const firstKey = mockCalls.filter((c) => c.fn === "pay")[0]?.input.idempotencyKey;
    press(tree, "venue-checkout-pay");
    await flush(120);
    const pays = mockCalls.filter((c) => c.fn === "pay");
    expect(pays.length).toBe(2);
    expect(pays[1].input.idempotencyKey).not.toBe(firstKey);
    expect(mockCalls.filter((c) => c.fn === "hold").length).toBe(1);
  });

  test("E-3 rule 7: a free hold confirms with no payment page", async () => {
    mockScript.quote = async () => ({ ...QUOTE, totalMinor: 0, feeMinor: 0 });
    mockScript.hold = async () => held({ state: "confirmed", totalMinor: 0, amountDueNowMinor: 0 });
    const tree = mountEntry();
    await toReview(tree);
    expect(texts(tree)).toContain("Get my pass");
    press(tree, "venue-checkout-pay");
    await flush(60);
    expect(texts(tree)).toContain("You're booked");
    expect(mockCalls.some((c) => c.fn === "pay")).toBe(false);
    expect(mockBrowser).toEqual([]);
  });

  test("E-4 the writes switch off (offers_not_enabled) reads the §6 paused line, never a code", async () => {
    mockScript.hold = async () => {
      throw new VenuePurchaseError("offers_not_enabled");
    };
    const tree = mountEntry();
    await toReview(tree);
    press(tree, "venue-checkout-pay");
    await flush(40);
    const shown = texts(tree);
    expect(shown).toContain("Bookings are paused here right now. Try again later.");
    expect(shown).not.toContain("offers_not_enabled");
  });

  test("E-5 N139: a reserved-domain email is refused in words before any hold", async () => {
    const tree = mountEntry();
    await toReview(tree);
    const email = tree.root.findAll((n) => n.props.testID === "venue-checkout-guest-email" && typeof n.props.onChangeText === "function")[0];
    act(() => email.props.onChangeText("ada@mail.example.test"));
    press(tree, "venue-checkout-pay");
    await flush();
    expect(texts(tree)).toContain(
      "Use an email address you can get receipts at. Addresses ending in .test, .invalid, .example or .localhost can't be used.",
    );
    expect(mockCalls.some((c) => c.fn === "hold")).toBe(false);
  });

  test("H-1 Private hire: Send request → quote + hold, no payment → the §6 request line", async () => {
    mockScript.offer = async () => ({
      id: "offer-hire",
      kind: "private_hire",
      name: "Hire the venue",
      currencyCode: "NGN",
      minorUnitExponent: 2,
      options: [],
      hire: {
        mode: "request",
        rows: [{ optionId: "row1", name: "Whole venue", unit: "booking", placeName: "Whole venue", guestMin: 20, guestMax: 250, priceMinor: 150000000 }],
        sessions: [],
      },
      venue: { name: "Gameland Lagos", timezone: TZ },
    });
    mockScript.availability = async () => days();
    mockScript.hireOptions = async () => ({
      options: [{ price_option_id: "row1", name: "Whole venue", place_name: "Whole venue", guest_min: 20, guest_max: 250, unit: "booking", price_minor: 150000000, status: "available" }],
    });
    mockScript.quote = async () => ({ ...QUOTE, mode: "request", hire: { guests: 20, payPlan: { payModes: ["full"] } } });
    mockScript.hold = async () => held({ state: "request_pending" });
    const tree = mountEntry("private_hire", "offer-hire");
    await flush(60);
    await flush(80);
    press(tree, "venue-checkout-place-row1");
    await flush(30);
    press(tree, "venue-checkout-next");
    await flush(80);
    expect(texts(tree)).toContain("Request sent. Gameland Lagos will reply soon. Nothing to pay until they do.");
    expect(mockCalls.some((c) => c.fn === "pay")).toBe(false);
    expect(mockBrowser).toEqual([]);
    const finished = mockCaptured.filter((c) => c.event === "venue_checkout_finished");
    expect(finished[0]?.props.outcome).toBe("requested");
  });

  test("B-1 while the payment page is open the sheet cannot be dismissed", async () => {
    let release: () => void = () => undefined;
    mockScript.confirmReturn = () =>
      new Promise((resolve) => {
        release = () => resolve({ outcome: "confirmed", booking: held({ state: "confirmed" }) });
      });
    const tree = mountEntry();
    await toReview(tree);
    press(tree, "venue-checkout-pay");
    await flush(60);
    const last = mockSheetProps[mockSheetProps.length - 1];
    expect(last.backdropPressBehavior).toBe("none");
    expect(last.enablePanDownToClose).toBe(false);
    release();
    await flush(40);
    const after = mockSheetProps[mockSheetProps.length - 1];
    expect(after.backdropPressBehavior).toBe("close");
  });
});
