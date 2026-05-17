/* eslint-disable import/first */
/**
 * ORCH-0862 / F-2 — implementor happy-path regression test (IM-2).
 *
 * Asserts that `softDeleteBrand` Step 1 uses a date-aware filter
 * (`event_dates!inner` + `.gt("event_dates.end_at", <nowIso>)`) so brands
 * whose only `status='scheduled'` event has a past `end_at` no longer
 * block delete.
 *
 * Pre-fix behaviour: count query found 1 row → returned `{rejected: true,
 * upcomingEventCount: 1}` → BrandDeleteSheet rendered "Cannot delete this
 * brand" terminal step. Symptom B-1 root cause.
 *
 * Post-fix behaviour: date filter excludes past-dated events → count
 * returns 0 → softDeleteBrand proceeds to Step 2 (the UPDATE) → returns
 * `{rejected: false, brandId}`.
 *
 * Fails-on-revert verification: if the `.gt("event_dates.end_at", ...)`
 * filter is removed from the source query, the mock's `.gt` builder
 * function is never called and the assertion `expect(builder.gt).toHaveBeenCalled()`
 * fails. The `event_dates!inner` join is also asserted at the
 * `.select(...)` call site.
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

import { softDeleteBrand } from "../brandsService";

const BRAND_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Mock builder for the events count query (Step 1). Captures the chained
 * filter calls so the test can assert the date filter was applied.
 *
 * Behaviour: returns `count: 0` (simulating a brand whose only blocker is
 * past-dated and therefore excluded by the date filter).
 */
const buildStep1CountBuilder = () => {
  const builder = {
    select: jest.fn((..._args: unknown[]) => builder),
    eq: jest.fn((..._args: unknown[]) => builder),
    in: jest.fn((..._args: unknown[]) => builder),
    is: jest.fn((..._args: unknown[]) => builder),
    gt: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ count: 0, error: null }),
    ),
  };
  return builder;
};

/**
 * Mock builder for the events UPDATE (Step 2). Verifies soft-delete
 * succeeds when Step 1 returns count=0.
 */
const buildStep2UpdateBuilder = () => {
  const builder = {
    update: jest.fn((..._args: unknown[]) => builder),
    eq: jest.fn((..._args: unknown[]) => builder),
    is: jest.fn((..._args: unknown[]) => builder),
    select: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ data: [{ id: BRAND_ID }], error: null }),
    ),
  };
  return builder;
};

/**
 * Mock builder for the creator_accounts cleanup (Step 3) — fire-and-forget.
 */
const buildStep3CleanupBuilder = () => {
  const builder = {
    update: jest.fn((..._args: unknown[]) => builder),
    eq: jest.fn((..._args: unknown[]) =>
      Promise.resolve({ error: null }),
    ),
  };
  return builder;
};

describe("ORCH-0862 F-2 — softDeleteBrand Step 1 uses date-aware filter", () => {
  let step1Builder: ReturnType<typeof buildStep1CountBuilder>;
  let step2Builder: ReturnType<typeof buildStep2UpdateBuilder>;
  let step3Builder: ReturnType<typeof buildStep3CleanupBuilder>;

  beforeEach(() => {
    mockFrom.mockReset();
    step1Builder = buildStep1CountBuilder();
    step2Builder = buildStep2UpdateBuilder();
    step3Builder = buildStep3CleanupBuilder();
    // 1st call → events count (Step 1), 2nd call → brands update (Step 2),
    // 3rd call → creator_accounts cleanup (Step 3).
    mockFrom
      .mockImplementationOnce(() => step1Builder)
      .mockImplementationOnce(() => step2Builder)
      .mockImplementationOnce(() => step3Builder);
  });

  test("happy path: past-dated scheduled event ghost no longer blocks delete", async () => {
    const result = await softDeleteBrand(BRAND_ID);

    expect(result).toEqual({ rejected: false, brandId: BRAND_ID });
  });

  test("Step 1 select includes event_dates!inner(end_at) join", async () => {
    await softDeleteBrand(BRAND_ID);

    // The select() call argument MUST include the inner join on event_dates.
    // If someone reverts F-2, the select string drops `event_dates!inner` and
    // this assertion fails.
    const selectCalls = step1Builder.select.mock.calls;
    expect(selectCalls.length).toBeGreaterThan(0);
    const selectArg = String(selectCalls[0][0]);
    expect(selectArg).toContain("event_dates!inner");
    expect(selectArg).toContain("end_at");
  });

  test("Step 1 chains .gt('event_dates.end_at', <nowIso>) to filter past-dated rows", async () => {
    await softDeleteBrand(BRAND_ID);

    // The fix's critical assertion: the date filter was applied.
    expect(step1Builder.gt).toHaveBeenCalled();
    const gtCalls = step1Builder.gt.mock.calls;
    expect(gtCalls.length).toBeGreaterThan(0);
    expect(gtCalls[0][0]).toBe("event_dates.end_at");
    // The second arg is the ISO timestamp; assert it's a valid ISO 8601 string.
    const nowIsoArg = String(gtCalls[0][1]);
    expect(nowIsoArg).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("Step 1 still filters in() on BRAND_DELETE_BLOCKING_EVENT_STATUSES = [scheduled, live]", async () => {
    await softDeleteBrand(BRAND_ID);

    // Pre-existing contract preserved by F-2 (constant unchanged).
    expect(step1Builder.in).toHaveBeenCalled();
    const inCalls = step1Builder.in.mock.calls;
    expect(inCalls.length).toBeGreaterThan(0);
    expect(inCalls[0][0]).toBe("status");
    const statusList = inCalls[0][1] as readonly string[];
    expect(statusList).toEqual(expect.arrayContaining(["scheduled", "live"]));
  });

  test("Step 1 rejection still fires when count > 0 (a real future event blocks delete)", async () => {
    // Override Step 1 builder to return count=1 (simulating a real future event).
    step1Builder.gt = jest.fn((..._args: unknown[]) =>
      Promise.resolve({ count: 1, error: null }),
    );
    mockFrom.mockReset();
    mockFrom.mockImplementationOnce(() => step1Builder);

    const result = await softDeleteBrand(BRAND_ID);

    expect(result).toEqual({
      rejected: true,
      reason: "upcoming_events",
      upcomingEventCount: 1,
    });
  });
});
