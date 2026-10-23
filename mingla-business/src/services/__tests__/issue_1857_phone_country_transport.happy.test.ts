import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const invoke = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke } },
}));
jest.mock("../appsFlyerService", () => ({ logAppsFlyerEvent: jest.fn() }));
jest.mock("../../analytics/webAnalytics", () => ({
  getStoredClickAttribution: () => ({ clickId: null }),
  identifyAdBuyer: jest.fn(() => Promise.resolve()),
  // [TEST-MOD-APPROVED #3697] All buyer rails transport the same opt-out and
  // platform-match context, even with no ad click.
  getStoredAdMatchData: () => ({
    fbp: "fbp-3697",
    fbc: null,
    scid: "scid-3697",
    ttp: "ttp-3697",
    clientUserAgent: "Issue3697/transport",
    trackingOptOut: true,
  }),
}));
jest.mock("../../utils/randomId", () => ({ randomId: () => "test-id" }));

import { submitPublicRsvp } from "../rsvpEvents";
import { stayGuestService } from "../stayGuestService";
import { createGuestVenueReservation } from "../venueGuestReservationService";

describe("#1857 business transport country authority", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  test("executes RSVP, reservation, and Stay calls without dropping selected ISO", async () => {
    invoke
      .mockResolvedValueOnce({
        data: { status: "going", approvalStatus: "approved", rsvpId: "rsvp-1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          kind: "free_completed",
          reservationId: "reservation-1",
          reservedForUtc: "2027-03-23T18:00:00.000Z",
          partySize: 2,
          brandId: "brand-1",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          kind: "success",
          data: { groupId: "group-1" },
          requestId: "request-1",
        },
        error: null,
      });

    await submitPublicRsvp({
      eventId: "event-1",
      rsvpStatus: "going",
      guestPhone: "0712345678",
      guestPhoneCountryIso: "NG",
      guests: [
        {
          name: "Plus One",
          email: "plus@example.com",
          phone: "02079460018",
          phoneCountryIso: "GB",
        },
      ],
      plusCount: 1,
    });

    const buyer = {
      name: "Guest",
      email: "guest@example.com",
      phone: "0712345678",
      phoneCountryIso: "NG",
      marketingOptIn: false,
    };
    await createGuestVenueReservation({
      venueId: "venue-1",
      brandId: "brand-1",
      reservedForUtc: "2027-03-23T18:00:00.000Z",
      partySize: 2,
      buyer,
    });
    await stayGuestService.createGroup(
      { quoteId: "quote-1", version: 1 } as never,
      buyer,
    );

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "public-submit-rsvp",
      expect.objectContaining({
        body: expect.objectContaining({
          guestPhoneCountryIso: "NG",
          guests: [expect.objectContaining({ phoneCountryIso: "GB" })],
        }),
      }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "venue-reservation-create",
      expect.objectContaining({
        body: expect.objectContaining({
          buyer,
          adMatchData: expect.objectContaining({
            ttp: "ttp-3697",
            trackingOptOut: true,
          }),
        }),
      }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      3,
      "stay-reservations",
      expect.objectContaining({
        body: expect.objectContaining({
          action: "create_group",
          payload: expect.objectContaining({
            guest: buyer,
            adMatchData: expect.objectContaining({
              scid: "scid-3697",
              trackingOptOut: true,
            }),
          }),
        }),
      }),
    );
  });
});
