/**
 * ORCH-1106 [native authenticated, no-brand degraded shell] — implementor
 * regression test.
 *
 * Bug: on cold start, `supabase.auth.getSession()` returns a truthy `user`
 * from the cached token WITHOUT server validation. A session killed
 * server-side (revoked / signed-out-elsewhere / password change) whose cached
 * access token has not locally expired deserializes into a truthy user → the
 * app routes to Home, the brand list comes back empty under the dead JWT, and
 * the user is stranded on a brand-less degraded shell (NO `SIGNED_OUT` fires).
 *
 * Fix: AuthContext performs ONE authenticated `getUser()` probe after a
 * locally-trusted session and signs out ONLY on a positively-identified auth
 * error — never on a transport failure, and never keyed off empty brand data.
 *
 * This file proves the load-bearing classifier (`classifyBootSessionProbe`)
 * AND the AuthContext wiring via source-text structural assertions (the repo
 * convention for JSX-containing modules — see AuthContext.timeout.test.ts).
 *
 * Fails-on-revert mechanism:
 *   - Surface A: invert the classifier (e.g. sign out on network errors, or
 *     fail to sign out on a 401) and the table assertions fail.
 *   - Surface B: remove the `getUser()` probe / the invalid_session signOut /
 *     the ref guard from AuthContext.tsx and the structural assertions fail.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import { classifyBootSessionProbe } from "../authReadiness";

// ─────────────────────────────────────────────────────────────────────
// Surface A — classifier truth table (the load-bearing decision)
// ─────────────────────────────────────────────────────────────────────

describe("ORCH-1106 — classifyBootSessionProbe (auth-vs-transport)", () => {
  // === MUST sign out: positively-identified invalid sessions ===

  test("401 AuthApiError (token rejected) → invalid_session", () => {
    const err = Object.assign(new Error("invalid claim: missing sub claim"), {
      name: "AuthApiError",
      status: 401,
      code: "bad_jwt",
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("invalid_session");
  });

  test("403 AuthApiError → invalid_session", () => {
    const err = Object.assign(new Error("forbidden"), {
      name: "AuthApiError",
      status: 403,
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("invalid_session");
  });

  test("AuthSessionMissingError → invalid_session", () => {
    const err = Object.assign(new Error("Auth session missing!"), {
      name: "AuthSessionMissingError",
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("invalid_session");
  });

  test("session_not_found code → invalid_session", () => {
    const err = Object.assign(new Error("Session from session_id not found"), {
      name: "AuthApiError",
      status: 404,
      code: "session_not_found",
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("invalid_session");
  });

  test("refresh_token_not_found code → invalid_session", () => {
    const err = Object.assign(new Error("refresh token not found"), {
      name: "AuthApiError",
      status: 400,
      code: "refresh_token_not_found",
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("invalid_session");
  });

  // === MUST keep session: transport / unknown / success ===

  test("null error (probe succeeded — valid session) → keep_session", () => {
    expect(classifyBootSessionProbe(null)).toBe("keep_session");
    expect(classifyBootSessionProbe(undefined)).toBe("keep_session");
  });

  test("AuthRetryableFetchError (offline/5xx/timeout) → keep_session", () => {
    const err = Object.assign(new Error("Failed to fetch"), {
      name: "AuthRetryableFetchError",
      status: 0,
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("keep_session");
  });

  test("503 from auth server (transient) → keep_session", () => {
    const err = Object.assign(new Error("service unavailable"), {
      name: "AuthApiError",
      status: 503,
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("keep_session");
  });

  test("429 rate-limit → keep_session (NOT an invalidation)", () => {
    const err = Object.assign(new Error("rate limit"), {
      name: "AuthApiError",
      status: 429,
      __isAuthError: true,
    });
    expect(classifyBootSessionProbe(err)).toBe("keep_session");
  });

  test("plain network TypeError → keep_session", () => {
    const err = new TypeError("Network request failed");
    expect(classifyBootSessionProbe(err)).toBe("keep_session");
  });

  test("unknown / unrecognized error shape → keep_session (fail-open)", () => {
    expect(classifyBootSessionProbe(new Error("something weird"))).toBe(
      "keep_session",
    );
    expect(classifyBootSessionProbe("a string error")).toBe("keep_session");
    expect(classifyBootSessionProbe({ foo: "bar" })).toBe("keep_session");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Surface B — AuthContext.tsx source-text structural assertions
// (repo convention; fails-on-revert anchor for the wiring)
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "..", "context", "AuthContext.tsx"),
  "utf8",
);

describe("ORCH-1106 — AuthContext.tsx boot-probe wiring (fails-on-revert)", () => {
  test("imports classifyBootSessionProbe", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(/classifyBootSessionProbe/);
  });

  test("declares a once-per-cold-start probe ref", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /const bootSessionProbedRef = useRef\(false\);/,
    );
    // Guard the probe with the ref so it runs at most once (no #185 loop).
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /if \(!bootSessionProbedRef\.current\)\s*\{[\s\S]{0,120}?bootSessionProbedRef\.current = true;/,
    );
  });

  test("performs an authenticated getUser() probe inside the bootstrap user branch", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /await supabase\.auth\.getUser\(\)/,
    );
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /classifyBootSessionProbe\(probeError\) === "invalid_session"/,
    );
  });

  test("signs out + clears user on invalid_session (routes to sign-in)", () => {
    const invalidBranch = AUTH_CONTEXT_SOURCE.match(
      /classifyBootSessionProbe\(probeError\) === "invalid_session"\)\s*\{[\s\S]{0,1500}?return;\s*\}/,
    );
    expect(invalidBranch).not.toBeNull();
    if (invalidBranch) {
      expect(invalidBranch[0]).toMatch(/await supabase\.auth\.signOut\(\)/);
      expect(invalidBranch[0]).toMatch(/setUser\(null\)/);
    }
  });

  test("is NOT gated behind Platform.OS === \"web\" (runs native + web)", () => {
    const lines = AUTH_CONTEXT_SOURCE.split("\n");
    const probeIdx = lines.findIndex((l) =>
      l.includes("await supabase.auth.getUser()"),
    );
    expect(probeIdx).toBeGreaterThan(-1);
    const windowAbove = lines
      .slice(Math.max(0, probeIdx - 12), probeIdx)
      .join("\n");
    expect(windowAbove).not.toMatch(/Platform\.OS\s*===\s*["']web["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Surface C — app/_layout.tsx NATIVE unauth → sign-in route guard.
//
// The boot probe signs the user out, but on native nothing navigated away
// from `(tabs)` (the user stayed on the brand-less shell). _layout.tsx now
// redirects to `/` when bootstrap finished with no user on native — the
// device-proven completion of the fix. Without this, the AuthContext signOut
// fires but the user remains visually stranded.
// ─────────────────────────────────────────────────────────────────────

const ROOT_LAYOUT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "..", "..", "app", "_layout.tsx"),
  "utf8",
);

describe("ORCH-1106 — app/_layout.tsx native unauth redirect (fails-on-revert)", () => {
  test("declares nativeRedirectToSignIn gated on !isWeb + !loading + no user + not on sign-in route", () => {
    expect(ROOT_LAYOUT_SOURCE).toMatch(/const nativeRedirectToSignIn =/);
    const decl = ROOT_LAYOUT_SOURCE.match(
      /const nativeRedirectToSignIn =[\s\S]{0,200}?;/,
    );
    expect(decl).not.toBeNull();
    if (decl) {
      expect(decl[0]).toMatch(/!isWeb/);
      expect(decl[0]).toMatch(/!loading/);
      expect(decl[0]).toMatch(/user === null/);
      expect(decl[0]).toMatch(/!isSignInRoute\(pathname\)/);
    }
  });

  test("renders a Redirect to / when nativeRedirectToSignIn is true", () => {
    const branch = ROOT_LAYOUT_SOURCE.match(
      /if \(nativeRedirectToSignIn\)\s*\{[\s\S]{0,400}?return <Redirect href="\/" \/>;\s*\}/,
    );
    expect(branch).not.toBeNull();
  });
});
