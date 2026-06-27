/* eslint-disable import/first */
// META-ORCH-1235 — settle-guarantee regression test (I-PROPOSED-1235-A).
// A never-settling Supabase read inside getBrand must REJECT with a TimeoutError
// at DATA_FETCH_TIMEOUT_MS rather than hanging forever (which used to pin the
// BrandProfileView full-screen spinner with no recovery but a page reload).
// Fails-on-revert: drop the withTimeout wrap → getBrand hangs → fake timers
// never produce a rejection → this test fails (times out).
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {},
  },
}));

// appsFlyerService transitively imports react-native — stub it for Node tests.
jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { getBrand } from "../brandsService";
import { isTimeoutError, DATA_FETCH_TIMEOUT_MS } from "../../utils/withTimeout";

const UUID_BRAND = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// brands by-id read: .select("*").eq("id").is("deleted_at").maybeSingle().
// Make .maybeSingle() return a promise that NEVER settles (the hung-read bug).
const hangingBrandQuery = () => {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.is = jest.fn(() => builder);
  // Never resolves nor rejects — simulates a wedged HTTP/2 stream / GoTrue lock.
  builder.maybeSingle = jest.fn(() => new Promise(() => {}));
  return builder;
};

beforeEach(() => {
  mockFrom.mockReset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("getBrand — META-ORCH-1235 settle-guarantee", () => {
  test("REJECTS with a TimeoutError when the brand read never settles (not an infinite spinner)", async () => {
    mockFrom.mockImplementation((table: unknown) => {
      if (table === "brands") return hangingBrandQuery();
      // Any other table must not be reached — the read hangs first.
      return hangingBrandQuery();
    });

    let caught: unknown;
    // Capture the rejection BEFORE advancing timers so it is observed (avoids
    // an unhandled-rejection warning).
    const settled = getBrand(UUID_BRAND).then(
      () => {
        throw new Error("getBrand resolved — expected a TimeoutError rejection");
      },
      (e: unknown) => {
        caught = e;
      },
    );
    // Advance past the data-fetch deadline → the withTimeout race rejects.
    await jest.advanceTimersByTimeAsync(DATA_FETCH_TIMEOUT_MS + 10);
    await settled;
    expect(isTimeoutError(caught)).toBe(true);
  });
});
