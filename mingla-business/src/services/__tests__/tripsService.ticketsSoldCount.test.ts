/* eslint-disable import/first */
/**
 * ORCH-0947 — getTrip ticketsSoldCount regression.
 *
 * Pins the trip dashboard data contract: getTrip() must fetch the canonical
 * tickets-sold count from biz_trip_tickets_sold and expose it on Trip. RPC
 * errors must throw so the dashboard cannot silently render a fabricated 0.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
  },
}));

import { getTrip } from "../tripsService";

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

function eventRow() {
  return {
    id: "trip-1",
    brand_id: "brand-1",
    title: "Tulum Trip",
    description: null,
    slug: "tulum-trip",
    status: "live",
    visibility: "public",
    published_at: "2026-05-24T00:00:00.000Z",
    timezone: "UTC",
    cover_media_url: null,
    cover_media_type: null,
    theme: { business_trip: { capacity: 55 } },
    event_type: "trip",
    created_at: "2026-05-24T00:00:00.000Z",
    updated_at: "2026-05-24T00:00:00.000Z",
    refund_policy: null,
    booking_deadline: null,
    bookings_closed: false,
    bookings_closed_at: null,
    brands: { slug: "brand-1" },
  };
}

function queryChain(data: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.order = () => chain;
  chain.then = (
    resolve: (value: { data: unknown[]; error: null }) => unknown,
  ) => resolve({ data, error: null });
  return chain;
}

describe("ORCH-0947 — getTrip ticketsSoldCount", () => {
  test("returns ticketsSoldCount from biz_trip_tickets_sold RPC", async () => {
    const eventChain = {
      select: () => eventChain,
      eq: () => eventChain,
      is: () => eventChain,
      maybeSingle: () => Promise.resolve({ data: eventRow(), error: null }),
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventChain;
      return queryChain();
    });
    rpcMock.mockResolvedValueOnce({ data: 55, error: null });

    const trip = await getTrip("trip-1");

    expect(rpcMock).toHaveBeenCalledWith("biz_trip_tickets_sold", {
      p_event_id: "trip-1",
    });
    expect(trip?.ticketsSoldCount).toBe(55);
  });

  test("throws RPC error instead of silently falling back to zero", async () => {
    const eventChain = {
      select: () => eventChain,
      eq: () => eventChain,
      is: () => eventChain,
      maybeSingle: () => Promise.resolve({ data: eventRow(), error: null }),
    };
    const rpcError = { message: "not_authorized" };

    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventChain;
      return queryChain();
    });
    rpcMock.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(getTrip("trip-1")).rejects.toBe(rpcError);
  });
});
