import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const invoke = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  createGuestVenueReservation,
  GuestReservationReviewError,
  previewGuestVenueReservation,
  type GuestReservationPreview,
} from "../venueGuestReservationService";

const preview = (over: Partial<GuestReservationPreview> = {}): GuestReservationPreview => ({
  kind: "preview",
  depositListCents: 5000,
  discountCents: 1000,
  depositNetCents: 4000,
  feesAndTaxCents: 200,
  totalCents: 4200,
  currency: "USD",
  discounts: [
    {
      discountId: "discount-1",
      kind: "code",
      name: "Welcome",
      code: "WELCOME",
      amountMinor: 1000,
      units: 1,
    },
  ],
  codeOutcome: {
    status: "applied",
    reason: null,
    required: null,
    with: null,
    replaced: [],
  },
  notices: [],
  quoteDigest: "0123456789abcdef0123456789abcdef",
  requiresPayment: true,
  ...over,
});

const input = {
  venueId: "venue-1",
  brandId: "brand-1",
  reservedForUtc: "2027-01-10T19:00:00.000Z",
  partySize: 2,
  buyer: {
    name: "Guest",
    email: "guest@example.com",
    phone: "+14155550123",
    marketingOptIn: false,
  },
};

describe("#3872 guest reservation discount quote contract", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  test("preview asks the server for deposit money and normalized code outcome", async () => {
    const quote = preview();
    invoke.mockResolvedValueOnce({ data: quote, error: null });

    await expect(
      previewGuestVenueReservation({ ...input, discountCode: "WELCOME" }),
    ).resolves.toEqual(quote);
    expect(invoke).toHaveBeenCalledWith(
      "venue-reservation-create",
      expect.objectContaining({
        body: expect.objectContaining({
          mode: "preview",
          discountCode: "WELCOME",
        }),
      }),
    );
  });

  test("create binds the displayed code and quote digest", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        kind: "free_completed",
        reservationId: "reservation-1",
        reservedForUtc: input.reservedForUtc,
        partySize: 2,
        brandId: "brand-1",
      },
      error: null,
    });

    await createGuestVenueReservation({
      ...input,
      discountCode: "WELCOME",
      quoteDigest: "0123456789abcdef0123456789abcdef",
    });

    expect(invoke).toHaveBeenCalledWith(
      "venue-reservation-create",
      expect.objectContaining({
        body: expect.objectContaining({
          discountCode: "WELCOME",
          quoteDigest: "0123456789abcdef0123456789abcdef",
        }),
      }),
    );
  });

  test("a stale create returns a review quote instead of a generic failure", async () => {
    const quote = preview({ totalCents: 5000, discountCents: 0 });
    const raw = JSON.stringify({
      error: "checkout_review_required",
      detail: "discount_changed",
      quote,
    });
    invoke.mockResolvedValueOnce({
      data: null,
      error: {
        context: {
          clone: () => ({ text: async () => raw }),
          text: async () => raw,
        },
      },
    });

    await expect(
      createGuestVenueReservation({
        ...input,
        discountCode: "WELCOME",
        quoteDigest: "0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toEqual(expect.any(GuestReservationReviewError));
  });
});
