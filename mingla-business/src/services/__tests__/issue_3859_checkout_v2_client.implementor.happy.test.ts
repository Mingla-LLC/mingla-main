import { readFileSync } from "node:fs";
import { join } from "node:path";

const invoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
jest.mock("../../analytics/webAnalytics", () => ({
  fireAdInitiateCheckout: jest.fn(),
  // [TEST-MOD-APPROVED #3697] Keep this checkout-v2 contract fixture focused
  // on line choices while the new optional browser match fields are absent.
  getStoredAdMatchData: () => ({
    fbp: null,
    fbc: null,
    scid: null,
    clientUserAgent: null,
  }),
  getStoredClickAttribution: () => ({ clickId: null }),
}));

import { createTicketCheckout } from "../ticketCheckoutService";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const STANDARD = "22222222-2222-4222-8222-222222222222";
const VIP = "33333333-3333-4333-8333-333333333333";
const ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const buyer = {
  name: "Buyer",
  email: "buyer@example.test",
  phone: "+15555550123",
  marketingOptIn: false,
  termsAccepted: true,
};
const lines = [
  {
    ticketTypeId: STANDARD,
    ticketName: "Standard",
    quantity: 1,
    unitPrice: 100,
    currency: "USD",
    isFree: false,
    paymentPlanChoice: "installments" as const,
  },
  {
    ticketTypeId: VIP,
    ticketName: "VIP",
    quantity: 2,
    unitPrice: 200,
    currency: "USD",
    isFree: false,
    paymentPlanChoice: "full" as const,
  },
];

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({
    data: { kind: "free_completed", orderId: "order", tickets: [] },
    error: null,
  });
});

test("#3859 web v2 sends mixed line choices and no checkout-wide scalar", async () => {
  await createTicketCheckout({
    eventId: EVENT_ID,
    buyer,
    lines,
    surface: "web",
    checkoutContractVersion: 2,
    checkoutAttemptId: ATTEMPT,
  });
  const body = invoke.mock.calls[0][1].body;
  expect(body.checkoutContractVersion).toBe(2);
  expect(body.checkoutAttemptId).toBe(ATTEMPT);
  expect(body.purchaseTermsAccepted).toBe(true);
  expect(body.lines.map((line: { paymentPlanChoice: string }) =>
    line.paymentPlanChoice)).toEqual(["installments", "full"]);
  expect(body).not.toHaveProperty("payment_plan_choice");
});

test("#3859 v2 refuses missing purchase terms before transport", async () => {
  await expect(createTicketCheckout({
    eventId: EVENT_ID,
    buyer: { ...buyer, termsAccepted: false },
    lines,
    surface: "web",
    checkoutContractVersion: 2,
    checkoutAttemptId: ATTEMPT,
  })).rejects.toThrow("purchase_terms_required");
  expect(invoke).not.toHaveBeenCalled();
});

test("#3859 v2 refuses a checkout-wide scalar before transport", async () => {
  await expect(createTicketCheckout({
    eventId: EVENT_ID,
    buyer,
    lines,
    surface: "web",
    checkoutContractVersion: 2,
    checkoutAttemptId: ATTEMPT,
    paymentPlanChoice: "full",
  })).rejects.toThrow("checkout_scalar_plan_forbidden");
  expect(invoke).not.toHaveBeenCalled();
});

test("#3859 legacy lines may omit a choice but v2 refuses them before transport", async () => {
  await expect(createTicketCheckout({
    eventId: EVENT_ID,
    buyer,
    lines: lines.map(({ paymentPlanChoice: _choice, ...line }) => line),
    surface: "web",
    checkoutContractVersion: 2,
    checkoutAttemptId: ATTEMPT,
  })).rejects.toThrow("checkout_lines_invalid");
  expect(invoke).not.toHaveBeenCalled();
});

test("#3872 Business quote and create remain paired by server digests", () => {
  const source = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "app",
      "checkout-trip",
      "[tripEventId]",
      "payment.tsx",
    ),
    "utf8",
  );
  const nativeCreateStart = source.indexOf(
    "const outcome = await nativeCheckout({",
  );
  const nativeCreateEnd = source.indexOf(
    'mixpanelService.track("ticket_checkout_sheet_opened"',
    nativeCreateStart,
  );
  const webCreateStart = source.indexOf(
    "const checkout = await createTicketCheckout({",
  );
  const webCreateEnd = source.indexOf(
    "const handoff = ticketCheckoutProviderHandoff(checkout)",
    webCreateStart,
  );

  expect(nativeCreateStart).toBeGreaterThan(-1);
  expect(nativeCreateEnd).toBeGreaterThan(nativeCreateStart);
  expect(webCreateStart).toBeGreaterThan(-1);
  expect(webCreateEnd).toBeGreaterThan(webCreateStart);

  const nativeCreate = source.slice(nativeCreateStart, nativeCreateEnd);
  const webCreate = source.slice(webCreateStart, webCreateEnd);

  expect(nativeCreate.length).toBeGreaterThan(40);
  expect(webCreate.length).toBeGreaterThan(40);

  expect(nativeCreate).not.toContain("checkoutContractVersion");
  expect(nativeCreate).toContain("paymentPlanChoice");
  expect(nativeCreate).toContain("quoteDigest: activeQuote.quoteDigest");
  expect(nativeCreate).toContain("quoteListDigest: activeQuote.quoteListDigest");
  expect(webCreate).toContain("checkoutContractVersion: 2");
  expect(webCreate).toContain("checkoutAttemptId");
  expect(webCreate).toContain("quoteDigest: activeQuote.quoteDigest");
  expect(webCreate).toContain("quoteListDigest: activeQuote.quoteListDigest");
  expect(webCreate).not.toContain("paymentPlanChoice:");
  expect(source).toContain("planLines.map(({ line, tier, schedule })");
  expect(source).toContain(
    "setLinePaymentPlanChoice(line.ticketTypeId, choice)",
  );
  expect(source).not.toContain("setLinePaymentPlanChoices");
  expect(source).toContain("formatQuoteMoney(dueTodayCents");
});
