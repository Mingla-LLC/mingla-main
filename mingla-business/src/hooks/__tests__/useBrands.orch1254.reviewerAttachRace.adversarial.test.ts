/**
 * ORCH-1254 (reviewer setSession brands-load race) — ADVERSARIAL.
 *
 * Attacks the two risks the fix could introduce:
 *   (i)  A HANG / broken navigation. If the token NEVER attaches within the bound,
 *        the reviewer branch's wait (awaitSessionAttached) must THROW (bounded) so
 *        verifyEmailOtp returns an ERROR — it must NOT hang forever and must NOT
 *        navigate the UI into a brand-less dashboard.
 *   (ii) MASKING a real failure. The Part B retry is SCOPED to the transient
 *        BrandsAuthSessionNotAttachedError. A genuine NON-auth error (e.g. a
 *        network/500 from getBrands) must still surface after the normal policy and
 *        must NOT be swallowed behind an unbounded not-attached retry loop.
 *
 * fails-on-revert: see ORCH-1254 test report line in the PR body.
 */
/* eslint-disable import/first */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

jest.mock("../../services/brandsService", () => ({
  BrandsAuthSessionNotAttachedError: class BrandsAuthSessionNotAttachedError extends Error {
    constructor() {
      super("mock: no authenticated session attached yet");
      this.name = "BrandsAuthSessionNotAttachedError";
    }
  },
  getBrands: jest.fn(),
  createBrand: jest.fn(),
  createVenueBrandPendingReview: jest.fn(),
  getBrand: jest.fn(),
  updateBrand: jest.fn(),
  softDeleteBrand: jest.fn(),
  SlugCollisionError: class SlugCollisionError extends Error {},
  resolveAvailableVenueSlug: jest.fn(),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("../../services/supabase", () => ({
  supabase: {
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: jest.fn(),
  },
}));
jest.mock("../../config/queryClient", () => ({
  queryClient: { getQueryData: jest.fn(), getQueriesData: jest.fn(() => []) },
}));
jest.mock("../useEventOrders", () => ({ eventOrdersKeys: { detail: () => [] } }));
jest.mock("../usePublicEvents", () => ({
  publicEventKeys: { brandBySlug: () => [] },
}));
jest.mock("../useCurrentBrandRole", () => ({
  brandRoleKeys: { allForBrand: () => [] },
}));
jest.mock("../useCreatorAccount", () => ({
  creatorAccountKeys: { byId: () => [] },
}));

import { BrandsAuthSessionNotAttachedError } from "../../services/brandsService";
import {
  awaitSessionAttached,
  isAuthNotReadyError,
} from "../../utils/authReadyGate";
import {
  GENUINE_ERROR_RETRY_MAX,
  retryOnAuthNotAttached,
  retryDelayForAuthNotAttached,
} from "../useBrands";

// Mirrors AuthContext.REVIEWER_TOKEN_ATTACH_CAP_MS (AuthContext is mocked here to
// avoid pulling react-native ESM into the runner). Kept in sync with the source
// constant; the value is not load-bearing for the assertion (we only need "past
// the cap").
const REVIEWER_TOKEN_ATTACH_CAP_MS = 3000;

describe("ORCH-1254 ADVERSARIAL (i) — token never attaches → bounded ERROR, no hang", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("awaitSessionAttached THROWS after the reviewer cap when getSession() never reports a token", async () => {
    // getSession() perpetually reports no attached session — the pathological case.
    const getSession = jest.fn(async () => ({ data: { session: null } }));

    let settled = false;
    let caught: unknown;
    const p = awaitSessionAttached(getSession, {
      capMs: REVIEWER_TOKEN_ATTACH_CAP_MS,
    }).then(
      () => {
        settled = true;
        throw new Error("should NOT resolve — token never attaches");
      },
      (e: unknown) => {
        settled = true;
        caught = e;
      },
    );

    // Before the cap it is still waiting (no premature success, no premature fail).
    await jest.advanceTimersByTimeAsync(REVIEWER_TOKEN_ATTACH_CAP_MS - 200);
    expect(settled).toBe(false);

    // Past the cap it MUST settle to a thrown error → verifyEmailOtp returns an
    // error and the UI stays on the sign-in screen (never a brand-less dashboard).
    await jest.advanceTimersByTimeAsync(600);
    await p;

    expect(settled).toBe(true);
    expect(isAuthNotReadyError(caught)).toBe(true);
  });
});

describe("ORCH-1254 ADVERSARIAL (ii) — a genuine non-auth error is NOT masked by the not-attached retry", () => {
  test("a network/500 error surfaces after the normal policy (not retried as if it were transient)", async () => {
    class NetworkError extends Error {
      constructor() {
        super("500 Internal Server Error");
        this.name = "NetworkError";
      }
    }

    // getBrands ALWAYS fails with a genuine non-auth error. The scoped retry must
    // NOT treat it as the not-attached transient — it surfaces after the normal
    // (ORCH-0964) policy, never an unbounded loop.
    let attempt = 0;
    const queryFn = jest.fn(async () => {
      attempt += 1;
      throw new NetworkError();
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await expect(
      client.fetchQuery({
        queryKey: ["orch1254", "adversarial", "network"],
        queryFn,
        retry: retryOnAuthNotAttached,
        retryDelay: retryDelayForAuthNotAttached,
      }),
    ).rejects.toBeInstanceOf(NetworkError);

    // Bounded to the normal policy (initial attempt + GENUINE_ERROR_RETRY_MAX
    // retries) — the genuine error was NOT masked behind the not-attached budget.
    expect(attempt).toBe(GENUINE_ERROR_RETRY_MAX + 1);
  });

  test("the retry predicate returns false for a non-auth error (scoping is enforced at the predicate)", () => {
    const genuine = new Error("kaboom");
    // Even at failureCount 0 a genuine error only gets the normal budget, and
    // once it exhausts it returns false — never the higher not-attached budget.
    expect(retryOnAuthNotAttached(GENUINE_ERROR_RETRY_MAX, genuine)).toBe(false);
    // The transient DOES keep retrying past the genuine budget (proves the two
    // branches are distinct — the fix is scoped, not a blanket retry).
    expect(
      retryOnAuthNotAttached(
        GENUINE_ERROR_RETRY_MAX,
        new BrandsAuthSessionNotAttachedError(),
      ),
    ).toBe(true);
  });
});
