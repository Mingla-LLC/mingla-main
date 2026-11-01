import {
  makeTicketCartProps,
  mockTicketQuote,
  mountTicketCart,
  renderedText,
} from "./issue_3859_ticket_cart_session_harness";

// #4174 — the Explorer sticky bar showed "Total $10.45 / Due today $10.00" for
// an ordinary $10 ticket with fees and no payment plan: `dueTodayNetCents` is
// the pre-fee base, and it was compared with the all-in `buyerTotalCents`.
const signedIn = {
  buyerUserId: "account-4174",
  buyerName: "Seth Explorer",
  buyerEmail: "seth@example.test",
  buyerPhone: "+15555550123",
  initialQuantity: 1,
};

const baseQuote = {
  kind: "quote",
  currency: "USD",
  lines: [],
  listSubtotalCents: 1000,
  discountCents: 0,
  netSubtotalCents: 1000,
  dueTodayNetCents: 1000,
  dueTodayListCents: 1000,
  installmentSchedule: null,
  discounts: [],
  codeOutcome: { status: "none", reason: null, required: null },
  notices: [],
  quoteDigest: "digest-4174",
  quoteListDigest: "list-digest-4174",
  feesCents: 45,
  taxCents: 0,
  buyerTotalCents: 1045,
  calculationId: null,
  subtotalCents: 1000,
  totalCents: 1045,
};

afterEach(() => {
  mockTicketQuote.data = null;
});

describe("issue #4174 — Explorer cart shows Due today only for payment plans", () => {
  test("a no-plan quote with fees shows one Subtotal line and no Due today", () => {
    mockTicketQuote.data = { ...baseQuote };
    const text = renderedText(mountTicketCart(makeTicketCartProps(signedIn)));

    expect(text).not.toContain("Due today");
    expect(text).not.toContain("Total");
    expect(text).toContain("Subtotal");
  });

  test("a Paystack plan quote (locked charge schedule) still shows Total and Due today", () => {
    mockTicketQuote.data = {
      ...baseQuote,
      currency: "NGN",
      dueTodayNetCents: 250000,
      netSubtotalCents: 1000000,
      buyerTotalCents: 262500,
      installmentSchedule: {
        fullPriceCents: 1000000,
        depositCents: 250000,
        installments: [
          { ordinal: 1, amountCents: 750000, dueAt: "2027-01-01T00:00:00Z" },
        ],
      },
      installmentChargeSchedule: {
        currency: "NGN",
        payments: [
          {
            ordinal: 1,
            dueAt: "2027-01-01T00:00:00Z",
            buyerTotalCents: 787500,
            feesCents: 37500,
            taxCents: 0,
          },
        ],
      },
      planTotalBuyerCents: 1050000,
    };
    const text = renderedText(mountTicketCart(makeTicketCartProps(signedIn)));

    expect(text).toContain("Due today");
    expect(text).toContain("Total");
    expect(text).not.toContain("Subtotal");
  });

  test("a Stripe plan quote (schedule without a locked charge envelope) still shows Due today", () => {
    mockTicketQuote.data = {
      ...baseQuote,
      dueTodayNetCents: 250,
      dueTodayListCents: 250,
      buyerTotalCents: 270,
      installmentSchedule: {
        fullPriceCents: 1000,
        depositCents: 250,
        installments: [
          { ordinal: 1, amountCents: 750, dueAt: "2027-01-01T00:00:00Z" },
        ],
      },
    };
    const text = renderedText(mountTicketCart(makeTicketCartProps(signedIn)));

    expect(text).toContain("Due today");
  });
});
