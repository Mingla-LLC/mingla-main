const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}));

import {
  bulkCreateStayOfferings,
  createStayOffering,
  publishStay,
  resolveStayCurrencyReconciliation,
  saveStaySettings,
} from "../stayInventoryService";

describe("Stay inventory service", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("uses one canonical endpoint for Room and Place creation", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        kind: "success",
        data: { offeringId: "offering-1" },
        requestId: "request-1",
      },
      error: null,
    });

    await createStayOffering({
      venueId: "venue-1",
      offering: {
        kind: "room",
        name: "Suite",
        inventoryBasis: "pooled_units",
        quantity: 2,
        maxAdults: 2,
        maxChildren: 2,
        price: { amountMinor: 50_000, currencyCode: "NGN" },
      },
    });
    await createStayOffering({
      venueId: "venue-1",
      offering: {
        kind: "place",
        name: "Cabana",
        inventoryBasis: "shared_capacity",
        capacity: 10,
        placePricingBasis: "per_booking",
        accessScope: "overnight_guests_only",
        price: { amountMinor: 20_000, currencyCode: "NGN" },
      },
    });

    expect(mockInvoke.mock.calls[0][0]).toBe("manage-stay-inventory");
    expect(mockInvoke.mock.calls[1][0]).toBe("manage-stay-inventory");
    expect(mockInvoke.mock.calls[0][1].body.payload.kind).toBe("room");
    expect(mockInvoke.mock.calls[1][1].body.payload.kind).toBe("place");
  });

  it("preserves bulk idempotency and every item in one request", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        kind: "success",
        data: {
          job: {
            id: "job-1",
            status: "completed",
            requested_count: 2,
            succeeded_count: 2,
            failed_count: 0,
          },
          items: [],
          replayed: false,
        },
        requestId: "request-2",
      },
      error: null,
    });
    await bulkCreateStayOfferings({
      venueId: "venue-1",
      idempotencyKey: "bulk-1",
      items: [
        {
          kind: "room",
          name: "Room A",
          inventoryBasis: "pooled_units",
          quantity: 1,
          maxAdults: 2,
          maxChildren: 1,
        },
        {
          kind: "place",
          name: "Spa Room",
          inventoryBasis: "exclusive_units",
          quantity: 1,
          placePricingBasis: "per_unit",
        },
      ],
    });
    expect(mockInvoke.mock.calls[0][1].body).toEqual({
      action: "bulk_create",
      venueId: "venue-1",
      payload: {
        idempotencyKey: "bulk-1",
        items: [
          {
            kind: "room",
            name: "Room A",
            inventoryBasis: "pooled_units",
            quantity: 1,
            maxAdults: 2,
            maxChildren: 1,
          },
          {
            kind: "place",
            name: "Spa Room",
            inventoryBasis: "exclusive_units",
            quantity: 1,
            placePricingBasis: "per_unit",
          },
        ],
      },
      expectedVersion: null,
    });
  });

  it("sends the complete Stay money set for atomic reconciliation", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        kind: "success",
        data: { authority: "settlement", currencyCode: "NGN" },
        requestId: "request-3",
      },
      error: null,
    });
    await resolveStayCurrencyReconciliation({
      venueId: "venue-1",
      reconciliation: {
        reconciliationId: "reconciliation-1",
        decision: "convert",
        fxSnapshotId: "snapshot-1",
        ranges: [],
        stayItems: [{ itemId: "price-1" }, { itemId: "fee-1" }],
      },
    });
    expect(mockInvoke.mock.calls[0][1].body.payload.stayItems).toHaveLength(2);
    expect(mockInvoke.mock.calls[0][1].body.payload.ranges).toEqual([]);
  });

  it("saves property settings and publishes with optimistic version authority", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        kind: "success",
        data: { inventory: { settings: { version: 5 } } },
        requestId: "request-4",
      },
      error: null,
    });
    await saveStaySettings({
      venueId: "venue-1",
      expectedVersion: 3,
      settings: {
        propertyKind: "hotel",
        summary: "A complete city-centre Stay property summary.",
        timezone: "Africa/Lagos",
        defaultBookingMode: "request",
        checkInTime: "15:00",
        checkOutTime: "11:00",
        amenities: ["Wi-Fi"],
      },
    });
    await publishStay({ venueId: "venue-1", expectedVersion: 5 });

    expect(mockInvoke.mock.calls[0][1].body).toEqual({
      action: "save_settings",
      venueId: "venue-1",
      payload: expect.objectContaining({
        propertyKind: "hotel",
        timezone: "Africa/Lagos",
      }),
      expectedVersion: 3,
    });
    expect(mockInvoke.mock.calls[1][1].body).toEqual({
      action: "publish_stay",
      venueId: "venue-1",
      payload: {},
      expectedVersion: 5,
    });
  });

  it("surfaces the server's stable publish code without leaking response detail", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({
            code: "paid_currency_not_ready",
            detail: "private-provider-detail",
          }),
          { status: 409 },
        ),
      },
    });

    await expect(
      publishStay({ venueId: "venue-1", expectedVersion: 5 }),
    ).rejects.toThrow("paid_currency_not_ready");
  });
});
