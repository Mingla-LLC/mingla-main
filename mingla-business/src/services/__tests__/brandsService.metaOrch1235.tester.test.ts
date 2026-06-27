/* eslint-disable import/first */
// META-ORCH-1235 — ADVERSARIAL tester regression test [TEST-MOD-APPROVED META-ORCH-1235].
//
// Different angle from the implementor's service-only test
// (brandsService.metaOrch1235.test.ts, which asserts getBrand() rejects in
// isolation). THIS test drives getBrand THROUGH a real React Query QueryClient
// configured with the PRODUCTION defaults (networkMode:"always", retry:2,
// capped retryDelay) and proves the END-TO-END gate behavior the user actually
// feels:
//
//   1. A never-settling brand read makes the query reach `isError` in BOUNDED
//      time (not an infinite isPending) — across all retry attempts.
//   2. At that point `isBrandRouteResolving(...)` (the exact predicate
//      brand/[id]/index.tsx uses to gate the full-screen spinner) flips FALSE,
//      so the BrandProfileView Retry branch (`brand===null && isError`) is the
//      one that renders — i.e. the spinner is provably released.
//
// Fails-on-revert: remove the withTimeout wrap from getBrand → the read hangs →
// the query stays isPending / isFetched:false forever → isError never becomes
// true within the deadline → assertion #1 fails (and #2's gate stays "resolving"
// forever, never releasing the spinner).
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const mockFrom = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {},
  },
}));

jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { QueryClient } from "@tanstack/query-core";
import { getBrand } from "../brandsService";
import { DATA_FETCH_TIMEOUT_MS } from "../../utils/withTimeout";
import { isBrandRouteResolving } from "../../utils/coldLoadAuthGates";

const UUID_BRAND = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// A brands by-id read whose terminal .maybeSingle() never settles.
const hangingBrandQuery = () => {
  const builder: Record<string, unknown> = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.is = jest.fn(() => builder);
  builder.maybeSingle = jest.fn(() => new Promise(() => {}));
  return builder;
};

beforeEach(() => {
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => hangingBrandQuery());
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("META-ORCH-1235 (tester) — hung getBrand drives the gate to error+Retry", () => {
  test("the brand detail query reaches isError in bounded time AND the spinner-gate releases", async () => {
    // Mirror the PRODUCTION queryClient defaults that matter for this path:
    // retry:2 (so the failure is bounded after 1+2 attempts) and
    // networkMode:"always" (so navigator.onLine can never pause-stick it).
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          networkMode: "always",
          retry: 2,
          retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 4000),
          // keep test fast/deterministic; production keeps a 5-min staleTime.
          // gcTime:Infinity so the errored query state survives for inspection
          // (gcTime:0 would garbage-collect it the moment fetchQuery settles).
          staleTime: 0,
          gcTime: Infinity,
        },
      },
    });

    const queryKey = ["brands", "detail", UUID_BRAND] as const;
    const observed: { isError: boolean; isFetched: boolean } = {
      isError: false,
      isFetched: false,
    };

    const fetchPromise = client
      .fetchQuery({
        queryKey,
        queryFn: () => getBrand(UUID_BRAND),
        retry: 2,
        retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 4000),
      })
      .catch(() => {
        // fetchQuery rejects after retries exhaust — that IS the bounded failure.
      });

    // Worst case: (1 + 2 retries) × (DATA_FETCH_TIMEOUT_MS + capped backoff).
    // Pump fake timers in slices so each withTimeout rejection AND each React
    // Query retry-backoff timer fires and chains (a single big advance can race
    // ahead of the internally-scheduled retry timers).
    const SLICE = DATA_FETCH_TIMEOUT_MS + 5000;
    for (let i = 0; i < 6; i++) {
      // eslint-disable-next-line no-await-in-loop
      await jest.advanceTimersByTimeAsync(SLICE);
    }
    await fetchPromise;

    const state = client.getQueryState(queryKey);
    observed.isError = state?.status === "error";
    observed.isFetched = (state?.dataUpdateCount ?? 0) + (state?.errorUpdateCount ?? 0) > 0;

    // #1 — bounded failure, not an infinite pending spinner.
    expect(observed.isError).toBe(true);

    // #2 — the exact route gate now RELEASES the full-screen spinner. With the
    // query errored (fetched, not loading), isBrandRouteResolving must be false,
    // so BrandProfileView renders its `brand===null && isError` Retry branch
    // instead of `brand===null && isResolving` (the infinite spinner).
    const resolving = isBrandRouteResolving({
      hasBrandId: true,
      brandIsNull: true, // a timeout returns no brand row
      isAuthReady: true,
      queryIsFetched: observed.isFetched,
      queryIsLoading: state?.fetchStatus === "fetching",
    });
    expect(resolving).toBe(false);
  });
});
