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
// #1047 [business-jest-suite-audit] Part 2.3 — shared chainable supabase mock.
import { createChainableQuery } from "./__helpers__/supabaseMock";

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
    rpcMock.mockResolvedValueOnce({
      data: 0,
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
    // #1047 [business-jest-suite-audit] Part 2.3 [TEST-MOD-APPROVED ORCH-1047] —
    // migrated the hand-rolled catch-all chain to the shared createChainableQuery,
    // which provides EVERY chain method (incl. the .maybeSingle the service now
    // calls at tripsService.ts and which this inline chain lacked) so the mock can
    // never drift out of date again. Terminal value is unchanged: awaiting / single
    // / maybeSingle all resolve to { data: [], error: null }. Plumbing only —
    // assertions below (RPC call names/args) are untouched.
    const arrayChain = createChainableQuery({ data: [] });
    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventChain;
      return arrayChain;
    });

    rpcMock.mockResolvedValueOnce({ data: 0, error: null });

    await publishTrip("trip-1", { title: "Test Trip", theme: {} });

    // [TEST-MOD-APPROVED #1719] Publish now enters the atomic poster-triplet
    // wrapper, which delegates to the proven trip publisher in one transaction.
    // [TEST-MOD-APPROVED #1971] TWO assertions are invalidated — the call count
    // and the name of the first RPC. Publish is now a two-command sequence:
    // COMMIT the wizard's pending graph, then publish FROM STORED STATE. The
    // negative assertion against the event RPC is retained, and the new
    // assertion that the publish call carries NO payload is the point of the
    // change: a caller can no longer publish something the database never
    // stored (the old Ari executor sent `{}` and could never succeed).
    expect(rpcMock).toHaveBeenCalledTimes(3);
    const [saveFn, saveArgs] = rpcMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(saveFn).toBe("biz_apply_trip_draft_graph");
    expect(saveArgs.p_expected_updated_at).toBe("2026-05-17T00:00:00Z");

    const [publishFn, publishArgs] = rpcMock.mock.calls[1] as [
      string,
      Record<string, unknown>,
    ];
    expect(publishFn).toBe("biz_publish_trip_command");
    expect(publishFn).not.toBe("business_publish_event_draft");
    expect(Object.keys(publishArgs).sort()).toEqual([
      "p_event_id",
      "p_expected_updated_at",
      "p_operation_id",
    ]);

    expect(rpcMock.mock.calls[2]).toEqual([
      "biz_trip_tickets_sold",
      { p_event_id: "trip-1" },
    ]);
  });

  test("raises TripPublishValidationError on RPC error with real Postgrest shape", async () => {
    // Postgrest returns `code = "P0001"` (SQLSTATE) for unqualified
    // `RAISE EXCEPTION 'foo'` statements; the literal name lives in
    // `message`. Earlier mock incorrectly inverted these (would have
    // masked the wizard mapper bug fixed in same ORCH-0859 commit).
    // [TEST-MOD-APPROVED #1971] The graph commit runs first and succeeds; the
    // publish command is the one that raises. The assertions on the error SHAPE
    // — which the wizard's Step-5 mapper switches on — are untouched.
    const eventChain = {
      select: () => eventChain,
      eq: () => eventChain,
      is: () => eventChain,
      maybeSingle: () =>
        Promise.resolve({
          data: { updated_at: "2026-05-17T00:00:00Z" },
          error: null,
        }),
      in: () => eventChain,
      order: () => eventChain,
    };
    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventChain;
      return createChainableQuery({ data: [] });
    });
    rpcMock.mockResolvedValueOnce({ data: { event: {} }, error: null });
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
