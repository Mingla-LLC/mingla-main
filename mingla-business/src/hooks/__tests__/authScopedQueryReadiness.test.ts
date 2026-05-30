/**
 * ORCH-1004 [Business web data reliability] — Step 0.5 HAPPY-PATH regression
 * test (implementor deliverable).
 *
 * Proves a representative auth-scoped hook (`useTripsByBrand`) is DISABLED
 * (not fetching) when `isAuthReady` is false and ENABLED when it flips true —
 * the exact RC-1/RC-2 fix. When disabled, the hook must read the DISABLED_KEY
 * (so the query reads as loading per I-DISABLED-QUERY-IS-LOADING, ORCH-0889),
 * NOT the live brand-scoped key (which would fire a pre-auth request that RLS
 * returns 200 + [] for and React Query caches as success).
 *
 * Test style: this repo's Jest harness is `testEnvironment: "node"` with no
 * @testing-library/react-native. We use the same manual React-hook harness
 * convention as `useEventCoverVideoUpload.test.ts`: mock `react`, mock
 * `@tanstack/react-query`'s `useQuery` to CAPTURE the options object, mock
 * `useAuth` to drive isAuthReady, and mock the service so no network is
 * touched. This exercises the ACTUAL hook body (not source text), so it is a
 * true behavioral test.
 *
 * Fails-on-revert: ungating the hook (removing `isAuthReady &&` from
 * `enabled`) makes the not-ready case ENABLED + selects the live brand key —
 * both assertions below flip and the test fails. Verified at commit before the
 * fix (see IMPLEMENTATION_ORCH-1004 report §Regression Test).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// ── Capture the options object every useQuery call receives. ────────────────
type CapturedQuery = { queryKey: unknown; enabled: unknown };
const captured: CapturedQuery[] = [];

// Controllable auth state for the mocked useAuth().
let mockIsAuthReady = false;

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: CapturedQuery) => {
    captured.push({ queryKey: options.queryKey, enabled: options.enabled });
    // Return a minimal UseQueryResult-ish object; the hook under test just
    // returns it through, so shape doesn't matter for these assertions.
    return { data: undefined, isLoading: !options.enabled, isError: false };
  },
  useMutation: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
    removeQueries: jest.fn(),
  }),
}));

// Mock useAuth so we control isAuthReady without mounting AuthProvider.
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthReady: mockIsAuthReady,
    loading: !mockIsAuthReady,
    session: mockIsAuthReady ? { access_token: "tok" } : null,
    user: mockIsAuthReady ? { id: "u1" } : null,
  }),
}));

// Mock the trips service so importing useTrips doesn't pull a live supabase
// client / network. getTripsByBrand is the only symbol the hook references at
// call time.
jest.mock("../../services/tripsService", () => ({
  getTripsByBrand: jest.fn(async () => []),
}));

// Mock the keyless upcoming-cache module (imported by useTrips) so it loads
// cleanly under node without dragging in heavy deps.
jest.mock("../upcomingKeys", () => ({
  upcomingKeys: { all: ["upcoming"] },
}));

// Import AFTER mocks are registered.
import { useTripsByBrand, tripKeys } from "../useTrips";

const BRAND_ID = "brand_abc";
const DISABLED_KEY_FIRST = "trips"; // DISABLED_KEY = ["trips", "__disabled__"]
const DISABLED_KEY_SECOND = "__disabled__";

describe("ORCH-1004 — auth-scoped query readiness (useTripsByBrand)", () => {
  beforeEach(() => {
    captured.length = 0;
  });
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("DISABLED + reads DISABLED_KEY when isAuthReady is false (pre-auth fire is prevented)", () => {
    mockIsAuthReady = false;
    useTripsByBrand(BRAND_ID);

    expect(captured).toHaveLength(1);
    const call = captured[0];
    // The gate must hold even though brandId is a valid non-empty string.
    expect(call.enabled).toBe(false);
    // queryKey must be the DISABLED_KEY, NOT the live brand-scoped key — so
    // the query reads as loading, never firing the pre-auth RLS-empty request.
    expect(Array.isArray(call.queryKey)).toBe(true);
    const key = call.queryKey as unknown[];
    expect(key[0]).toBe(DISABLED_KEY_FIRST);
    expect(key[1]).toBe(DISABLED_KEY_SECOND);
  });

  test("ENABLED + reads the live brand-scoped key when isAuthReady is true", () => {
    mockIsAuthReady = true;
    useTripsByBrand(BRAND_ID);

    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call.enabled).toBe(true);
    // queryKey is the live list-by-brand key now that auth is ready.
    expect(call.queryKey).toEqual(tripKeys.listByBrand(BRAND_ID));
  });

  test("still DISABLED when authed but brandId is null (predicate preserved)", () => {
    mockIsAuthReady = true;
    useTripsByBrand(null);

    expect(captured).toHaveLength(1);
    expect(captured[0].enabled).toBe(false);
  });
});
