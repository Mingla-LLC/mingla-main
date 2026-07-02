/**
 * ORCH-1254 (reviewer setSession brands-load race) — HAPPY-PATH regression.
 *
 * The App-Review account (appreview@usemingla.com) signs in via a UNIQUE path:
 * AuthContext.verifyEmailOtp calls the `reviewer-signin` edge fn, gets
 * {access_token, refresh_token}, and calls `supabase.auth.setSession(...)`.
 * Google/OAuth NEVER uses setSession. supabase-js has NOT necessarily finished
 * propagating the just-set session to the LOCAL `getSession()` read by the time
 * the app navigates to the dashboard and fires `getBrands` — whose getSession()
 * precheck THROWS BrandsAuthSessionNotAttachedError. React Query caches that error
 * → "Couldn't load your brands." Server/token/RLS/data are all proven healthy (a
 * live reviewer token loads 2 brands via HTTP 200); the failure is purely the
 * client attach-timing on the setSession path.
 *
 * REVISED (ORCH-1254 auth-lock deadlock): on-device runtime diagnostics proved the
 * TRUE root cause is a GoTrue AUTH-LOCK DEADLOCK, not a token-attach timing race —
 * `supabase.auth.getSession()` in the getBrands precheck HANGS to its 5s timeout
 * because the onAuthStateChange callback holds the auth lock across its awaits. The
 * original ORCH-1254 "Part A" cure (polling getSession() after setSession) actually
 * CONTENDED that lock and worsened the hang, so it was removed; the real cure lives
 * in AuthContext.authLockDeadlock.orch1254.test.ts (deferring the callback's
 * Supabase side-effects out of the lock via setTimeout).
 *
 * This file now proves the surviving halves at the unit level:
 *   PART A (util contract, still used by useBrands): awaitSessionAttached resolves
 *     only once getSession() reports a token — the cold-start settle gate useBrands
 *     still relies on (this is NOT the reviewer branch anymore).
 *   PART B (resilient defense-in-depth): a React Query brands read that throws
 *     BrandsAuthSessionNotAttachedError on the first attempt(s) RETRIES (scoped to
 *     that transient) and ultimately SUCCEEDS with the 2 brands.
 *   REVISED wiring guard: the reviewer branch NO LONGER polls getSession() after
 *     setSession (the harmful poll + its import/constant are gone).
 *
 * fails-on-revert: see ORCH-1254 test report line in the PR body.
 */
/* eslint-disable import/first */
import { readFileSync } from "fs";
import path from "path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

// useBrands imports AuthContext + supabase + brandsService, all of which pull in
// untransformed react-native ESM (brandsService → appsFlyerService → react-native).
// Stub the module graph exactly as the ORCH-1249 cold-start test does. We DO mock
// brandsService, but the mock re-exports a REAL BrandsAuthSessionNotAttachedError
// subclass so that useBrands' `instanceof BrandsAuthSessionNotAttachedError` retry
// predicate and this test's thrown error reference the SAME class (instanceof holds
// end-to-end). This is behaviorally faithful: the predicate matches the exact error
// getBrands throws.
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

import { awaitSessionAttached } from "../../utils/authReadyGate";
import { BrandsAuthSessionNotAttachedError } from "../../services/brandsService";
import {
  NOT_ATTACHED_RETRY_MAX,
  retryOnAuthNotAttached,
  retryDelayForAuthNotAttached,
} from "../useBrands";

describe("ORCH-1254 PART A — reviewer branch WAITS for the setSession token to attach", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("does NOT resolve until getSession() reports the just-set token (reproduces the race)", async () => {
    // Model supabase-js NOT having propagated setSession()'s token yet: the first
    // two local getSession() reads return no session, the third returns the token.
    let call = 0;
    const getSession = jest.fn(async () => {
      call += 1;
      if (call < 3) return { data: { session: null } };
      return { data: { session: { access_token: "attached-jwt" } } };
    });

    let resolved = false;
    const p = awaitSessionAttached(getSession).then(() => {
      resolved = true;
    });

    // Before the token attaches the reviewer branch must NOT have returned
    // success — i.e. the app has NOT navigated into a brand-less dashboard.
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Advance past the poll interval a couple of times so the 3rd getSession()
    // (which reports the token) runs — THEN it resolves.
    await jest.advanceTimersByTimeAsync(500);
    await p;
    expect(resolved).toBe(true);
    expect(getSession.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ORCH-1254 PART B — useBrands retries the not-attached transient and succeeds", () => {
  test("getBrands throwing BrandsAuthSessionNotAttachedError then succeeding ultimately loads the brands", async () => {
    const brands = [
      { id: "smoke-rhythm", role: "event_manager" },
      { id: "party-block", role: "brand_owner" },
    ];
    // Fail the first two attempts with the transient not-attached error (the
    // token had not propagated yet), then succeed once it has — exactly the
    // reviewer setSession window.
    let attempt = 0;
    const queryFn = jest.fn(async () => {
      attempt += 1;
      if (attempt < 3) throw new BrandsAuthSessionNotAttachedError();
      return brands;
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const result = await client.fetchQuery({
      queryKey: ["orch1254", "brands"],
      queryFn,
      // The exact production retry policy from useBrands.
      retry: retryOnAuthNotAttached,
      retryDelay: retryDelayForAuthNotAttached,
    });

    expect(result).toEqual(brands);
    // It retried the transient (did not surface the first not-attached error).
    expect(attempt).toBe(3);
    expect(attempt).toBeLessThanOrEqual(NOT_ATTACHED_RETRY_MAX + 1);
  });

  test("the useBrands list query WIRES the not-attached retry predicate (regression guard)", () => {
    // The behavioral test above proves the predicate self-heals; this pins the
    // WIRING so a revert that drops `retry: retryOnAuthNotAttached` from the
    // useBrands query config (the actual production hook) goes RED here.
    const source = readFileSync(
      path.resolve(__dirname, "..", "useBrands.ts"),
      "utf8",
    );
    expect(source).toContain("retry: retryOnAuthNotAttached");
    expect(source).toContain("retryDelay: retryDelayForAuthNotAttached");
  });
});

describe("ORCH-1254 (revised) — the reviewer branch does NOT poll getSession() after setSession (auth-lock deadlock cure)", () => {
  test("AuthContext reviewer branch returns success right after setSession without an inline getSession() poll (the token-attach poll CONTENDED the GoTrue lock and re-created the deadlock)", () => {
    // Runtime diagnostics (on-device) proved the reviewer failure was a GoTrue
    // auth-lock DEADLOCK, not a token-attach timing race: the onAuthStateChange
    // callback held the auth lock across its awaits, so the getBrands getSession()
    // precheck hung to its 5s timeout. Polling getSession() (awaitSessionAttached)
    // right after setSession() — while the SIGNED_IN callback still held the lock —
    // CONTENDED that lock and worsened the hang. The real cure is deferring the
    // callback's Supabase side-effects out of the lock (asserted in
    // AuthContext.authLockDeadlock.orch1254.test.ts). This guards the removal of the
    // harmful poll so it is not re-introduced.
    const source = readFileSync(
      path.resolve(__dirname, "..", "..", "context", "AuthContext.tsx"),
      "utf8",
    );
    // setSession stays (it establishes the reviewer session).
    expect(source).toContain("supabase.auth.setSession({");
    // The harmful token-attach poll after setSession must be GONE.
    expect(source).not.toContain(
      "awaitSessionAttached(() => supabase.auth.getSession()",
    );
    // The now-unused import + constant must be removed with it.
    expect(source).not.toContain(
      'import { awaitSessionAttached } from "../utils/authReadyGate"',
    );
    expect(source).not.toContain("REVIEWER_TOKEN_ATTACH_CAP_MS");
  });
});
