/**
 * issue #4522 S-1 — every plan-v2 trip checkout showed "Couldn't get your
 * price" because the quote body carries `"addonPaymentMode": null` (the SQL in
 * 20281202034522 emits `v_plan->'addonPaymentMode'`, JSON null, whenever the
 * cart has no add-on choice) and the reader treated null as an invalid choice.
 *
 * These tests feed the real wire shape of `issue_3281_quote_cart` for a v2
 * cart through `quoteTicketCheckout`, not a fixture that omits the key.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { readTicketQuoteAddOnPaymentModeField } from "@mingla/offering-rendering/ticketQuotePlanV2Contract";

const request = jest.fn<(body: Record<string, unknown>) => Promise<unknown>>();

jest.mock("../ticketCheckoutService", () => ({
  invokeTicketCheckoutRequest: request,
}));

import { quoteTicketCheckout, type TicketQuoteInput } from "../ticketQuoteService";

const input = {
  eventId: "4878b0a2-0000-4000-8000-000000000001",
  surface: "web",
  buyer: {
    name: "",
    email: "",
    phone: "",
    phoneCountryIso: "US",
    marketingOptIn: false,
  },
  lines: [
    {
      ticketTypeId: "5a1f0c3e-0000-4000-8000-000000000002",
      ticketName: "Standard",
      quantity: 1,
      unitPrice: 1200,
      isFree: false,
    },
  ],
} as unknown as TicketQuoteInput;

/** Shape of the 200 the tester captured on /checkout-trip for a v2 trip. */
const realV2QuoteBody = (
  addonPaymentMode: unknown,
): Record<string, unknown> => ({
  currency: "USD",
  lines: [
    {
      ticketTypeId: "5a1f0c3e-0000-4000-8000-000000000002",
      ticketName: "Standard",
      quantity: 1,
      listUnitCents: 120000,
      netUnitCents: 120000,
      lineListCents: 120000,
      lineNetCents: 120000,
      discountCents: 0,
      discounts: [],
    },
  ],
  listSubtotalCents: 120000,
  discountCents: 0,
  netSubtotalCents: 120000,
  dueTodayNetCents: 30000,
  dueTodayListCents: 30000,
  extras: [],
  extrasTotalCents: 0,
  installmentSchedule: null,
  discounts: [],
  codeOutcome: null,
  notices: [],
  quoteDigest: "digest-v2",
  quoteListDigest: "list-digest-v2",
  buyerTotalCents: 120000,
  paymentPlanV2: {
    availability: "plan",
    countOffered: 3,
    countGiven: 3,
    finalDueAt: "2027-02-10T00:00:00Z",
    installmentSchedule: {
      fullPriceCents: 120000,
      depositCents: 30000,
      currency: "usd",
      planVersion: 2,
      availability: "plan",
      countOffered: 3,
      countGiven: 3,
      finalDueAt: "2027-02-10T00:00:00Z",
      installments: [1, 2, 3].map((ordinal) => ({
        ordinal,
        pct: 25,
        amountCents: 30000,
        dueAt: ["2026-12-19T00:00:00Z", "2027-01-15T00:00:00Z", "2027-02-10T00:00:00Z"][
          ordinal - 1
        ],
        addonPortionCents: 0,
        sourceTicketTypeId: "5a1f0c3e-0000-4000-8000-000000000002",
      })),
    },
  },
  addonPaymentMode,
});

describe("#4522 S-1 quote add-on payment mode on the real wire shape", () => {
  beforeEach(() => {
    request.mockReset();
  });

  test("JSON null (no add-on choice) returns the plan, not an error", async () => {
    const body = realV2QuoteBody(null);
    // The key really is present with a null value, as the SQL sends it.
    expect(Object.prototype.hasOwnProperty.call(body, "addonPaymentMode")).toBe(true);
    request.mockResolvedValue(JSON.parse(JSON.stringify(body)));
    const quote = await quoteTicketCheckout(input);
    expect(quote.addonPaymentMode).toBeUndefined();
    expect(quote.paymentPlanV2?.availability).toBe("plan");
    expect(
      quote.paymentPlanV2?.installmentSchedule?.installments.map((row) => row.amountCents),
    ).toEqual([30000, 30000, 30000]);
  });

  test("an absent key still means no add-on choice", async () => {
    const body = realV2QuoteBody(undefined);
    delete body.addonPaymentMode;
    request.mockResolvedValue(body);
    const quote = await quoteTicketCheckout(input);
    expect(quote.addonPaymentMode).toBeUndefined();
    expect(quote.paymentPlanV2?.countGiven).toBe(3);
  });

  test("a valid choice is kept", async () => {
    request.mockResolvedValue(realV2QuoteBody("spread"));
    await expect(quoteTicketCheckout(input)).resolves.toMatchObject({
      addonPaymentMode: "spread",
    });
    request.mockResolvedValue(realV2QuoteBody("today"));
    await expect(quoteTicketCheckout(input)).resolves.toMatchObject({
      addonPaymentMode: "today",
    });
  });

  test("an invalid non-null value still fails closed", async () => {
    for (const bad of ["later", "", 0, false, {}, []]) {
      request.mockResolvedValue(realV2QuoteBody(bad));
      await expect(quoteTicketCheckout(input)).rejects.toThrow(
        "addon_payment_mode_invalid",
      );
    }
  });

  test("the shared field reader: null/absent = no choice, junk = refused", () => {
    expect(readTicketQuoteAddOnPaymentModeField(null)).toEqual({ ok: true, mode: undefined });
    expect(readTicketQuoteAddOnPaymentModeField(undefined)).toEqual({
      ok: true,
      mode: undefined,
    });
    expect(readTicketQuoteAddOnPaymentModeField("today")).toEqual({ ok: true, mode: "today" });
    expect(readTicketQuoteAddOnPaymentModeField("later")).toEqual({ ok: false });
  });
});
