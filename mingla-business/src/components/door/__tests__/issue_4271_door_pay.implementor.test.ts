/**
 * #4271 — hosts take card payments at the door (pay code, Tap to Pay).
 * Implementor happy-path regression suite for the door payment model, the
 * pay-link QR guard, the pay code screen states and the money rules.
 */
import fs from "node:fs";
import path from "node:path";

jest.mock("../../../constants/publicUrls", () => ({
  BUSINESS_PUBLIC_ORIGIN: "https://host.usemingla.com",
}));

import {
  buildDoorPaymentOptions,
  doorMethodCollectsBuyerDetails,
  doorSaleButtonLabel,
  doorTapBlockReason,
  scannerDoorPaymentsCopy,
} from "../doorPaymentOptions";
import {
  assertDoorPayUrl,
  isDoorPayUrl,
  makeDoorPayUrl,
  type DoorPayUrl,
} from "../doorPayUrl";
import { doorPayGuestEndCopy } from "../doorPayGuestState";
import {
  doorPayHostEndCopy,
  closeDoorPayCodeThen,
  doorPayHostStatus,
  formatDoorPayCountdown,
} from "../doorPayCodeState";
import { decodeDoorTapDraft } from "../doorTapDraft";
import { doorSellAnotherHref, doorTapNewSaleHref } from "../doorTapDraftHref";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHOD_PILLS,
} from "../../../utils/paymentMethodLabels";
import { summarizeEventMoney } from "../../../utils/moneySummary";
import { computeReconciliation } from "../../../utils/reconciliation";
import { paymentMethodFromRow } from "../../../services/eventOrdersService";
import type { DoorSaleRecord } from "../../../types/doorSales";
import type { OrderRecord } from "../../../store/orderStore";

const BUSINESS = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(BUSINESS, relative), "utf8");

const NO_TAP = { available: false, needsSetup: false };

describe("#4271 door sale payment list", () => {
  // Door polish: no dead rows. The disabled Card reader row and the NEW badges went.
  test("pay code first, then cash and manual; no card reader row, no NFC", () => {
    const options = buildDoorPaymentOptions({ eventCurrency: "GBP", tapToPay: NO_TAP, platform: "ios" });
    expect(options.map((o) => o.id)).toEqual(["pay_code", "cash", "manual"]);
    expect(options[0]).toEqual({
      id: "pay_code",
      label: "Buyer pays on their phone",
      sub: "They scan a code and pay by card, Apple Pay or Google Pay.",
    });
    expect(options.find((o) => o.id === "cash")?.sub).toBe("You collect cash at the door.");
    expect(options.find((o) => o.id === "manual")?.sub).toBe("Paid another way, like a bank transfer.");
    expect(options.some((o) => o.id === "card_reader")).toBe(false);
    expect(options.some((o) => (o.id as string) === "nfc")).toBe(false);
  });

  test("Nigeria names Paystack's ways to pay", () => {
    const [payCode] = buildDoorPaymentOptions({ eventCurrency: "NGN", tapToPay: NO_TAP, platform: "android" });
    expect(payCode.sub).toBe(
      "They scan a code and pay by card, bank transfer or USSD.",
    );
  });

  test("Tap to Pay appears only when available, first, with setup copy when needed", () => {
    const ready = buildDoorPaymentOptions({
      eventCurrency: "USD",
      tapToPay: { available: true, needsSetup: false },
      platform: "ios",
    });
    expect(ready.map((o) => o.id)).toEqual(["tap_to_pay", "pay_code", "cash", "manual"]);
    expect(ready[0].sub).toBe("Take a card or phone on this iPhone.");
    const android = buildDoorPaymentOptions({
      eventCurrency: "GBP",
      tapToPay: { available: true, needsSetup: false },
      platform: "android",
    });
    expect(android[0].sub).toBe("Take a card or phone on this phone.");
    const setup = buildDoorPaymentOptions({
      eventCurrency: "GBP",
      tapToPay: { available: true, needsSetup: true },
      platform: "ios",
    });
    expect(setup[0].sub).toBe("Set up once on this phone. About 2 minutes.");
  });

  test("the button says what happens next; a pay code hides buyer details", () => {
    expect(doorSaleButtonLabel("pay_code", "ios")).toBe("Show pay code");
    expect(doorSaleButtonLabel("tap_to_pay", "ios")).toBe("Tap to Pay on iPhone");
    expect(doorSaleButtonLabel("tap_to_pay", "android")).toBe("Tap to Pay");
    expect(doorSaleButtonLabel("cash", "ios")).toBe("Complete sale");
    expect(doorSaleButtonLabel("manual", "ios")).toBe("Complete sale");
    expect(doorMethodCollectsBuyerDetails("pay_code")).toBe(false);
    expect(doorMethodCollectsBuyerDetails("cash")).toBe(true);
  });

  test("labels and pills follow the contract", () => {
    expect(PAYMENT_METHOD_LABELS).toEqual({
      cash: "Cash",
      manual: "Manual",
      card_reader: "Card reader",
      pay_code: "Buyer's phone",
      tap_to_pay: "Tap to Pay",
    });
    expect(PAYMENT_METHOD_PILLS).toEqual({
      cash: "CASH",
      manual: "MANUAL",
      card_reader: "CARD",
      pay_code: "PHONE",
      tap_to_pay: "TAP",
    });
  });

  test("the sheet uses the model and every placeholder string is gone", () => {
    const sheet = read("src/components/door/DoorSaleNewSheet.tsx");
    expect(sheet).toContain("buildDoorPaymentOptions(");
    expect(sheet).toContain("doorTapNewSaleHref(");
    expect(sheet).toContain("/door/pay/${created.codeId}");
    expect(sheet).not.toContain("[TRANSITIONAL]");
    for (const relative of [
      "src/components/door/DoorSaleNewSheet.tsx",
      "app/event/[id]/door/index.tsx",
      "app/event/[id]/door/[saleId].tsx",
      "app/event/[id]/reconciliation.tsx",
      "src/components/scanners/InviteScannerSheet.tsx",
      "src/components/scanners/ScannerHome.tsx",
    ]) {
      const source = read(relative);
      expect(source).not.toMatch(/TESTING MODE/);
      expect(source).not.toMatch(/Coming when backend ships/);
      expect(source).not.toMatch(/NFC tap/);
      expect(source.includes("not available yet") && !relative.endsWith("reconciliation.tsx")).toBe(false);
    }
    expect(read("app/event/[id]/reconciliation.tsx")).not.toMatch(/\(door\)"[\s\S]{0,120}Not available yet/);
    expect(read("src/components/scanners/InviteScannerSheet.tsx")).toContain(
      "scannerDoorPaymentsCopy(paymentProvider)",
    );
    expect(scannerDoorPaymentsCopy("stripe")).toBe(
      "Cash, manual, pay codes and Tap to Pay. Card money goes to your bank with online sales.",
    );
    expect(scannerDoorPaymentsCopy("paystack")).toBe(
      "Cash, manual and pay codes. Card money goes to your bank with online sales.",
    );
    expect(read("src/components/scanners/ScannerHome.tsx")).toContain("useCanTakeDoorPayment(");
  });
});

describe("#4271 pay-link QR guard", () => {
  test("makeDoorPayUrl builds only a /pay/door/ link from a valid code", () => {
    expect(makeDoorPayUrl("K7Q2M9XA")).toBe("https://host.usemingla.com/pay/door/K7Q2M9XA");
    expect(() => makeDoorPayUrl("k7q2m9xa")).toThrow();
    expect(() => makeDoorPayUrl("K7Q2M9X0")).toThrow(); // 0 is not in the alphabet
    expect(() => makeDoorPayUrl("ticket:abc")).toThrow();
  });

  test("a ticket value or any other string cannot pass the runtime guard", () => {
    for (const value of [
      "MINGLA-TICKET:2f4c1d",
      "https://host.usemingla.com/o/order-1",
      "https://host.usemingla.com/pay/door/K7Q2M9XA?x=1",
      "https://evil.example/pay/door/K7Q2M9XA",
      "https://host.usemingla.com/pay/door/",
      42,
    ]) {
      expect(isDoorPayUrl(value)).toBe(false);
      expect(() => assertDoorPayUrl(value)).toThrow();
    }
    expect(assertDoorPayUrl(makeDoorPayUrl("ABCDEFGH"))).toBe(
      "https://host.usemingla.com/pay/door/ABCDEFGH",
    );
  });

  test("the QR prop is typed so a plain string does not compile", () => {
    const accept = (url: DoorPayUrl): DoorPayUrl => url;
    // @ts-expect-error — a plain string is not a DoorPayUrl
    accept("MINGLA-TICKET:2f4c1d");
    expect(accept(makeDoorPayUrl("ABCDEFGH"))).toContain("/pay/door/");
  });

  test("DoorPayQr asserts at runtime and is the only door file with a QR encoder", () => {
    const qr = read("src/components/door/DoorPayQr.tsx");
    expect(qr).toContain("url: DoorPayUrl");
    expect(qr).toContain("assertDoorPayUrl(url)");
    const doorDir = path.join(BUSINESS, "src/components/door");
    const encoders = fs
      .readdirSync(doorDir)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => fs.readFileSync(path.join(doorDir, f), "utf8").includes("react-native-qrcode-svg"));
    expect(encoders).toEqual(["DoorPayQr.tsx"]);
    const route = read("src/components/door/DoorPayCodeScreen.tsx");
    expect(route).toContain("makeDoorPayUrl(row.code)");
    expect(route).not.toContain("react-native-qrcode-svg");
  });
});

describe("#4271 pay code states", () => {
  const expiresAt = "2026-11-04T20:10:00.000Z";
  const before = Date.parse("2026-11-04T20:00:18.000Z");
  const after = Date.parse("2026-11-04T20:10:01.000Z");

  test("past its time a code reads checking until the server answers", () => {
    expect(doorPayHostStatus("open", expiresAt, before, null)).toBe("open");
    expect(doorPayHostStatus("opened", expiresAt, after, null)).toBe("checking");
    expect(doorPayHostStatus("opened", expiresAt, after, "checking")).toBe("checking");
    expect(doorPayHostStatus("opened", expiresAt, after, "opened")).toBe("opened");
    expect(doorPayHostStatus("opened", expiresAt, before, "payment_landing")).toBe("payment_landing");
    expect(doorPayHostStatus("expired", expiresAt, after, null)).toBe("expired");
    expect(doorPayHostStatus("paid", expiresAt, after, "payment_landing")).toBe("paid");
    expect(formatDoorPayCountdown(expiresAt, before)).toBe("9:42");
    expect(formatDoorPayCountdown(expiresAt, after)).toBe("0:00");
  });

  test("T4: the sale sheet opens only after a live code is confirmed closed", async () => {
    const open = jest.fn();
    await closeDoorPayCodeThen({ status: "opened", close: () => Promise.resolve(false), open });
    expect(open).not.toHaveBeenCalled();
    const order: string[] = [];
    await closeDoorPayCodeThen({
      status: "open",
      close: () => {
        order.push("close");
        return Promise.resolve(true);
      },
      open: () => order.push("open"),
    });
    expect(order).toEqual(["close", "open"]);
    // Already over on the server, or paid: nothing to close.
    const close = jest.fn(() => Promise.resolve(true));
    await closeDoorPayCodeThen({ status: "expired", close, open });
    await closeDoorPayCodeThen({ status: "paid", close, open });
    expect(close).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("T13: stale copy is gone", () => {
    expect(read("app/event/[id]/reconciliation.tsx")).not.toContain("Email PDF report");
    expect(read("src/store/scannerInvitationsStore.ts")).not.toMatch(/NFC/);
  });

  test("every end state says nothing was charged and offers one-tap recovery", () => {
    expect(doorPayHostEndCopy("expired")).toMatchObject({
      title: "This code expired",
      body: "Nothing was charged. Show a new code to try again.",
      primary: { label: "Show a new code", action: "new_code" },
      secondary: { label: "Take cash instead", action: "cash_instead" },
    });
    expect(doorPayHostEndCopy("failed").body).toBe("Their bank declined it. Nothing was charged.");
    expect(doorPayHostEndCopy("cancelled").primary.label).toBe("Back to door sales");
    expect(doorPayGuestEndCopy("expired", "stripe").body).toBe("You weren't charged. Ask the door to show a new one.");
    expect(doorPayGuestEndCopy("paid", "stripe").title).toBe("This code is already paid");
    expect(doorPayGuestEndCopy("cancelled", "stripe").title).toBe("The door cancelled this sale");
  });

  test("P2-1: a Paystack guest's closed code says a late payment is refunded in full", () => {
    for (const provider of ["paystack", null] as const) {
      expect(doorPayGuestEndCopy("expired", provider).body).toBe(
        "No payment has come in. If one still lands, it's refunded to you in full. Ask the door to show a new one.",
      );
      expect(doorPayGuestEndCopy("cancelled", provider).body).toBe(
        "No payment has come in. If one still lands, it's refunded to you in full.",
      );
    }
    expect(doorPayGuestEndCopy("cancelled", "stripe").body).toBe("You weren't charged.");
  });

  test("the guest page talks about the ticket, not the app, before payment", () => {
    const page = read("app/pay/door/[code].tsx");
    const prePurchase = page.slice(0, page.indexOf("// ---- B4: paid"));
    for (const phrase of ["Mingla app", "Open in Mingla", "Get the app", "Explorer"]) {
      expect(prePurchase.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain(phrase);
    }
    expect(page).toContain("createDoorCodeCheckout(");
    expect(page).toContain("Get Mingla Explorer");
    expect(page).not.toContain("DoorPayQr");
  });

  test("tap hand-off carries the basket to the tap route", () => {
    const href = doorTapNewSaleHref("event-1", {
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      eventDateId: null,
      buyerPhone: "+447700900123",
    });
    expect(href.startsWith("/event/event-1/door/tap/new?draft=")).toBe(true);
    const raw = decodeURIComponent(href.split("draft=")[1]);
    expect(decodeDoorTapDraft(raw)).toEqual({
      lines: [{ ticketTypeId: "tier-1", quantity: 2 }],
      eventDateId: null,
      buyerPhone: "+447700900123",
      phoneCountryIso: null,
    });
  });

  test("Sell another reopens the sheet with the same tickets (tap and pay code)", () => {
    const href = doorSellAnotherHref(
      "event-1",
      { lines: [{ ticketTypeId: "tier-1", quantity: 3 }], eventDateId: "date-1" },
      "cash",
    );
    const url = new URL(`https://x${href}`);
    expect(url.pathname).toBe("/event/event-1/door");
    expect(url.searchParams.get("sellAnother")).toBe("1");
    expect(url.searchParams.get("method")).toBe("cash");
    expect(decodeDoorTapDraft(url.searchParams.get("draft"))?.lines).toEqual([
      { ticketTypeId: "tier-1", quantity: 3 },
    ]);
    const hub = read("app/event/[id]/door/index.tsx");
    expect(hub).toContain("params.sellAnother");
    expect(hub).toContain("decodeDoorTapDraft(draftParam)");
    expect(hub).toContain("initialLines={sheetSeed?.lines}");
    expect(read("src/components/door/DoorPayCodeScreen.tsx")).toContain("doorSellAnotherHref(");
    expect(read("src/components/door/DoorSaleNewSheet.tsx")).toContain(
      "useTapToPayAvailability({ brand, currency: event.currency })",
    );
  });
});

const doorSale = (overrides: Partial<DoorSaleRecord>): DoorSaleRecord => ({
  id: "sale-1",
  eventId: "event-1",
  brandId: "brand-1",
  recordedBy: "host-1",
  buyerName: "",
  buyerEmail: "",
  buyerPhone: "",
  paymentMethod: "cash",
  lines: [],
  totalGbpAtSale: 20,
  totalAtSale: 20,
  currency: "GBP",
  notes: "",
  recordedAt: "2026-11-04T20:00:00.000Z",
  status: "completed",
  refundedAmountGbp: 0,
  refundedAmount: 0,
  refunds: [],
  minglaFeeAmount: null,
  ...overrides,
});

const order = (overrides: Partial<OrderRecord>): OrderRecord =>
  ({
    id: "order-1",
    eventId: "event-1",
    brandId: "brand-1",
    buyer: { name: "Ada", email: "ada@example.com", phone: "", marketingOptIn: false },
    ticketDays: [],
    lines: [],
    totalGbpAtPurchase: 31.35,
    totalAtPurchase: 31.35,
    totalCents: 3135,
    currency: "GBP",
    paymentMethod: "pay_code",
    paidAt: "2026-11-04T20:00:00.000Z",
    status: "paid",
    refundedAmountGbp: 0,
    refundedAmount: 0,
    refundedAmountCents: 0,
    stripeApplicationFeeAmountCents: 141,
    refunds: [],
    cancelledAt: null,
    source: "online_checkout",
    lastSeenEventUpdatedAt: "2026-11-04T20:00:00.000Z",
    ...overrides,
  }) as unknown as OrderRecord;

describe("#4271 card money at the door", () => {
  test("the door hub shows Mingla's fee on card door sales and nets it out", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "GBP",
      orders: [],
      doorSales: [
        doorSale({ id: "cash-1", paymentMethod: "cash", totalAtSale: 40, totalGbpAtSale: 40 }),
        doorSale({
          id: "code-1",
          paymentMethod: "pay_code",
          totalAtSale: 31.35,
          totalGbpAtSale: 31.35,
          minglaFeeAmount: 1.41,
        }),
      ],
    });
    expect(summary.revenueByMethod.pay_code).toBe(31.35);
    expect(summary.revenueByMethod.cash).toBe(40);
    expect(summary.doorCardMinglaFee).toBe(1.41);
    expect(summary.expectedPayoutMajor).toBe(69.94);
  });

  test("an order paid by pay code or tap keeps its door method", () => {
    expect(paymentMethodFromRow("online_card", "pay_code")).toBe("pay_code");
    expect(paymentMethodFromRow("apple_pay", "tap_to_pay")).toBe("tap_to_pay");
    expect(paymentMethodFromRow("apple_pay", null)).toBe("apple_pay");
    expect(paymentMethodFromRow("cash", "cash")).toBe("cash");
  });

  test("reconciliation counts each door sale once, with card fees like online card", () => {
    const summary = computeReconciliation({
      eventId: "event-1",
      status: "live",
      eventName: "Afrobeats Night",
      currency: "GBP",
      orderEntries: [
        order({ id: "code-1" }),
        order({
          id: "cash-1",
          source: "door_sale",
          paymentMethod: "cash",
          totalAtPurchase: 40,
          totalGbpAtPurchase: 40,
          totalCents: 4000,
          stripeApplicationFeeAmountCents: null,
        }),
      ],
      doorEntries: [
        doorSale({ id: "cash-1", paymentMethod: "cash", totalAtSale: 40, totalGbpAtSale: 40 }),
        doorSale({ id: "code-1", paymentMethod: "pay_code", totalAtSale: 31.35, totalGbpAtSale: 31.35, minglaFeeAmount: 1.41 }),
      ],
      scanEntries: [],
    });
    expect(summary.revenueByMethod.cash).toBe(40);
    expect(summary.revenueByMethod.pay_code).toBe(31.35);
    expect(summary.grossRevenue).toBe(71.35);
    expect(summary.doorCardMinglaFee).toBe(1.41);
    expect(Object.keys(summary.revenueByMethod)).not.toContain("nfc");
  });
});

describe("#4271 B8 Tap to Pay on top, in Apple's words", () => {
  const options = (platform: string) =>
    buildDoorPaymentOptions({ eventCurrency: "GBP", tapToPay: { available: true, needsSetup: false }, platform });

  test("first on both platforms, named for the platform exactly", () => {
    expect(options("ios")[0]).toMatchObject({ id: "tap_to_pay", label: "Tap to Pay on iPhone" });
    expect(options("android")[0]).toMatchObject({ id: "tap_to_pay", label: "Tap to Pay" });
  });

  test("the block reasons say what is missing, in order", () => {
    const clear = {
      hasLines: true,
      dateMissing: false,
      currencyMissing: false,
      permissionLoading: false,
      emailInvalid: false,
      phoneInvalid: false,
      notesInvalid: false,
    };
    expect(doorTapBlockReason(clear)).toBeNull();
    expect(doorTapBlockReason({ ...clear, hasLines: false, dateMissing: true })).toBe("Pick at least one ticket first.");
    expect(doorTapBlockReason({ ...clear, dateMissing: true })).toBe("Pick a date first.");
    expect(doorTapBlockReason({ ...clear, permissionLoading: true })).toBe("Checking your door access…");
  });

  test("no door surface says Tap to pay with a small p", () => {
    const root = path.join(__dirname, "..", "..", "..", "..");
    const offenders: string[] = [];
    const walk = (rel: string): void => {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) return;
      if (fs.statSync(abs).isFile()) {
        if (fs.readFileSync(abs, "utf8").includes("Tap to pay")) offenders.push(rel);
        return;
      }
      for (const entry of fs.readdirSync(abs)) {
        if (entry !== "__tests__") walk(path.join(rel, entry));
      }
    };
    [
      "src/components/door",
      "src/services/terminal",
      "src/constants/tapToPayCopy.ts",
      "src/utils/paymentMethodLabels.ts",
      "src/hooks/useTapToPayAvailability.ts",
      "app/event/[id]/door",
      "app/event/[id]/reconciliation.tsx",
      "app/event/[id]/orders/[oid]/index.tsx",
    ].forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe("#4271 pay code screen stays in the on-intent door chunk (eager __common budget)", () => {
  const importsOf = (relative: string): string[] =>
    [...read(relative).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

  test("the route renders the screen only through LazyDoorSaleScreens", () => {
    const route = importsOf("app/event/[id]/door/pay/[codeId].tsx");
    expect(route).toEqual(["react", "../../../../../src/components/door/LazyDoorSaleScreens"]);
    expect(read("src/components/door/doorSaleScreens.ts")).toContain(
      'export { DoorPayCodeScreen } from "./DoorPayCodeScreen";',
    );
    expect(read("src/components/door/LazyDoorSaleScreens.tsx")).toContain("(await loadDoorSaleScreens()).DoorPayCodeScreen");
  });

  test("the guest page and the door hub import nothing the door chunk owns", () => {
    const guest = importsOf("app/pay/door/[code].tsx");
    expect(guest.some((p) => /door\/(doorTone|DoorStatusPill|doorTapDraftHref)$/.test(p))).toBe(false);
    const hub = importsOf("app/event/[id]/door/index.tsx");
    expect(hub.some((p) => /door\/(doorTone|DoorStatusPill|doorTapDraftHref|DoorPayCodeScreen)$/.test(p))).toBe(false);
    expect(importsOf("src/components/door/doorTapDraft.ts")).toEqual([]);
  });
});
