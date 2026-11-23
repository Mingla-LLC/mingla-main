/**
 * #4490 spec 08 O2 — Tap to pay and Scan to pay on the Till.
 *
 *  1. The tap flow's scope union: a Till tap creates its intent through the
 *     Till server with the payment id and no lines; an event tap sends exactly
 *     what it sent before (no scope key).
 *  2. createTillTapServer talks to door-tap-intent with scope "till" and never
 *     sends an amount.
 *  3. The availability matrix (tillTapOffer): hidden for Nigeria / Paystack,
 *     other countries, no release, web, a member who may not sell, or a server
 *     that says no; disabled with the reason on iPad, iOS below 17.6, Android
 *     below API 33 and a build without the module or entitlement; ready only
 *     when every condition holds.
 *  4. The scan panel, paid labels, late money and the guest page states.
 *  5. The payment sheet offers Tap before Scan before Cash, and Tap and Scan
 *     never send an amount.
 *
 * fails-on-revert: each block names the rule it pins.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const mockInvoke = jest.fn<(fn: string, options: { body: Record<string, unknown> }) => Promise<unknown>>();
jest.mock("../../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (fn: string, options: { body: Record<string, unknown> }) => mockInvoke(fn, options) },
  },
}));

import { createTillTapServer, type DoorTapIntent } from "../../../../services/terminal/doorTapEdge";
import {
  TapToPaySaleFlow,
  tapSaleScopeOf,
  type TapToPayServer,
  type TapToPayTerminalClient,
} from "../../../../services/terminal/tapToPayFlow";
import type { TapToPayDeviceFacts } from "../../../../services/terminal/tapToPayDevice";
import type { TillPayment, TillSale } from "../../../../services/venueTillService";
import { tillTapOffer, type TillTapFacts } from "../tillTapAvailability";
import {
  cardTotalDiffers,
  countdown,
  guestPayFormErrors,
  guestPayState,
  latePayments,
  mapTillPayView,
  paidLabel,
  scanPanelState,
  spacedCode,
  toTillPayUrl,
} from "../tillPayModel";
import { tillTapPanelCopy } from "../tillTapPanelModel";
import { TILL_COPY } from "../tillCopy";

const INTENT: DoorTapIntent = {
  paymentIntentId: "pi_till",
  clientSecret: "pi_till_secret",
  totalCents: 6000,
  currency: "GBP",
  stripeAccountId: "acct_1",
  locationId: "tml_1",
};

const terminal = (): TapToPayTerminalClient => ({
  ensureReaderConnected: jest.fn(async () => ({})),
  retrievePaymentIntent: jest.fn(async () => ({ paymentIntent: { id: "pi_till", status: "requires_payment_method" } })),
  collectPaymentMethod: jest.fn(async () => ({ paymentIntent: { id: "pi_till", status: "requires_confirmation" } })),
  confirmPaymentIntent: jest.fn(async () => ({ paymentIntent: { id: "pi_till", status: "succeeded" } })),
  cancelCollectPaymentMethod: jest.fn(async () => ({})),
});

const server = () => ({
  createIntent: jest.fn<TapToPayServer["createIntent"]>(async () => INTENT),
  completeIntent: jest.fn<TapToPayServer["completeIntent"]>(async () => ({ orderId: "pay_1", ticketIds: [], receiptQueued: false, replayed: false })),
  cancelIntent: jest.fn<TapToPayServer["cancelIntent"]>(async () => {}),
});

const DRAFT = { lines: [], eventDateId: null, buyerPhone: null, phoneCountryIso: null, buyerName: null };

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("1. the tap flow's scope union", () => {
  test("a Till tap creates its intent with the Till scope and no lines, then completes", async () => {
    const s = server();
    const states: string[] = [];
    const flow = new TapToPaySaleFlow({
      scope: { kind: "till", venueId: "v1", paymentId: "p1" },
      draft: DRAFT,
      clientRequestId: "req-till",
      terminal: terminal(),
      server: s,
      onState: (st) => states.push(st.kind),
    });
    await flow.start();
    expect(s.createIntent).toHaveBeenCalledTimes(1);
    expect(s.createIntent.mock.calls[0][0]).toMatchObject({
      scope: { kind: "till", venueId: "v1", paymentId: "p1" },
      lines: [],
      clientRequestId: "req-till",
    });
    expect(s.completeIntent).toHaveBeenCalledWith({ paymentIntentId: "pi_till", clientRequestId: "req-till" });
    expect(states).toContain("approved");
  });

  test("an event tap sends what it always sent (no scope key)", async () => {
    const s = server();
    const flow = new TapToPaySaleFlow({
      eventId: "evt_1",
      draft: { lines: [{ ticketTypeId: "tt_1", quantity: 1 }], eventDateId: null, buyerPhone: null, phoneCountryIso: null, buyerName: null },
      clientRequestId: "req-evt",
      terminal: terminal(),
      server: s,
      onState: () => {},
    });
    await flow.start();
    const sent = s.createIntent.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(sent.eventId).toBe("evt_1");
    expect("scope" in sent).toBe(false);
    expect(sent.lines).toEqual([{ ticketTypeId: "tt_1", quantity: 1 }]);
  });

  test("tapSaleScopeOf reads an event caller as event scope", () => {
    expect(tapSaleScopeOf({ eventId: "e" })).toEqual({ kind: "event", eventId: "e" });
    expect(tapSaleScopeOf({ scope: { kind: "till", venueId: "v", paymentId: "p" } })).toEqual({ kind: "till", venueId: "v", paymentId: "p" });
  });
});

describe("2. the Till tap server", () => {
  test("create, complete and cancel go to door-tap-intent with scope till and no amount", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ...INTENT }, error: null });
    mockInvoke.mockResolvedValueOnce({ data: { status: "recorded", paymentId: "p1", replayed: false }, error: null });
    mockInvoke.mockResolvedValueOnce({ data: { status: "cancelled" }, error: null });
    const s = createTillTapServer({ venueId: "v1", paymentId: "p1" });
    const created = await s.createIntent({ eventId: "", eventDateId: null, lines: [], clientRequestId: "r1", buyerPhone: null, phoneCountryIso: null, buyerName: null });
    expect(created.totalCents).toBe(6000);
    const done = await s.completeIntent({ paymentIntentId: "pi_till", clientRequestId: "r1" });
    expect(done.orderId).toBe("p1");
    await s.cancelIntent({ paymentIntentId: "pi_till", clientRequestId: "r1" });
    const bodies: Array<Record<string, unknown>> = mockInvoke.mock.calls.map(([fn, o]) => ({ fn, ...o.body }));
    expect(bodies.map((b) => [b.fn, b.action, b.scope])).toEqual([
      ["door-tap-intent", "create", "till"],
      ["door-tap-intent", "complete", "till"],
      ["door-tap-intent", "cancel", "till"],
    ]);
    expect(bodies[0]).toMatchObject({ venueId: "v1", paymentId: "p1", clientRequestId: "r1" });
    for (const b of bodies) {
      expect(Object.keys(b).some((k) => /amount|total|cents/i.test(k))).toBe(false);
    }
  });
});

const IPHONE: TapToPayDeviceFacts = { os: "ios", version: "17.6", isPad: false, nativeModulePresent: true, entitled: true };
const GB = { paymentProvider: "stripe", defaultCurrency: "GBP", payoutCountry: "GB" };
const facts = (over: Partial<TillTapFacts> = {}): TillTapFacts => ({
  brand: GB,
  release: { iphone: true, android: true },
  device: IPHONE,
  canSell: true,
  serverAllows: true,
  ...over,
});

describe("3. the tap availability matrix", () => {
  test("ready only when every condition holds", () => {
    expect(tillTapOffer(facts())).toEqual({ kind: "ready" });
    expect(tillTapOffer(facts({ device: { ...IPHONE, os: "android", version: 33 } }))).toEqual({ kind: "ready" });
    expect(tillTapOffer(facts({ brand: { paymentProvider: "stripe", payoutCountry: "US" } }))).toEqual({ kind: "ready" });
  });
  test.each([
    ["Nigeria (Paystack)", facts({ brand: { paymentProvider: "paystack", defaultCurrency: "NGN", payoutCountry: "NG" } })],
    ["a Stripe brand paid out outside GB/US", facts({ brand: { paymentProvider: "stripe", payoutCountry: "DE" } })],
    ["not released on iPhone", facts({ release: { iphone: false, android: true } })],
    ["not released on Android", facts({ device: { ...IPHONE, os: "android", version: 34 }, release: { iphone: true, android: false } })],
    ["web", facts({ device: { ...IPHONE, os: "web" } })],
    ["a member who may not sell", facts({ canSell: false })],
    ["the server says no", facts({ serverAllows: false })],
  ])("hidden: %s", (_name, f) => {
    expect(tillTapOffer(f)).toEqual({ kind: "hidden" });
  });
  test.each([
    ["iPad", { ...IPHONE, isPad: true }, "unsupported_device"],
    ["iOS 17.5", { ...IPHONE, version: "17.5" }, "ios_update"],
    ["iOS 16", { ...IPHONE, version: "16.7" }, "unsupported_device"],
    ["Android API 32", { ...IPHONE, os: "android", version: 32 }, "unsupported_device"],
    ["no Terminal module in this build", { ...IPHONE, nativeModulePresent: false }, "needs_latest_app"],
    ["an iPhone build without the entitlement", { ...IPHONE, entitled: false }, "needs_latest_app"],
  ])("disabled with the reason: %s", (_name, device, reason) => {
    expect(tillTapOffer(facts({ device: device as TapToPayDeviceFacts }))).toEqual({ kind: "disabled", reason });
  });
  test("a brand this login cannot read follows the server", () => {
    expect(tillTapOffer(facts({ brand: null }))).toEqual({ kind: "ready" });
    expect(tillTapOffer(facts({ brand: null, serverAllows: false }))).toEqual({ kind: "hidden" });
  });
});

const payment = (over: Partial<TillPayment> = {}): TillPayment => ({
  id: "p1",
  method: "scan",
  state: "paid",
  amountMinor: 550000,
  serviceChargeMinor: 50000,
  tipMinor: 0,
  cashGivenMinor: null,
  changeMinor: null,
  paidLate: false,
  paidAt: null,
  reference: "ABCD1234",
  refundedMinor: 0,
  receiptSends: 0,
  chargedMinor: 550000,
  providerChannel: null,
  cardBrand: null,
  cardLast4: null,
  lateKept: false,
  payCode: null,
  ...over,
});

const sale = (over: Partial<TillSale> = {}): TillSale => ({
  id: "s1",
  venueId: "v1",
  state: "open",
  checkLabel: "Ada",
  spotId: null,
  spotLabel: null,
  serverUserId: "u1",
  currency: "NGN",
  subtotalMinor: 500000,
  serviceChargeMinor: 50000,
  totalDueMinor: 550000,
  paidMinor: 0,
  remainingMinor: 550000,
  overpaidMinor: 550000,
  settledOutside: null,
  version: 3,
  businessDate: null,
  pendingPayment: false,
  lines: [],
  payments: [],
  ...over,
});

describe("4. scan panel, labels, late money, guest page", () => {
  const now = Date.parse("2026-11-22T20:00:00Z");
  test("countdown and the panel states", () => {
    expect(countdown("2026-11-22T20:14:32Z", now)).toBe("14:32");
    expect(countdown("2026-11-22T19:59:59Z", now)).toBeNull();
    const base = { status: "opened", paymentState: "pending", payStarted: false, expiresAt: "2026-11-22T20:10:00Z" };
    expect(scanPanelState(base, now)).toBe("waiting");
    expect(scanPanelState({ ...base, payStarted: true }, now)).toBe("paying");
    expect(scanPanelState({ ...base, paymentState: "paid" }, now)).toBe("paid");
    expect(scanPanelState({ ...base, status: "cancelled", paymentState: "cancelled" }, now)).toBe("cancelled");
    expect(scanPanelState({ ...base, expiresAt: "2026-11-22T19:00:00Z" }, now)).toBe("expired");
  });
  test("paid labels say how it was paid", () => {
    expect(paidLabel(payment({ providerChannel: "bank_transfer" }))).toBe(TILL_COPY.paidByTransfer);
    expect(paidLabel(payment({ providerChannel: "card" }))).toBe(TILL_COPY.paidOnPhone);
    expect(paidLabel(payment({ method: "tap", cardBrand: "visa", cardLast4: "4242" }))).toBe("Paid by card · Visa •••• 4242");
  });
  test("late money: the banner lists a cancelled payment that was paid; Keep only while something is due", () => {
    const late = payment({ paidLate: true });
    expect(latePayments(sale({ payments: [late] }))).toEqual([{ payment: late, canKeep: true }]);
    expect(latePayments(sale({ state: "paid", remainingMinor: 0, payments: [late] }))[0].canKeep).toBe(false);
    expect(latePayments(sale({ payments: [payment({ paidLate: true, lateKept: true })] }))).toEqual([]);
    expect(latePayments(sale({ payments: [payment({ paidLate: true, state: "refunded", refundedMinor: 550000 })] }))).toEqual([]);
    expect(latePayments(sale({ payments: [payment()] }))).toEqual([]);
  });
  test("the card total shows only when the guest pays more than the bill", () => {
    expect(cardTotalDiffers(550000, 0, 550000)).toBe(false);
    expect(cardTotalDiffers(550000, 0, 574750)).toBe(true);
    expect(TILL_COPY.cardIncludesFees("₦5,747.50")).toBe("Card ₦5,747.50, includes fees");
  });
  test("only a /pay/till/<code> link becomes a QR; codes read in two halves", () => {
    expect(toTillPayUrl("http://localhost:8491/pay/till/QXR7KM2P")).toBe("http://localhost:8491/pay/till/QXR7KM2P");
    expect(toTillPayUrl("https://x.example/visit/abc")).toBeNull();
    expect(toTillPayUrl("https://x.example/pay/till/O0000000")).toBeNull();
    expect(spacedCode("QXR7KM2P")).toBe("QXR7 KM2P");
  });
  test("the guest page never says 'not charged' on a closed code; back from paying it confirms, then offers Check again", () => {
    const view = mapTillPayView({ status: "opened", amountMinor: 550000, currency: "NGN", venueName: "Gameland", lines: [] });
    expect(guestPayState({ loading: false, notFound: false, error: false, view, returned: false, pollsLeft: 0 })).toBe("details");
    expect(guestPayState({ loading: false, notFound: false, error: false, view, returned: true, pollsLeft: 4 })).toBe("confirming");
    expect(guestPayState({ loading: false, notFound: false, error: false, view, returned: true, pollsLeft: 0 })).toBe("closed");
    const closed = mapTillPayView({ status: "cancelled" });
    expect(guestPayState({ loading: false, notFound: false, error: false, view: closed, returned: false, pollsLeft: 0 })).toBe("closed");
    const paid = mapTillPayView({ status: "paid", paid: true });
    expect(guestPayState({ loading: false, notFound: false, error: false, view: paid, returned: true, pollsLeft: 3 })).toBe("paid");
    expect(guestPayState({ loading: false, notFound: true, error: false, view: null, returned: false, pollsLeft: 0 })).toBe("not_found");
    const page = fs.readFileSync(path.join(__dirname, "../../../../../app/pay/till/[code].tsx"), "utf8");
    expect(/not (been )?charged|haven't been charged/i.test(page)).toBe(false);
    expect(page.includes("useAuth")).toBe(false);
    expect(page.includes('name="robots" content="noindex')).toBe(true);
  });
  test("the guest form refuses a missing name and an undeliverable email in words", () => {
    expect(guestPayFormErrors({ name: "A", email: "x" })).toEqual({ name: "Add your name.", email: "Check the email address." });
    expect(guestPayFormErrors({ name: "Ada", email: "ada@example.test" }).email).toBe("That email address can't get receipts. Use another one.");
    expect(guestPayFormErrors({ name: "Ada", email: "ada@gmail.com" })).toEqual({ name: null, email: null });
  });
  test("tap panel copy: hold, reading, declined (try again or scan), money that may have moved never says none was taken", () => {
    expect(tillTapPanelCopy({ kind: "ready", amount: { totalCents: 1, currency: "GBP" } }).title).toBe(TILL_COPY.tapHold);
    const declined = tillTapPanelCopy({ kind: "declined", amount: { totalCents: 1, currency: "GBP" }, cardLabel: null });
    expect(declined.danger).toBe(TILL_COPY.cardDeclined);
    expect(declined.canTryAnother && declined.canScanInstead).toBe(true);
    const unknown = tillTapPanelCopy({ kind: "unknown_result", amount: { totalCents: 1, currency: "GBP" } });
    expect(unknown.title).toBe("Payment taken. Saving…");
    expect(unknown.busy && !unknown.canScanInstead).toBe(true);
    expect(tillTapPanelCopy({ kind: "reading", amount: { totalCents: 1, currency: "GBP" } }).busy).toBe(true);
  });
});

describe("5. the payment sheet", () => {
  const src = fs.readFileSync(path.join(__dirname, "../PaymentSheet.tsx"), "utf8");
  test("methods in the spec's order: Tap, Scan, Cash, own machine, room", () => {
    const order = ["till-pay-tap", "till-pay-scan", "till-pay-cash", "till-pay-own", "till-pay-room"].map((id) => src.indexOf(`testID="${id}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  test("Tap shows only when the matrix allows; Tap and Scan send the tip, never an amount", () => {
    expect(src).toContain('tapOffer.kind !== "hidden"');
    const start = src.slice(src.indexOf("const startCard"), src.indexOf("const cardPaid"));
    expect(start).toContain("tipMinor");
    expect(/amountMinor\s*:/.test(start)).toBe(false);
  });
  test("the exact spec copy is used", () => {
    expect(TILL_COPY.tapToPay).toBe("Tap to pay");
    expect(TILL_COPY.tapHold).toBe("Hold the card near the top of this phone");
    expect(TILL_COPY.scanToPay).toBe("Scan to pay");
    expect(TILL_COPY.scanAsk).toBe("Ask the guest to scan this with their phone camera");
    expect(TILL_COPY.waitingForBank).toBe("Waiting for the bank. You can carry on; we'll tell you when it lands.");
    expect(TILL_COPY.paidByTransfer).toBe("Paid by bank transfer");
    expect(TILL_COPY.textTheLink).toBe("Text them the link");
    expect(TILL_COPY.codeExpired).toBe("This code expired. Make a new one.");
    expect(TILL_COPY.cardDeclined).toBe("Card declined. Try another card or let them scan to pay.");
    expect(TILL_COPY.latePaid).toBe("A cancelled payment was paid. Refund it or keep it as payment");
  });
});
