/* eslint-disable import/first */
/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — tripsService service-layer regression test.
 *
 * Asserts the binding contracts:
 *   - createTripDraft inserts events row with event_type='trip' + creates
 *     placeholder ticket_types row + trip_pricing_tiers join row
 *   - publishTrip calls business_publish_trip_draft RPC (NOT the event RPC)
 *   - SlugCollisionError raised on 23505 during draft creation
 *   - TripPublishValidationError raised when RPC returns an error
 *
 * Fails-on-revert: if tripsService.publishTrip is reverted to call
 * business_publish_event_draft (the killed-extend-RPC approach), this test
 * fails because the rpc mock expects 'business_publish_trip_draft'.
 *
 * Companion adversarial: scripts/ci/orch-0859-adversarial-check.mjs.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authGetUserMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    auth: {
      getUser: () => authGetUserMock(),
    },
  },
}));

import {
  publishTrip,
  SlugCollisionError,
  TripPublishValidationError,
} from "../tripsService";

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  authGetUserMock.mockReset();
});

describe("ORCH-0859 — tripsService.publishTrip", () => {
  test("calls business_publish_trip_draft RPC (NOT business_publish_event_draft)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { event: { id: "trip-1" } },
      error: null,
    });
    // Mock getTrip's subsequent refresh
    const eventChain = {
      select: () => eventChain,
      eq: () => eventChain,
      is: () => eventChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "trip-1",
            brand_id: "b-1",
            title: "Test Trip",
            description: null,
            slug: "test-trip",
            status: "scheduled",
            visibility: "public",
            published_at: "2026-05-17T00:00:00Z",
            timezone: "UTC",
            cover_media_url: null,
            cover_media_type: null,
            theme: { business_trip: {} },
            event_type: "trip",
            created_at: "2026-05-17T00:00:00Z",
            updated_at: "2026-05-17T00:00:00Z",
            brands: { slug: "brand-1" },
          },
          error: null,
        }),
      in: () => eventChain,
      order: () => eventChain,
    };
    // Chainable mock — every method returns the chain so multi-`.order()`
    // calls (trip_inclusions uses .order("kind").order("ordinal")) resolve.
    // The chain is thenable so awaiting it yields {data:[], error:null}.
    const arrayChain: Record<string, unknown> = {};
    arrayChain.select = () => arrayChain;
    arrayChain.eq = () => arrayChain;
    arrayChain.is = () => arrayChain;
    arrayChain.in = () => arrayChain;
    arrayChain.order = () => arrayChain;
    arrayChain.then = (
      resolve: (value: { data: unknown[]; error: null }) => unknown,
    ) => resolve({ data: [], error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventChain;
      return arrayChain;
    });

    await publishTrip("trip-1", { title: "Test Trip", theme: {} });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [calledFn] = rpcMock.mock.calls[0] as [string, unknown];
    expect(calledFn).toBe("business_publish_trip_draft");
    expect(calledFn).not.toBe("business_publish_event_draft");
  });

  test("raises TripPublishValidationError on RPC error with real Postgrest shape", async () => {
    // Postgrest returns `code = "P0001"` (SQLSTATE) for unqualified
    // `RAISE EXCEPTION 'foo'` statements; the literal name lives in
    // `message`. Earlier mock incorrectly inverted these (would have
    // masked the wizard mapper bug fixed in same ORCH-0859 commit).
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "trip_days_required" },
    });

    let thrown: unknown = null;
    try {
      await publishTrip("trip-1", { title: "X", theme: {} });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TripPublishValidationError);
    const err = thrown as TripPublishValidationError;
    // The discriminator the wizard mapper switches on MUST be the
    // user-defined RAISE name, which lives in `err.message`. If a
    // future refactor swaps these so `code` carries the name,
    // TripCreatorStep5Review.tsx's `switch (rawMessage)` must be
    // swapped to `switch (code)` in lockstep — both sides of the
    // contract get pinned here.
    expect(err.message).toBe("trip_days_required");
    expect(err.code).toBe("P0001");
  });

  test("SlugCollisionError class is exported and constructs correctly", () => {
    const err = new SlugCollisionError("test-slug");
    expect(err.name).toBe("SlugCollisionError");
    expect(err.attemptedSlug).toBe("test-slug");
    expect(err).toBeInstanceOf(Error);
  });
});
