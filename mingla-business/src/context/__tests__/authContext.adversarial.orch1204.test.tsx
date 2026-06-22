/**
 * ORCH-1204 [web-auth-bootstrap-lock] — TESTER adversarial regression test
 * (SPEC §9.b). DIFFERENT AXIS from the implementor's happy-path test.
 *
 * SPEC: /Users/sethogieva/Desktop/mingla-main/Mingla_Artifacts/specs/SPEC_ORCH-1204_web-auth-bootstrap-lock.md
 * Implementor happy-path: ./authContext.sync-hydration.orch1204.test.tsx
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY A DIFFERENT ANGLE
 *
 * The implementor's happy-path test proves the CURE direction (a valid stored
 * session hydrates synchronously → isAuthReady on first paint). It does so by
 * RE-DECLARING readStoredWebSession + the three initializer expressions LOCALLY
 * inside the test and feeding them through the real readiness derivation. That
 * is a fine cure-direction proof, but it does NOT attack the dangerous
 * directions the synchronous hydration could break:
 *
 *   A1 — a synchronously-hydrated session that the SERVER has REVOKED must
 *        still get signed out by the background ORCH-1106 getUser() probe.
 *        The hydration must NOT mask a dead JWT. The probe must fire EXACTLY
 *        once (bootSessionProbedRef) and must NOT live on the timeout path.
 *   A3 — the ORCH-1102 7s hard ceiling firing must NOT clobber a hydrated
 *        user/session (only release `loading`).
 *   A4 — native (Platform.OS !== "web") must NOT synchronously hydrate.
 *   A2 — SSR / no-window must NOT synchronously hydrate (prerender unchanged).
 *
 * This file attacks all four. For the BEHAVIORAL probe-decision angle (A1) it
 * drives the REAL production classifier `classifyBootSessionProbe` from
 * ../../utils/authReadiness (NOT a local re-implementation) so a regression in
 * that decision logic would surface here. For the structural invariants (the
 * timeout branch must NOT probe; the ceiling must NOT clear state; the off-web /
 * no-window guard) it parses the ACTUAL AuthContext.tsx source — and it pins the
 * exact statements that the fix introduced so a revert to useState(null/null/true)
 * goes RED, INDEPENDENTLY of the implementor's file (append-only, no edits there).
 *
 * Runner: mingla-business/jest.config.cjs (node + ts-jest, NO RTL — same
 * constraint the implementor test documents). No React mount; we attack the
 * source + the real pure decision functions.
 * ─────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, it } from "@jest/globals";

import type { Session } from "@supabase/supabase-js";

import {
  classifyBootSessionProbe,
  deriveBusinessAuthStatus,
  hasUsableBusinessSession,
  isBusinessAuthReady,
} from "../../utils/authReadiness";

// Same storage key the production reader uses (AuthContext.tsx).
const WEB_AUTH_STORAGE_KEY = "sb-gqnoajqerqhnvulmnyvv-auth-token";

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

// ─────────────────────────────────────────────────────────────────────
// Test doubles — a controllable localStorage + Platform/window switch so we
// can drive the EXACT production guard `Platform.OS !== "web" ||
// typeof window === "undefined"` from readStoredWebSession (AuthContext.tsx:90).
// We mirror the reader byte-for-byte; the structural assertions below pin the
// production source to this shape so a drift fails.
// ─────────────────────────────────────────────────────────────────────
let mockStore: Record<string, string> = {};
let mockPlatformOS: "web" | "ios" | "android" = "web";
let mockWindowDefined = true;

const readStoredWebSession = (): Session | null => {
  if (mockPlatformOS !== "web" || !mockWindowDefined) return null;
  try {
    const raw = mockStore[WEB_AUTH_STORAGE_KEY] ?? null;
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Session;
    return hasUsableBusinessSession(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
};

// The three lazy useState initializers, reproduced exactly (AuthContext.tsx).
const computeInitialAuthState = (): {
  session: Session | null;
  user: Session["user"] | null;
  loading: boolean;
} => {
  const initialStored = readStoredWebSession();
  return {
    session: initialStored,
    user: initialStored?.user ?? null,
    loading: initialStored === null,
  };
};

const VALID_LOOKING_SESSION = {
  access_token: "locally-valid-but-server-revoked-token",
  refresh_token: "refresh-xyz",
  token_type: "bearer",
  expires_in: 3600,
  // Not yet locally expired — getSession() would deserialize this as truthy.
  expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  user: { id: "user-1204-revoked", email: "revoked@usemingla.com" },
};

// ─────────────────────────────────────────────────────────────────────
// A1 — SERVER-REVOKED stored session must STILL sign out (SC-2).
//
// The dangerous failure mode of synchronous hydration: a stored token that is
// locally-valid but server-revoked hydrates a truthy user on first paint. If
// the hydration "masked" the dead session (skipped or short-circuited the
// ORCH-1106 probe), the user would be stranded on a brand-less shell under a
// dead JWT — the EXACT thing the original ORCH-1106 probe exists to prevent.
//
// We prove two things:
//   (1) BEHAVIOR: the revoked-session error shapes the server returns
//       (401 / 403 / session_not_found / AuthSessionMissingError / bad_jwt)
//       still classify to `invalid_session` via the REAL production classifier
//       — i.e. the sign-out decision is intact AFTER the hydration change.
//   (2) STRUCTURE: the AuthContext source still (a) hydrates a truthy user
//       from the stored session AND (b) keeps the probe under the
//       bootSessionProbedRef one-shot gate in the getSession()-resolved branch
//       AND (c) keeps the timeout branch probe-FREE. A revert that drops the
//       hydration, or a regression that moves/duplicates the probe, fails.
// ─────────────────────────────────────────────────────────────────────
describe("ORCH-1204 A1 — server-revoked hydrated session still signs out (SC-2)", () => {
  it("a hydrated session is a TRUTHY user on first paint (the precondition the probe must then invalidate)", () => {
    mockStore = {};
    mockPlatformOS = "web";
    mockWindowDefined = true;
    mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_LOOKING_SESSION);

    const initial = computeInitialAuthState();
    const authStatus = deriveBusinessAuthStatus({
      authError: null,
      loading: initial.loading,
      session: initial.session,
      user: initial.user,
    });
    // Synchronous hydration DID surface a usable, authed-looking session — so a
    // dead session would now route to Home unless the probe signs it out.
    expect(initial.user?.id).toBe("user-1204-revoked");
    expect(isBusinessAuthReady(authStatus, initial.session)).toBe(true);
  });

  it("EVERY server-revoked probe error shape still classifies to invalid_session (real classifyBootSessionProbe — sign-out decision intact post-hydration)", () => {
    // 401 / 403 — token rejected by the auth server.
    expect(classifyBootSessionProbe({ status: 401 })).toBe("invalid_session");
    expect(classifyBootSessionProbe({ status: 403 })).toBe("invalid_session");
    // session_not_found — revoked / signed-out-elsewhere.
    expect(classifyBootSessionProbe({ code: "session_not_found" })).toBe(
      "invalid_session",
    );
    // AuthSessionMissingError (name + message shapes).
    expect(
      classifyBootSessionProbe({ name: "AuthSessionMissingError" }),
    ).toBe("invalid_session");
    expect(
      classifyBootSessionProbe({ message: "Auth session missing!" }),
    ).toBe("invalid_session");
    // bad_jwt — tampered / expired-server-side token.
    expect(classifyBootSessionProbe({ code: "bad_jwt" })).toBe(
      "invalid_session",
    );
  });

  it("a transient/transport error must FAIL OPEN (keep_session) — hydration must NOT cause a flaky-network sign-out of a real user", () => {
    expect(classifyBootSessionProbe({ name: "AuthRetryableFetchError" })).toBe(
      "keep_session",
    );
    expect(
      classifyBootSessionProbe({ name: "TypeError", message: "Failed to fetch" }),
    ).toBe("keep_session");
    expect(classifyBootSessionProbe({ status: 500 })).toBe("keep_session");
    expect(classifyBootSessionProbe({ status: 429 })).toBe("keep_session");
    expect(classifyBootSessionProbe(null)).toBe("keep_session");
  });

  it("STRUCTURE: hydration is present AND the probe stays one-shot in the getSession-resolved branch AND the timeout branch is probe-FREE (revert-or-move guard)", () => {
    // (a) The fix must hydrate user from the stored session — reverting to
    //     useState(null) for `user` deletes this line and fails.
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /useState<User \| null>\(\(\) => initialStored\?\.user \?\? null\)/,
    );
    // (b) The ORCH-1106 probe must remain guarded by the one-shot ref so the
    //     synchronous hydration cannot make it skip OR double-fire.
    expect(AUTH_CONTEXT_SOURCE).toMatch(/if \(!bootSessionProbedRef\.current\) \{/);
    expect(AUTH_CONTEXT_SOURCE).toMatch(/bootSessionProbedRef\.current = true;/);
    // (c) The probe must call the REAL classifier + sign out on invalid_session.
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /classifyBootSessionProbe\(probeError\) === "invalid_session"/,
    );
    // (d) The bootstrap-TIMEOUT branch must NOT contain an ACTUAL getUser()
    //     probe CALL — a probe there would risk signing out a valid user on a
    //     slow network. We slice the timeout branch up to its `return;` and
    //     assert no `supabase.auth.getUser(` call appears inside it. (The branch
    //     intentionally MENTIONS getUser() in a comment explaining its absence;
    //     we forbid the call form, not the word.)
    const timeoutBranch = AUTH_CONTEXT_SOURCE.match(
      /if \(raceResult === AUTH_BOOTSTRAP_TIMEOUT\) \{[\s\S]*?\n {8}return;\n {6}\}/,
    );
    expect(timeoutBranch).not.toBeNull();
    if (timeoutBranch) {
      expect(timeoutBranch[0]).not.toMatch(/supabase\.auth\.getUser\(/);
      expect(timeoutBranch[0]).not.toMatch(/await\s+supabase\.auth\.getUser/);
      // and it DOES still hydrate the stored web session on timeout.
      expect(timeoutBranch[0]).toMatch(/readStoredWebSession\(\)/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// A3 — the 7s hard ceiling cannot clobber a hydrated user (SC-4).
//
// The ceiling exists to release `loading` so the spinner is never permanent.
// With synchronous hydration, a VALID user is already in state when the ceiling
// fires. The ceiling MUST only set loading=false (+ bootstrapTimedOutRef); it
// MUST NEVER reset user/session to null, or it would log out a hydrated user 7s
// after a clean load. We slice the ceiling callback and prove it.
// ─────────────────────────────────────────────────────────────────────
describe("ORCH-1204 A3 — 7s hard ceiling does not clobber a hydrated user (SC-4)", () => {
  it("the ceiling setTimeout body sets loading=false + bootstrapTimedOutRef but contains NO setUser(null)/setSession(null)", () => {
    const ceiling = AUTH_CONTEXT_SOURCE.match(
      /hardCeilingTimer = setTimeout\(\(\) => \{[\s\S]*?\}, AUTH_RESOLUTION_HARD_CEILING_MS\);/,
    );
    expect(ceiling).not.toBeNull();
    if (ceiling) {
      expect(ceiling[0]).toMatch(/setLoading\(false\)/);
      expect(ceiling[0]).toMatch(/bootstrapTimedOutRef\.current = true/);
      // The clobber guard — neither null-reset may appear in the ceiling body.
      expect(ceiling[0]).not.toMatch(/setUser\(\s*null\s*\)/);
      expect(ceiling[0]).not.toMatch(/setSession\(\s*null\s*\)/);
    }
  });

  it("LOGIC: a hydrated user surviving a loading flip stays authed (deriveBusinessAuthStatus is loading-independent for a usable session+user)", () => {
    mockStore = {};
    mockPlatformOS = "web";
    mockWindowDefined = true;
    mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_LOOKING_SESSION);
    const initial = computeInitialAuthState();

    // Before the ceiling: loading already false from hydration; authed.
    const before = deriveBusinessAuthStatus({
      authError: null,
      loading: initial.loading,
      session: initial.session,
      user: initial.user,
    });
    // After the ceiling forces loading=false (idempotent here) with user/session
    // UNCHANGED (the ceiling never clears them): still authed.
    const after = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: initial.session,
      user: initial.user,
    });
    expect(before).toBe("signed_in_ready");
    expect(after).toBe("signed_in_ready");
    expect(isBusinessAuthReady(after, initial.session)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// A4 — native parity (SC-6): off-web never synchronously hydrates.
// A2 — SSR / no-window (SC-5): prerender never synchronously hydrates.
//
// Both ride the SAME production guard in readStoredWebSession:
//   if (Platform.OS !== "web" || typeof window === "undefined") return null;
// If either disjunct were dropped, native or SSR would start hydrating and
// regress (native byte-identity broken / SSR hydration mismatch #418/#425).
// We drive each disjunct independently AND pin the source guard text.
// ─────────────────────────────────────────────────────────────────────
describe("ORCH-1204 A4/A2 — off-web + SSR never synchronously hydrate (SC-6 / SC-5)", () => {
  it("A4 native (Platform.OS=ios) WITH a stored session → null/null/true (no synchronous hydration; native bootstrap byte-identical)", () => {
    mockStore = {};
    mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_LOOKING_SESSION);
    mockPlatformOS = "ios";
    mockWindowDefined = true;
    const initial = computeInitialAuthState();
    expect(initial.session).toBeNull();
    expect(initial.user).toBeNull();
    expect(initial.loading).toBe(true);
  });

  it("A4 native (Platform.OS=android) WITH a stored session → null/null/true", () => {
    mockStore = {};
    mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_LOOKING_SESSION);
    mockPlatformOS = "android";
    mockWindowDefined = true;
    const initial = computeInitialAuthState();
    expect(initial.session).toBeNull();
    expect(initial.user).toBeNull();
    expect(initial.loading).toBe(true);
  });

  it("A2 SSR (typeof window === undefined) on web WITH a stored session → null/null/true (prerender tree unchanged vs origin/main)", () => {
    mockStore = {};
    mockStore[WEB_AUTH_STORAGE_KEY] = JSON.stringify(VALID_LOOKING_SESSION);
    mockPlatformOS = "web";
    mockWindowDefined = false; // prerender: no window
    const initial = computeInitialAuthState();
    expect(initial.session).toBeNull();
    expect(initial.user).toBeNull();
    expect(initial.loading).toBe(true);
  });

  it("STRUCTURE: readStoredWebSession keeps BOTH guard disjuncts (Platform.OS !== web || typeof window === undefined)", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /if \(Platform\.OS !== "web" \|\| typeof window === "undefined"\) return null;/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// FAILS-ON-REVERT ANCHOR (behavioral-adjacent).
//
// The implementor's T1 re-implements the initializers locally, so reverting the
// production initializers does NOT make T1 go red on its own (only its Surface-B
// source checks do). This anchor closes that gap from a DIFFERENT direction: it
// asserts the production source uses LAZY initializers that DERIVE loading from
// the stored session (loading=false when a session exists). Reverting to
// `useState(true)` deletes the `() => initialStored === null` form and this
// fails — and it fails for a DIFFERENT reason than the implementor's anchors
// (this one ties loading to the stored-session presence explicitly).
// ─────────────────────────────────────────────────────────────────────
describe("ORCH-1204 — fails-on-revert anchor (loading derives from stored session)", () => {
  it("loading uses the lazy `() => initialStored === null` form, NOT useState(true)", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /useState<boolean>\(\(\) => initialStored === null\)/,
    );
    // Negative guard: the bare pre-fix forms must NOT be the initializers.
    // (We assert the lazy session initializer exists; its absence on revert
    // is the red signal.)
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /useState<Session \| null>\(\(\) => initialStored\)/,
    );
  });
});
