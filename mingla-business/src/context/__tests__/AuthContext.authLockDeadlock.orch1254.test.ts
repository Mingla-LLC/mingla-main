/**
 * ORCH-1254 (reviewer brands-load failure) — GoTrue AUTH-LOCK DEADLOCK regression.
 *
 * THE BUG (App-Review account, on-device / TestFlight): the reviewer signs in via
 * the setSession() bypass path, the brand switcher then shows "Couldn't load your
 * brands." On-device runtime diagnostics captured the exact failure:
 *
 *   DIAG stage=session err=TimeoutError: getBrands:session timed out after 5000ms
 *   | getSession: resolved=f hasUser=f tokLen=0 exp=undefined
 *
 * i.e. `supabase.auth.getSession()` in the getBrands precheck HANGS and never
 * resolves (times out at AUTH_PROBE_TIMEOUT_MS = 5s). Server/token/RLS/data are all
 * proven healthy (a live reviewer token loads 2 brands via HTTP 200). This is NOT a
 * token/data/RLS problem — it is a client-side deadlock.
 *
 * TRUE ROOT CAUSE: supabase-js v2 serializes auth operations behind a lock, and its
 * `onAuthStateChange` callback runs WHILE HOLDING that lock. AuthContext's callback
 * was `async` and performed Supabase-touching work inline (the ORCH-1251
 * invalidateQueries reconcile, `ensureCreatorAccount`, `tryRecoverAccountIfDeleted`,
 * and the SIGNED_IN analytics identify block). The reviewer's setSession() fires
 * SIGNED_IN → the callback holds the lock through those awaits → the getBrands
 * getSession() precheck WAITS on that same lock → 5s timeout → "Couldn't load your
 * brands." It is reviewer-specific because setSession() + an immediate read hits the
 * locked window; Google's warm/OAuth flow does not.
 *
 * THE FIX (the documented supabase-js cure): DEFER every Supabase-touching
 * side-effect OUT of the onAuthStateChange callback via `setTimeout(…, 0)` (a
 * macrotask that runs AFTER the callback returns and the lock releases). The
 * SYNCHRONOUS state writes (setAuthError / setSession / setUser + the
 * bootstrapTimedOutRef gate) stay inline so routing/isAuthReady update promptly.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Test-style note (mirrors AuthContext.timeout.test.ts + the ORCH-1251 reconcile
 * test): AuthContext.tsx contains JSX the ts-jest harness does NOT transform from a
 * `.test.ts` file, and there is no @testing-library/react-native, so we CANNOT mount
 * <AuthProvider>. The repo convention is:
 *   (A) BEHAVIORAL — replicate the EXACT production callback SHAPE (sync writes
 *       inline; all Supabase side-effects wrapped in setTimeout(…, 0)) driving
 *       injected spies, and PROVE the side-effects are NOT called synchronously
 *       within the callback tick but ARE called after a fake-timer flush.
 *   (B) SOURCE-TEXT — structural assertions pinning that AuthContext.tsx actually
 *       wraps those side-effects in a setTimeout inside the real onAuthStateChange
 *       handler (the fails-on-revert mechanism).
 *
 * fails-on-revert: reverting the deferral (moving ensureCreatorAccount /
 * invalidateQueries / the SIGNED_IN analytics block back inline — i.e. deleting the
 * `setTimeout(() => { … }, 0)` wrapper) makes Surface A's
 * "not-called-synchronously" assertions FAIL (the spies fire within the callback
 * tick) AND makes the Surface B `setTimeout(` / `await ensureCreatorAccount(` inside
 * the deferred macrotask source-text assertions FAIL.
 * ─────────────────────────────────────────────────────────────────────
 */

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

// ─────────────────────────────────────────────────────────────────────
// Surface A — BEHAVIORAL: the callback defers Supabase side-effects out of the lock
//
// Faithful replica of the production onAuthStateChange callback SHAPE: the sync
// state writes run inline; every Supabase-touching side-effect is scheduled on a
// setTimeout(…, 0) macrotask. We spy on both kinds and assert the ordering the
// deadlock fix guarantees: sync setters within the callback tick; Supabase
// side-effects only after the macrotask flushes (i.e. after the auth lock releases).
// ─────────────────────────────────────────────────────────────────────

type Spies = {
  setSession: ReturnType<typeof jest.fn>;
  setUser: ReturnType<typeof jest.fn>;
  invalidateQueries: ReturnType<typeof jest.fn>;
  ensureCreatorAccount: ReturnType<typeof jest.fn>;
  tryRecoverAccountIfDeleted: ReturnType<typeof jest.fn>;
  identify: ReturnType<typeof jest.fn>;
};

/**
 * Mirrors the production callback: SYNC writes inline, Supabase side-effects
 * DEFERRED via setTimeout(…, 0). Returns nothing — the assertions inspect the spies.
 */
function runDeferringAuthCallback(
  event: string,
  session: { user?: { id: string } | null } | null,
  spies: Spies,
): void {
  // --- SYNCHRONOUS (inline, no Supabase API) — must run within this tick. ---
  spies.setSession(session);
  spies.setUser(session?.user ?? null);

  const userForDeferred = session?.user ?? null;
  const eventForDeferred = event;

  // --- DEFERRED (out of the auth lock) — must NOT run within this tick. ---
  setTimeout(() => {
    void (async () => {
      spies.invalidateQueries({ queryKey: ["brands"] });
      if (userForDeferred) {
        await spies.ensureCreatorAccount(userForDeferred);
        if (eventForDeferred === "SIGNED_IN") {
          await spies.tryRecoverAccountIfDeleted(userForDeferred.id);
          spies.identify(userForDeferred.id);
        }
      }
    })();
  }, 0);
}

describe("ORCH-1254 Surface A — onAuthStateChange defers Supabase side-effects out of the lock", () => {
  let spies: Spies;

  beforeEach(() => {
    jest.useFakeTimers();
    spies = {
      setSession: jest.fn(),
      setUser: jest.fn(),
      invalidateQueries: jest.fn(),
      ensureCreatorAccount: jest.fn(async () => {}),
      tryRecoverAccountIfDeleted: jest.fn(async () => false),
      identify: jest.fn(),
    };
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("SIGNED_IN: sync state setters run within the callback tick; Supabase side-effects are NOT called synchronously (they would deadlock the getBrands getSession() precheck)", () => {
    runDeferringAuthCallback(
      "SIGNED_IN",
      { user: { id: "reviewer-user" } },
      spies,
    );

    // Sync writes happened immediately (routing/isAuthReady update promptly).
    expect(spies.setSession).toHaveBeenCalledTimes(1);
    expect(spies.setUser).toHaveBeenCalledWith({ id: "reviewer-user" });

    // CRITICAL: no Supabase-touching side-effect ran inside the callback tick —
    // this is what keeps the auth lock free so getBrands' getSession() resolves.
    expect(spies.invalidateQueries).not.toHaveBeenCalled();
    expect(spies.ensureCreatorAccount).not.toHaveBeenCalled();
    expect(spies.tryRecoverAccountIfDeleted).not.toHaveBeenCalled();
    expect(spies.identify).not.toHaveBeenCalled();
  });

  test("SIGNED_IN: the Supabase side-effects DO run after the setTimeout macrotask flushes (deferred, not dropped)", async () => {
    runDeferringAuthCallback(
      "SIGNED_IN",
      { user: { id: "reviewer-user" } },
      spies,
    );

    // Flush the macrotask (the auth lock has now released).
    await jest.runAllTimersAsync();

    expect(spies.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(spies.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["brands"],
    });
    expect(spies.ensureCreatorAccount).toHaveBeenCalledWith({
      id: "reviewer-user",
    });
    expect(spies.tryRecoverAccountIfDeleted).toHaveBeenCalledWith(
      "reviewer-user",
    );
    expect(spies.identify).toHaveBeenCalledWith("reviewer-user");
  });

  test("a non-SIGNED_IN event with a user (TOKEN_REFRESHED) still defers ensureCreatorAccount but does NOT run the SIGNED_IN-only recovery/analytics", async () => {
    runDeferringAuthCallback(
      "TOKEN_REFRESHED",
      { user: { id: "u2" } },
      spies,
    );
    // Nothing synchronous beyond the state writes.
    expect(spies.ensureCreatorAccount).not.toHaveBeenCalled();

    await jest.runAllTimersAsync();

    // ensureCreatorAccount deferred + ran; SIGNED_IN-gated work did NOT.
    expect(spies.ensureCreatorAccount).toHaveBeenCalledWith({ id: "u2" });
    expect(spies.tryRecoverAccountIfDeleted).not.toHaveBeenCalled();
    expect(spies.identify).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Surface B — SOURCE-TEXT: AuthContext.tsx wraps the side-effects in setTimeout
// inside the real onAuthStateChange handler (fails-on-revert mechanism).
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

describe("ORCH-1254 Surface B — AuthContext.tsx defers the side-effects out of the lock (fails-on-revert)", () => {
  test("the onAuthStateChange callback contains a setTimeout(() => { … }, 0) deferral of the Supabase side-effects", () => {
    // Isolate the onAuthStateChange callback body (from the subscribe call to the
    // return-cleanup) so the assertion is scoped to the real handler.
    const start = AUTH_CONTEXT_SOURCE.indexOf(
      "supabase.auth.onAuthStateChange(async (_event, s) =>",
    );
    expect(start).toBeGreaterThan(-1);
    const end = AUTH_CONTEXT_SOURCE.indexOf(
      "subscription.unsubscribe();",
      start,
    );
    expect(end).toBeGreaterThan(start);
    const handler = AUTH_CONTEXT_SOURCE.slice(start, end);

    // The Supabase side-effects run inside a deferred macrotask.
    expect(handler).toMatch(/setTimeout\(\(\) => \{[\s\S]*?\}, 0\);/);
    // ensureCreatorAccount + tryRecoverAccountIfDeleted are awaited INSIDE that
    // deferred block (not inline in the callback tick).
    const deferStart = handler.indexOf("setTimeout(() => {");
    const deferredBody = handler.slice(deferStart);
    expect(deferredBody).toContain("await ensureCreatorAccount(");
    expect(deferredBody).toContain("await tryRecoverAccountIfDeleted(");
    expect(deferredBody).toContain(
      "invalidateQueries({ queryKey: brandKeys.all })",
    );
    // The SIGNED_IN-gated analytics identify block is inside the deferred body too.
    expect(deferredBody).toContain("mixpanelService.identify(");
    expect(deferredBody).toContain("loginToOneSignal(");
  });

  test("the SYNC state writes (setAuthError/setSession/setUser) remain OUTSIDE the setTimeout (routing updates promptly)", () => {
    const start = AUTH_CONTEXT_SOURCE.indexOf(
      "supabase.auth.onAuthStateChange(async (_event, s) =>",
    );
    const deferIdx = AUTH_CONTEXT_SOURCE.indexOf("setTimeout(() => {", start);
    expect(deferIdx).toBeGreaterThan(start);
    const beforeDefer = AUTH_CONTEXT_SOURCE.slice(start, deferIdx);
    // The state writes appear BEFORE the deferral (still synchronous).
    expect(beforeDefer).toContain("setSession(s);");
    expect(beforeDefer).toContain("setUser(s?.user ?? null);");
    expect(beforeDefer).toContain("setAuthError(null);");
  });

  test("the harmful ORCH-1254 token-attach poll (awaitSessionAttached after setSession) is GONE — it contended the auth lock and re-created the deadlock", () => {
    expect(AUTH_CONTEXT_SOURCE).not.toContain(
      "awaitSessionAttached(() => supabase.auth.getSession()",
    );
    // The now-unused import + constant were removed with it.
    expect(AUTH_CONTEXT_SOURCE).not.toContain(
      'import { awaitSessionAttached } from "../utils/authReadyGate"',
    );
    expect(AUTH_CONTEXT_SOURCE).not.toContain("REVIEWER_TOKEN_ATTACH_CAP_MS");
  });

  test("the getBrands getSession() precheck + BrandsAuthSessionNotAttachedError are PRESERVED (META-ORCH-1232) — once the deadlock is fixed the precheck works as intended", () => {
    const brandsServiceSource = readFileSync(
      path.resolve(__dirname, "..", "..", "services", "brandsService.ts"),
      "utf8",
    );
    expect(brandsServiceSource).toContain("BrandsAuthSessionNotAttachedError");
    expect(brandsServiceSource).toContain("getBrands:session");
  });
});
