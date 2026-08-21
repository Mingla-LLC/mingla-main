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

const APP_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(APP_ROOT, rel), "utf8");
const SHEET = read("src/components/expandedCard/TicketCartSheet.tsx");
const CHOOSER = read("src/components/expandedCard/EventDayChooser.tsx");

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

  it("multiplies displayed/payload cents by selected days without changing line quantities", () => {
    expect(SHEET).toContain('multiDaySelection?.pricingMode === "per_day"');
    expect(SHEET).toContain("allInCents *= dayMultiplier");
    expect(SHEET).toContain("baseCents *= dayMultiplier");
    expect(SHEET).toMatch(/lines:\s*lines[\s\S]{0,180}quantity: l\.quantity/);
    expect(SHEET).toContain("totalCents: pricing.allInCents");
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
