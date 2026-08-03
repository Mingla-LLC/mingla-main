const invoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

import { stayReservationService } from "../stayReservationService";

describe("stayReservationService", () => {
  beforeEach(() => invoke.mockReset());

  it("quotes a mixed multi-line cart through the one Stay boundary", async () => {
    invoke.mockResolvedValue({
      data: {
        kind: "success",
        requestId: "request-1",
        data: { quoteId: "quote-1", mode: "request", totalMinor: "45000" },
      },
      error: null,
    });
    await expect(
      stayReservationService.quote({
        venueId: "venue-1",
        idempotencyKey: "quote-key-1388",
        lines: [
          {
            kind: "room",
            offeringId: "room-1",
            checkIn: "2026-09-01",
            checkOut: "2026-09-03",
            quantity: 2,
            allocations: [
              { adults: 2, children: 0 },
              { adults: 1, children: 1 },
            ],
          },
          {
            kind: "place",
            offeringId: "place-1",
            placeWindowId: "window-1",
            guests: 4,
          },
        ],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        quoteId: "quote-1",
        mode: "request",
        totalMinor: "45000",
      }),
    );
    expect(invoke).toHaveBeenCalledWith("stay-reservations", {
      body: expect.objectContaining({
        action: "quote",
        expectedVersion: undefined,
      }),
    });
  });

  it("threads optimistic version into whole-group approval", async () => {
    invoke.mockResolvedValue({
      data: {
        kind: "success",
        requestId: "request-2",
        data: { groupId: "group-1", state: "approved_payment_required" },
      },
      error: null,
    });
    await stayReservationService.approveRequest({
      groupId: "group-1",
      idempotencyKey: "approval-key-1388",
      expectedVersion: 4,
    });
    expect(invoke).toHaveBeenCalledWith("stay-reservations", {
      body: {
        action: "approve_request",
        payload: {
          groupId: "group-1",
          idempotencyKey: "approval-key-1388",
        },
        expectedVersion: 4,
      },
    });
  });

  it("throws stable server code instead of returning a false success", async () => {
    invoke.mockResolvedValue({
      data: {
        kind: "error",
        requestId: "request-3",
        code: "stay_inventory_changed",
        message: "stay inventory changed",
      },
      error: null,
    });
    await expect(
      stayReservationService.getGroup("group-1"),
    ).rejects.toMatchObject({
      code: "stay_inventory_changed",
      message: "stay inventory changed",
    });
  });

  it("extracts the server code from a real non-2xx function response", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({
            kind: "error",
            code: "stay_bank_not_ready",
            message: "Add a bank before accepting reservations.",
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          },
        ),
      },
    });

    await expect(
      stayReservationService.getGroup("group-1"),
    ).rejects.toMatchObject({
      code: "stay_bank_not_ready",
      message: "Add a bank before accepting reservations.",
    });
  });
});
