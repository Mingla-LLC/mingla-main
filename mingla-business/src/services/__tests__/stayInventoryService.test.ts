const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
  },
}));

import {
  bulkCreateStayOfferings,
  createStayOffering,
  resolveStayCurrencyReconciliation,
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
});
