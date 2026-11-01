/** #2230 implementor happy-path: in-sheet contract + actual checkout body. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mockInvoke = jest.fn();
const mockOpenBrowserAsync = jest.fn();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowserAsync(...args),
  WebBrowserResultType: { LOCKED: "locked", DISMISS: "dismiss" },
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
} from "../../../payments/nativeCheckoutFlow";
import {
  byDateForDates,
  byDateTotal,
  cartLineQuantities,
  evenByDate,
  uniformQuantity,
  withDateQuantity,
} from "../ticketCartByDate";

const APP_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(APP_ROOT, rel), "utf8");
const SHEET = read("src/components/expandedCard/TicketCartSheet.tsx");
const CHOOSER = read("src/components/expandedCard/EventDayChooser.tsx");
const QUANTITY_ROW = read("../packages/offering-rendering/QuantityRow.tsx");

let sequence = 0;
const input = (extra: Record<string, unknown> = {}) => ({
  eventId: `event-2230-${++sequence}`,
  lines: [{ ticketTypeId: "ga", quantity: 1 }],
  buyer: { name: "Ada", email: "ada@example.com", phone: "+2348000000000" },
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearAllHeldHandoffs();
  mockOpenBrowserAsync.mockResolvedValue({ type: "locked" });
});

describe("#2230 actual native checkout contract", () => {
  it("hands the chronological deduplicated day set to ticket-checkout-create", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "order-1" },
      error: null,
    });
    await useNativeCheckoutFlow()(
      input({
        eventDateIds: ["day-1", "day-2", "day-2"],
      }),
    );
    const create = mockInvoke.mock.calls.find(
      (call) => call[0] === "ticket-checkout-create",
    );
    expect(create?.[1].body.eventDateIds).toEqual(["day-1", "day-2"]);
    expect(create?.[1].body.lines).toEqual([
      { ticketTypeId: "ga", quantity: 1 },
    ]);
  });

  it("keeps the single-date request keyset exact and preserves singular eventDateId", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { kind: "free_completed", orderId: "order-2" },
      error: null,
    });
    await useNativeCheckoutFlow()(input({ eventDateId: "experience-day" }));
    const body = mockInvoke.mock.calls[0][1].body;
    expect(body.eventDateId).toBe("experience-day");
    expect(Object.prototype.hasOwnProperty.call(body, "eventDateIds")).toBe(
      false,
    );
  });

  it("includes the non-empty day set in the held-cart fingerprint", async () => {
    const eventId = `event-fingerprint-${++sequence}`;
    const base = {
      eventId,
      lines: [{ ticketTypeId: "ga", quantity: 1 }],
      buyer: { name: "Ada", email: "ada@example.com", phone: "+2348000000000" },
    };
    const paystack = (suffix: string) => ({
      data: {
        kind: "requires_paystack_redirect",
        checkoutSessionId: `session-${suffix}`,
        buyerStatusToken: `token-${suffix}`,
        authorizationUrl: `https://checkout.example/${suffix}`,
        returnUrl: "https://host.usemingla.com/return",
        reference: suffix,
        totalCents: 100,
        currency: "NGN",
      },
      error: null,
    });
    mockInvoke
      .mockResolvedValueOnce(paystack("a"))
      .mockResolvedValueOnce(paystack("b"));
    await useNativeCheckoutFlow()({ ...base, eventDateIds: ["day-1"] });
    await useNativeCheckoutFlow()({ ...base, eventDateIds: ["day-2"] });
    expect(
      mockInvoke.mock.calls.filter(
        (call) => call[0] === "ticket-checkout-create",
      ),
    ).toHaveLength(2);
  });
});

describe("#2230 ticket sheet placement, pricing, validation, and accessibility", () => {
  it("mounts the interactive chooser before SELECT YOUR TICKETS and never a read-only Your days row", () => {
    const chooserAt = SHEET.indexOf("<EventDayChooser");
    const tiersAt = SHEET.indexOf("SELECT YOUR TICKETS", chooserAt);
    expect(chooserAt).toBeGreaterThan(-1);
    expect(tiersAt).toBeGreaterThan(chooserAt);
    expect(SHEET).not.toContain(">Your days<");
  });

  it("quotes the selected days on the server and submits the accepted quote without changing line quantities", () => {
    expect(SHEET).toMatch(
      /const quoteEventDateIds = useMemo\([\s\S]{0,500}\.filter\(\(day\)[\s\S]{0,220}selectedEventDateIds\.includes\(day\.id\)[\s\S]{0,180}\.map\(\(day\) => day\.id\)/,
    );
    expect(SHEET).toMatch(
      /const quoteInput = useMemo\([\s\S]{0,500}lines:\s*quoteLines,[\s\S]{0,300}eventDateIds:\s*quoteEventDateIds/,
    );
    expect(SHEET).toMatch(
      /const checkoutPayloadFor[\s\S]{0,900}lines:\s*quoteLines,[\s\S]{0,300}totalCents:\s*acceptedQuote\.buyerTotalCents/,
    );
    expect(SHEET).toContain("quoteDigest: acceptedQuote.quoteDigest");
    expect(SHEET).toContain("quoteListDigest: acceptedQuote.quoteListDigest");
    expect(SHEET).toMatch(
      /quoteEventDateIds\.length > 0[\s\S]{0,100}eventDateIds:\s*quoteEventDateIds/,
    );
    expect(SHEET).not.toContain("allInCents *= dayMultiplier");
  });

  it("keeps the missing-day CTA actionable for validation while checkout remains blocked", () => {
    expect(SHEET).toContain('"Pick at least one day above"');
    expect(SHEET).toMatch(
      /if \(selectedIds\.length === 0\) \{[\s\S]{0,220}setHighlightUnchosen\(true\)[\s\S]{0,220}return;/,
    );
    expect(SHEET).toContain("disabled={ctaPressDisabled}");
    expect(SHEET).toContain("disabled: ctaPressDisabled");
  });

  it("provides checkbox semantics, working recovery, selection haptics, and polite total updates", () => {
    expect(CHOOSER).toContain('accessibilityLabel="Days you\'re attending"');
    expect(CHOOSER).toContain('accessibilityRole="checkbox"');
    expect(CHOOSER).not.toContain('accessibilityRole="radiogroup"');
    expect(CHOOSER).toContain('accessibilityRole="alert"');
    expect(CHOOSER).toContain("disabled={retryDisabled}");
    expect(SHEET).toContain("void Haptics.selectionAsync()");
    expect(SHEET).toContain('accessibilityLiveRegion="polite"');
    expect(CHOOSER).toContain('busy: status === "loading"');
    expect(CHOOSER).toContain('accessibilityRole="progressbar"');
    expect(CHOOSER).toContain('accessibilityLiveRegion="polite"');
  });

  it("pins approved typography and press feedback without hiding known offline days", () => {
    expect(CHOOSER).toMatch(
      /heading:\s*\{[^}]*fontSize:\s*15,[^}]*lineHeight:\s*20,/,
    );
    expect(CHOOSER).toMatch(
      /count:\s*\{[^}]*fontSize:\s*12,[^}]*lineHeight:\s*16,/,
    );
    expect(CHOOSER).toMatch(
      /alert:\s*\{[^}]*fontSize:\s*12,[^}]*lineHeight:\s*16,/,
    );
    expect(CHOOSER).toMatch(
      /rowLabel:\s*\{[^}]*fontSize:\s*14,[^}]*lineHeight:\s*20,/,
    );
    expect(CHOOSER).toContain("pressed: { opacity: 0.92 }");
    expect(CHOOSER).toContain(
      'const unavailable = status === "loading" || status === "error";',
    );
    expect(SHEET).toMatch(
      /multiDaySelection\.status !== "ready"\s*&&\s*multiDaySelection\.status !== "offline"/,
    );
    expect(SHEET).toMatch(
      /const dayTruthUnavailable =\s*multiDaySelection !== null && multiDaySelection\.status !== "ready";/,
    );
  });

  it("lets only the multi-day Consumer sheet wrap labels while preserving null-path caps", () => {
    const headerStart = SHEET.indexOf("const header = (");
    const headerEnd = SHEET.indexOf("const ticketRows", headerStart);
    expect(headerStart).toBeGreaterThan(-1);
    expect(SHEET.slice(headerStart, headerEnd)).toContain("Get tickets");
    expect(SHEET.slice(headerStart, headerEnd)).toContain(
      "numberOfLines={multiDaySelection === null ? 1 : undefined}",
    );
    expect(SHEET).toContain(
      "allowUnboundedNameWrap={multiDaySelection !== null}",
    );

    expect(QUANTITY_ROW).toContain("allowUnboundedNameWrap?: boolean;");
    expect(QUANTITY_ROW).toContain("allowUnboundedNameWrap = false");
    expect(QUANTITY_ROW).toContain(
      "numberOfLines={allowUnboundedNameWrap ? undefined : 2}",
    );
  });

  it("pins all approved recovery and decision copy", () => {
    for (const copy of [
      "Pick your days",
      "Choose at least one day you're attending to continue.",
      "We couldn’t load the event days.",
      "You’re offline. Reconnect to continue.",
      "Those dates just changed. Refresh and choose again.",
      "Try again",
      "Refresh days",
    ])
      expect(CHOOSER).toContain(copy);
    expect(SHEET).toContain('"Add tickets above"');
  });
});

describe("#3281 Explorer per-date cart", () => {
  test("a uniform cart sends no map", () => {
    expect(cartLineQuantities({ quantity: 2 }, { a: 5 }, null)).toEqual({
      quantity: 2,
    });
  });

  test("an uneven cart sends its map and derives the total", () => {
    expect(
      cartLineQuantities({ quantity: 9 }, { a: 2, b: 1 }, ["a", "b", "c"]),
    ).toEqual({ quantity: 3, byDate: { a: 2, b: 1 } });
  });

  test("a deselected date leaves the map and the total", () => {
    expect(byDateForDates({ a: 2, b: 1 }, ["a"])).toEqual({ a: 2 });
    expect(cartLineQuantities({ quantity: 3 }, { a: 2, b: 1 }, ["a", "c"]))
      .toEqual({ quantity: 2, byDate: { a: 2 } });
  });

  test("a date with no tickets is never sent", () => {
    expect(byDateForDates({ a: 0, b: 1 }, ["a", "b"])).toEqual({ b: 1 });
    expect(withDateQuantity({ a: 1, b: 1 }, "a", 0)).toEqual({ b: 1 });
    expect(withDateQuantity(undefined, "a", 2)).toEqual({ a: 2 });
  });

  test("switching off keeps the chosen quantity on every date", () => {
    const even = evenByDate(["a", "b"], 2);
    expect(even).toEqual({ a: 2, b: 2 });
    expect(byDateTotal(even)).toBe(4);
  });

  test("switching back on keeps the busiest date, not the sum", () => {
    expect(uniformQuantity({ a: 2, b: 1 })).toBe(2);
    expect(uniformQuantity({})).toBe(0);
  });

  test("the sheet offers the switch only when a cart can split", () => {
    for (const needle of [
      "issue-3281-same-tickets-switch",
      "Same tickets for every date",
      'multiDaySelection.pricingMode !== "all_days"',
      "quoteEventDateIds.length >= 2",
      "perDateActive ? quoteEventDateIds : null",
    ]) {
      expect(SHEET).toContain(needle);
    }
  });

  test("the sale shortcut stays away from a per-date cart", () => {
    expect(SHEET).toMatch(/ticket !== undefined &&\s+!perDateActive/);
  });
});

describe("#3281 Explorer per-date checkout body", () => {
  const paystack = (suffix: string) => ({
    data: {
      kind: "requires_paystack_redirect",
      checkoutSessionId: `session-${suffix}`,
      buyerStatusToken: `token-${suffix}`,
      authorizationUrl: `https://checkout.example/${suffix}`,
      returnUrl: "https://host.usemingla.com/return",
      reference: suffix,
      totalCents: 100,
      currency: "NGN",
    },
    error: null,
  });
  const line = (byDate?: Record<string, number>) => ({
    ticketTypeId: "11111111-1111-4111-8111-111111111111",
    quantity: 3,
    paymentPlanChoice: "full" as const,
    ...(byDate !== undefined ? { byDate } : {}),
  });
  const v2 = (byDate?: Record<string, number>, eventId?: string) =>
    input({
      ...(eventId !== undefined ? { eventId } : {}),
      accountId: "account-1",
      checkoutContractVersion: 2,
      purchaseTermsAccepted: true,
      quoteDigest: "digest",
      quoteListDigest: "list-digest",
      eventId: eventId ?? "22222222-2222-4222-8222-222222222222",
      lines: [line(byDate)],
    });
  const createCalls = () =>
    mockInvoke.mock.calls.filter(
      (call) => call[0] === "ticket-checkout-create",
    );

  it("sends the map on an uneven line", async () => {
    mockInvoke.mockResolvedValue(paystack("a"));
    await useNativeCheckoutFlow()(
      v2({ "day-1": 2, "day-2": 1 }) as never,
    );
    expect(createCalls()[0][1].body.lines).toEqual([
      line({ "day-1": 2, "day-2": 1 }),
    ]);
  });

  it("keeps a uniform line's body free of byDate", async () => {
    mockInvoke.mockResolvedValue(paystack("b"));
    await useNativeCheckoutFlow()(v2() as never);
    expect(JSON.stringify(createCalls()[0][1].body)).not.toContain("byDate");
  });

  it("treats two splits of one total as different carts", async () => {
    const eventId = "33333333-3333-4333-8333-333333333333";
    mockInvoke
      .mockResolvedValueOnce(paystack("c"))
      .mockResolvedValueOnce(paystack("d"));
    await useNativeCheckoutFlow()(v2({ "day-1": 2, "day-2": 1 }, eventId) as never);
    await useNativeCheckoutFlow()(v2({ "day-1": 1, "day-2": 2 }, eventId) as never);
    expect(createCalls()).toHaveLength(2);
    expect(createCalls()[0][1].body.checkoutAttemptId).not.toBe(
      createCalls()[1][1].body.checkoutAttemptId,
    );
  });
});
