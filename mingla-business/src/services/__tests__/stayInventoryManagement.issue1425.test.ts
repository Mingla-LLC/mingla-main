const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

// The mock must be declared before this import so Jest's hoisted factory can use it.
// eslint-disable-next-line import/first
import {
  attachStayOfferingMedia,
  changeStayOfferingStatus,
  replaceStayOfferingFees,
  replaceStayUnits,
  setStayOfferingPolicy,
  setStayOfferingPrice,
  updateStayOffering,
  upsertStayPlaceSchedule,
  upsertStayPlaceWindows,
  upsertStayRoomNights,
} from "../stayInventoryService";

describe("Issue #1425 Stay management commands", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      data: {
        kind: "success",
        data: { inventory: { offerings: [] } },
        requestId: "request-1425",
      },
      error: null,
    });
  });

  it("routes edits, lifecycle, media, money and units through one managed boundary", async () => {
    await updateStayOffering({
      venueId: "venue-1",
      offeringId: "offering-1",
      expectedVersion: 2,
      patch: { name: "Lagoon suite", description: "Private waterfront room" },
    });
    await replaceStayUnits({
      venueId: "venue-1",
      offeringId: "offering-1",
      expectedVersion: 3,
      units: [{ name: "101" }, { name: "102" }],
    });
    await setStayOfferingPrice({
      venueId: "venue-1",
      offeringId: "offering-1",
      expectedVersion: 4,
      price: { amountMinor: 250_000, currencyCode: "NGN" },
    });
    await replaceStayOfferingFees({
      venueId: "venue-1",
      offeringId: "offering-1",
      expectedVersion: 5,
      fees: [
        {
          feeKey: "resort_fee",
          label: "Resort fee",
          calculation: "fixed_per_room_night",
          amountMinor: 25_000,
          currencyCode: "NGN",
          displayMode: "separate",
        },
      ],
    });
    await setStayOfferingPolicy({
      venueId: "venue-1",
      offeringId: "offering-1",
      expectedVersion: 6,
      policy: {
        cancellationPolicy: "Free cancellation until 48 hours before arrival",
        noShowRefundBasisPoints: 0,
      },
    });
    await attachStayOfferingMedia({
      venueId: "venue-1",
      offeringId: "offering-1",
      expectedVersion: 7,
      media: {
        storageObjectId: "object-1",
        altText: "Lagoon suite",
        isCover: true,
      },
    });
    await changeStayOfferingStatus({
      venueId: "venue-1",
      offeringId: "offering-1",
      expectedVersion: 8,
      status: "paused",
    });

    expect(mockInvoke.mock.calls.map((call) => call[1].body.action)).toEqual([
      "update_offering",
      "replace_units",
      "set_price",
      "replace_fees",
      "set_policy",
      "attach_media",
      "change_status",
    ]);
    for (const call of mockInvoke.mock.calls) {
      expect(call[0]).toBe("manage-stay-inventory");
      expect(call[1].body.venueId).toBe("venue-1");
      expect(call[1].body.payload.offeringId).toBe("offering-1");
    }
  });

  it("sends Room nights and Place schedules/windows as server-authoritative batches", async () => {
    await upsertStayRoomNights({
      venueId: "venue-1",
      offeringId: "room-1",
      nights: [
        {
          localDate: "2027-02-01",
          sellableQuantity: 4,
          priceOverrideMinor: 300_000,
          currencyCode: "NGN",
          stopSell: false,
          expectedVersion: 2,
        },
      ],
    });
    await upsertStayPlaceSchedule({
      venueId: "venue-1",
      offeringId: "place-1",
      schedule: {
        mode: "repeating_windows",
        timezone: "Africa/Lagos",
        localStartDate: "2027-02-01",
        localEndDate: "2027-02-28",
        weekdays: [5, 6],
        localStartTime: "10:00",
        localEndTime: "18:00",
        slotDurationMinutes: 60,
        slotIntervalMinutes: 60,
      },
    });
    await upsertStayPlaceWindows({
      venueId: "venue-1",
      windows: [
        {
          windowId: "window-1",
          sellableCapacity: 12,
          stopSell: true,
          expectedVersion: 3,
        },
      ],
    });

    expect(mockInvoke.mock.calls.map((call) => call[1].body.action)).toEqual([
      "upsert_room_nights",
      "upsert_place_schedule",
      "upsert_place_windows",
    ]);
    expect(mockInvoke.mock.calls[0][1].body.payload.nights).toHaveLength(1);
    expect(mockInvoke.mock.calls[1][1].body.payload.timezone).toBe(
      "Africa/Lagos",
    );
    expect(mockInvoke.mock.calls[2][1].body.payload.windows[0]).toEqual(
      expect.objectContaining({ stopSell: true, expectedVersion: 3 }),
    );
  });
});
