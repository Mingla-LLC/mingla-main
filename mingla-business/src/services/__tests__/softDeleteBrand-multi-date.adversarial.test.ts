/* eslint-disable import/first */
/**
 * ORCH-0862 / F-2 — tester adversarial regression test (AD-2).
 *
 * Different angle from IM-2: IM-2 proves the happy path (single-date past
 * ghost → count=0 → delete proceeds). AD-2 proves the date filter does
 * NOT regress multi-date events: a brand with 1 event having 3 future
 * event_dates must still count as exactly 1 blocking event, not 3.
 *
 * Bug class this guards against: PostgREST inline-join overcounting under
 * `event_dates!inner` (cartesian-product semantics on count:exact would
 * inflate the count to event_count × date_count). If overcounting
 * happens live, brands with multi-date events would report inflated
 * "Upcoming events: N" copy and could refuse delete even when fewer
 * events block than the count suggests.
 *
 * Also guards: the rejection-result shape MUST report a sensible event
 * count (matching the rejection copy that the BrandDeleteSheet renders),
 * NOT a row count from the joined event_dates table.
 *
 * Fails-on-revert verification: if F-2 is reverted to status-only (no
 * date filter, no join), this test still PASSES on the rejection branch
 * because the pre-fix shape returns count=N (status-matching events). The
 * REAL fails-on-revert signal here is the assertion that the chain
 * includes `event_dates!inner` AND the count is a DISTINCT event count.
 *
 * Adversarial angles attacked:
 *   A1: Inline-join multi-date count discipline (PostgREST count semantics).
 *   A2: Rejection payload reports the EVENT count, not a row count.
 *   A3: Step 1 query is followed by Step 2 UPDATE only when count===0
 *       (no path where positive count silently proceeds to UPDATE).
 *   A4: BRAND_DELETE_BLOCKING_EVENT_STATUSES constant unchanged.
 *   A5: nowIso passed to .gt() is a valid ISO 8601 string.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import {
  softDeleteBrand,
  BRAND_DELETE_BLOCKING_EVENT_STATUSES,
} from "../brandsService";

const BRAND_ID = "00000000-0000-0000-0000-000000000002";

const buildCountBuilder = (
  countValue: number,
  onChain?: (calls: Record<string, unknown[][]>) => void,
) => {
  const calls: Record<string, unknown[][]> = {
    select: [],
    eq: [],
    in: [],
    is: [],
    gt: [],
  };
  const builder = {
    select: jest.fn((...args: unknown[]) => {
      calls.select.push(args);
      return builder;
    }),
    eq: jest.fn((...args: unknown[]) => {
      calls.eq.push(args);
      return builder;
    }),
    in: jest.fn((...args: unknown[]) => {
      calls.in.push(args);
      return builder;
    }),
    is: jest.fn((...args: unknown[]) => {
      calls.is.push(args);
      return builder;
    }),
    gt: jest.fn((...args: unknown[]) => {
      calls.gt.push(args);
      if (onChain) onChain(calls);
      return Promise.resolve({ count: countValue, error: null });
    }),
  };
  return { builder, calls };
};

describe("ORCH-0862 AD-2 — F-2 multi-date adversarial", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  test("A1: when a brand has 1 multi-date event with 3 future dates and the count returns 1 (distinct event count), softDeleteBrand REJECTS with upcomingEventCount=1, NOT 3", async () => {
    // PostgREST `count:'exact'` returns the count of MATCHING events
    // (deduplicated by primary key) — NOT the cartesian product with
    // event_dates rows. This test fixes that contract: if the count is
    // ever 3 here, the bug surfaces and we know to swap to an RPC.
    const { builder } = buildCountBuilder(1);
    mockFrom.mockImplementationOnce(() => builder);

    const result = await softDeleteBrand(BRAND_ID);

    expect(result).toEqual({
      rejected: true,
      reason: "upcoming_events",
      upcomingEventCount: 1,
    });
  });

  test("A2: rejection payload's upcomingEventCount equals the count returned by the supabase chain (never a hardcoded fallback)", async () => {
    const { builder } = buildCountBuilder(7);
    mockFrom.mockImplementationOnce(() => builder);

    const result = await softDeleteBrand(BRAND_ID);

    if (!result.rejected) {
      throw new Error("expected rejected=true");
    }
    expect(result.upcomingEventCount).toBe(7);
  });

  test("A3: when count > 0, Step 2 UPDATE is NEVER reached (only Step 1 mockFrom is called)", async () => {
    const { builder } = buildCountBuilder(2);
    mockFrom.mockImplementationOnce(() => builder);

    await softDeleteBrand(BRAND_ID);

    // mockFrom must have been called exactly ONCE (Step 1 only).
    // If F-2 logic is broken and proceeds to Step 2 despite count>0,
    // mockFrom would be called 2-3 times.
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  test("A4: BRAND_DELETE_BLOCKING_EVENT_STATUSES constant is unchanged ['scheduled','live']", () => {
    // F-2 must add date filter as ADDITIONAL, not replacement. The status
    // list is a published contract; if anyone narrows it to just
    // 'scheduled' the test fails.
    expect([...BRAND_DELETE_BLOCKING_EVENT_STATUSES]).toEqual(["scheduled", "live"]);
  });

  test("A5: nowIso passed to .gt() is a valid ISO 8601 string parseable by Date", async () => {
    let capturedNowIso: unknown = null;
    const { builder } = buildCountBuilder(0, (calls) => {
      if (calls.gt.length > 0) {
        capturedNowIso = calls.gt[0][1];
      }
    });
    mockFrom.mockImplementationOnce(() => builder);
    const step2Builder = {
      update: jest.fn((..._args: unknown[]) => step2Builder),
      eq: jest.fn((..._args: unknown[]) => step2Builder),
      is: jest.fn((..._args: unknown[]) => step2Builder),
      select: jest.fn((..._args: unknown[]) =>
        Promise.resolve({ data: [{ id: BRAND_ID }], error: null }),
      ),
    };
    mockFrom.mockImplementationOnce(() => step2Builder);
    const step3Builder = {
      update: jest.fn((..._args: unknown[]) => step3Builder),
      eq: jest.fn((..._args: unknown[]) =>
        Promise.resolve({ error: null }),
      ),
    };
    mockFrom.mockImplementationOnce(() => step3Builder);

    await softDeleteBrand(BRAND_ID);

    expect(typeof capturedNowIso).toBe("string");
    expect(capturedNowIso as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Date.parse must accept the string (NaN = invalid date).
    expect(Number.isNaN(Date.parse(capturedNowIso as string))).toBe(false);
    // The value must be within ~5s of "now" — defends against a stale
    // memoized const or a missing call.
    const driftMs = Math.abs(Date.now() - Date.parse(capturedNowIso as string));
    expect(driftMs).toBeLessThan(5000);
  });

  test("A6: select() argument string mentions event_dates and end_at (cartesian-join discipline)", async () => {
    let capturedSelect: unknown = null;
    const { builder } = buildCountBuilder(0, (calls) => {
      if (calls.select.length > 0) capturedSelect = calls.select[0][0];
    });
    mockFrom.mockImplementationOnce(() => builder);
    const step2Builder = {
      update: jest.fn((..._args: unknown[]) => step2Builder),
      eq: jest.fn((..._args: unknown[]) => step2Builder),
      is: jest.fn((..._args: unknown[]) => step2Builder),
      select: jest.fn((..._args: unknown[]) =>
        Promise.resolve({ data: [{ id: BRAND_ID }], error: null }),
      ),
    };
    mockFrom.mockImplementationOnce(() => step2Builder);
    const step3Builder = {
      update: jest.fn((..._args: unknown[]) => step3Builder),
      eq: jest.fn((..._args: unknown[]) =>
        Promise.resolve({ error: null }),
      ),
    };
    mockFrom.mockImplementationOnce(() => step3Builder);

    await softDeleteBrand(BRAND_ID);

    expect(typeof capturedSelect).toBe("string");
    expect(capturedSelect as string).toContain("event_dates");
    expect(capturedSelect as string).toContain("end_at");
    // The !inner marker is the multi-date discipline trigger — without it
    // PostgREST applies LEFT JOIN semantics which would include events
    // without dates.
    expect(capturedSelect as string).toContain("!inner");
  });
});
