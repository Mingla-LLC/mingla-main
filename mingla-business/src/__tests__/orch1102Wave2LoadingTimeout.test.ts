import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AUTH_RESOLUTION_CEILING_MS,
  isAuthResolutionExpired,
  isWebAuthResolving,
  shouldRedirectToSignIn,
} from "../utils/coldLoadAuthGates";

/**
 * ORCH-1102 Wave 2 — BOUNDED LOADING, never an infinite spinner.
 *
 * Operator intent (Seth, hard rule): a user must NEVER be left hanging. The
 * auth-resolution LOADING gate could DEADLOCK (the ORCH-1100 GoTrue web-lock
 * never releasing), holding the spinner up forever. Baseline only hid this
 * behind the dead-end card ORCH-1102 Wave 1 removed.
 *
 * Wave 2 fix: a bounded wall-clock CEILING on the loading gate. If auth has not
 * resolved within the ceiling, stop spinning and route to the real SIGN-IN
 * screen (treat an unresolvable session as logged-out — the correct non-hanging
 * destination). The ceiling sits well above the normal warm path + the 3s
 * ORCH-0887-A race + the 2.3s ORCH-1100 lock self-heal so it NEVER pre-empts a
 * real (slow) session — no false logged-out flash.
 *
 * Every assertion is written to FAIL ON REVERT:
 *   (1) the pure predicate resolves an unresolvable (never-resolving) session
 *       to SIGN-IN after the ceiling — NOT perpetual loading.
 *   (2) it does NOT fire before the ceiling (slow-but-valid session keeps
 *       loading, then renders — no false flash).
 *   (3) a present user always wins (render the app, never time out a real
 *       session).
 *   (4) AuthContext arms the independent hard-ceiling backstop timer.
 *   (5) _layout.tsx checks the deadline-expired backstop BEFORE the spinner.
 *   (6) index.tsx's boot spinner is bounded by the same ceiling.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");
const businessFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

// ─────────────────────────────────────────────────────────────────────
// (1)+(2)+(3) — pure predicate behaviour (the core guarantee)
// ─────────────────────────────────────────────────────────────────────

describe("ORCH-1102 Wave 2 — isAuthResolutionExpired routes a deadlocked session to sign-in", () => {
  test("a never-resolving session (still resolving past the ceiling, no user) → EXPIRED → routes to sign-in, NOT perpetual loading", () => {
    // The deadlock shape: auth is still 'resolving' (the spinner state) and no
    // user has appeared, and the wall-clock has crossed the ceiling.
    const expired = isAuthResolutionExpired({
      isWeb: true,
      hasUser: false,
      stillResolving: true,
      elapsedMs: AUTH_RESOLUTION_CEILING_MS, // ceiling reached
    });
    expect(expired).toBe(true);

    // CRITICAL: at the same moment, the plain resolving gate would STILL want to
    // show the spinner (loading never flipped). The expired backstop is what
    // breaks the infinite spinner — _layout checks it FIRST.
    const wouldStillSpin = isWebAuthResolving({
      isWeb: true,
      loading: true, // deadlock: loading never resolved
      hasUser: false,
      hasStoredWebSession: true, // stale stored session lingering
    });
    expect(wouldStillSpin).toBe(true);

    // The combined gate decision under deadlock: expired wins → sign-in.
    const finalDestinationIsSignIn = expired; // _layout returns <Redirect href="/"/>
    expect(finalDestinationIsSignIn).toBe(true);
  });

  test("BEFORE the ceiling, a slow-but-valid resolving session is NOT expired (no false logged-out flash)", () => {
    const expiredEarly = isAuthResolutionExpired({
      isWeb: true,
      hasUser: false,
      stillResolving: true,
      elapsedMs: AUTH_RESOLUTION_CEILING_MS - 1, // just under the ceiling
    });
    expect(expiredEarly).toBe(false);

    // Sanity: at 0ms elapsed (fresh mount) it must not fire.
    expect(
      isAuthResolutionExpired({
        isWeb: true,
        hasUser: false,
        stillResolving: true,
        elapsedMs: 0,
      }),
    ).toBe(false);
  });

  test("a present user always wins — a real (even slow) session is NEVER timed out to sign-in", () => {
    expect(
      isAuthResolutionExpired({
        isWeb: true,
        hasUser: true, // session resolved with a user
        stillResolving: true,
        elapsedMs: AUTH_RESOLUTION_CEILING_MS * 10, // long past ceiling
      }),
    ).toBe(false);
  });

  test("a fully-resolved (non-spinning) state never trips the backstop", () => {
    expect(
      isAuthResolutionExpired({
        isWeb: true,
        hasUser: false,
        stillResolving: false, // already resolved (e.g. shouldRedirectToSignIn handles it)
        elapsedMs: AUTH_RESOLUTION_CEILING_MS * 10,
      }),
    ).toBe(false);
  });

  test("native never trips the backstop (web-only; native already resolves)", () => {
    expect(
      isAuthResolutionExpired({
        isWeb: false,
        hasUser: false,
        stillResolving: true,
        elapsedMs: AUTH_RESOLUTION_CEILING_MS * 10,
      }),
    ).toBe(false);
  });

  test("the ceiling is well ABOVE the 3s ORCH-0887-A race + the 2.3s ORCH-1100 lock self-heal so it is a true last-resort backstop", () => {
    // 3000 (race) + 2300 (lock) = 5300; ceiling must exceed that with margin so
    // it never pre-empts a real slow session.
    expect(AUTH_RESOLUTION_CEILING_MS).toBeGreaterThan(5300);
    expect(AUTH_RESOLUTION_CEILING_MS).toBeLessThanOrEqual(8000);
  });

  test("the plain resolving + redirect gates are unchanged (Wave 1 contract preserved)", () => {
    // Logged out, resolved, no stored session → redirect (unchanged).
    expect(
      shouldRedirectToSignIn({
        isWeb: true,
        loading: false,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(true);
    // Warming session → loading (unchanged).
    expect(
      isWebAuthResolving({
        isWeb: true,
        loading: true,
        hasUser: false,
        hasStoredWebSession: false,
      }),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (4) — AuthContext arms the independent hard-ceiling backstop timer
// ─────────────────────────────────────────────────────────────────────

describe("ORCH-1102 Wave 2 — AuthContext.tsx hard-ceiling backstop", () => {
  const auth = businessFile("src/context/AuthContext.tsx");
  const authNoComments = stripComments(auth);

  test("exports AUTH_RESOLUTION_HARD_CEILING_MS in the 6-8s last-resort band", () => {
    const match = auth.match(
      /export const AUTH_RESOLUTION_HARD_CEILING_MS = (\d+);/,
    );
    expect(match).not.toBeNull();
    if (match) {
      const value = Number(match[1]);
      expect(value).toBeGreaterThan(5300);
      expect(value).toBeLessThanOrEqual(8000);
    }
  });

  test("arms an independent web-only setTimeout that force-releases the loading gate (NOT a Promise.race arm the lock can starve)", () => {
    // Web-gated arming.
    expect(authNoComments).toMatch(
      /if \(Platform\.OS === "web"\)\s*\{[\s\S]{0,400}?hardCeilingTimer = setTimeout\(/,
    );
    // Fires setLoading(false) at the ceiling — the spinner can never be permanent.
    expect(authNoComments).toMatch(
      /hardCeilingTimer = setTimeout\([\s\S]{0,500}?setLoading\(false\);[\s\S]{0,200}?\}, AUTH_RESOLUTION_HARD_CEILING_MS\);/,
    );
  });

  test("clears the backstop timer on unmount (no leak)", () => {
    expect(authNoComments).toMatch(
      /if \(hardCeilingTimer !== null\) clearTimeout\(hardCeilingTimer\);/,
    );
  });

  test("the ORCH-0887-A 3s Promise.race is PRESERVED (this is an additive backstop, not a replacement)", () => {
    expect(auth).toMatch(/export const AUTH_BOOTSTRAP_TIMEOUT_MS = 3000;/);
    expect(authNoComments).toMatch(
      /Promise\.race\(\[supabase\.auth\.getSession\(\)/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// (5) — _layout.tsx checks the deadline-expired backstop BEFORE the spinner
// ─────────────────────────────────────────────────────────────────────

describe("ORCH-1102 Wave 2 — _layout.tsx routes a deadlocked gate to sign-in before spinning", () => {
  const layout = businessFile("app/_layout.tsx");
  const layoutNoComments = stripComments(layout);

  test("imports the pure backstop predicate", () => {
    expect(layoutNoComments).toMatch(/isAuthResolutionExpired/);
    expect(layoutNoComments).toMatch(/AUTH_RESOLUTION_CEILING_MS/);
  });

  test("computes authResolutionExpired and returns <Redirect href=\"/\"/> for it BEFORE the AuthResolvingScreen spinner", () => {
    expect(layoutNoComments).toMatch(/const authResolutionExpired =/);
    // [TEST-MOD-APPROVED ORCH-1103] prefix-match (drop the closing paren): the
    // backstop returns are now loop-guarded — `if (authResolutionExpired && !atSignInRoute)`
    // / `if (authResolving && !(atSignInRoute && authResolutionExpired))` — to kill
    // the `/`→`/` self-redirect #185 loop. The invariant this test protects (expired
    // backstop checked BEFORE the spinner) is unchanged; only the condition grew.
    const expiredReturnIdx = layoutNoComments.indexOf("if (authResolutionExpired");
    const spinnerReturnIdx = layoutNoComments.indexOf("if (authResolving");
    expect(expiredReturnIdx).toBeGreaterThan(-1);
    expect(spinnerReturnIdx).toBeGreaterThan(-1);
    // The expired backstop MUST be checked before the spinner return, else the
    // deadlock would still trap the user on the spinner.
    expect(expiredReturnIdx).toBeLessThan(spinnerReturnIdx);
  });

  test("uses a REMOUNT- AND RENDER-LOOP-IMMUNE module-level anchor read AT RENDER TIME (a deadlock remounts the tree AND spins a render loop that clears any per-mount timer)", () => {
    // Module-level monotonic anchor that survives React remounts.
    expect(layoutNoComments).toMatch(/let authResolveStartedAt: number \| null = null;/);
    expect(layoutNoComments).toMatch(/function markAuthResolveStart\(\): void/);
    expect(layoutNoComments).toMatch(/function hasAuthResolutionDeadlinePassed\(\): boolean/);
    // The anchor is stamped at RENDER TIME while resolving with no user (not
    // only in an effect that a remount/render-loop could clear).
    expect(layoutNoComments).toMatch(
      /if \(isWeb && authResolving && user === null\)\s*\{[\s\S]{0,120}?markAuthResolveStart\(\);/,
    );
    // The deadline is computed at RENDER TIME via the pure predicate, reading
    // live wall-clock elapsed since the anchor.
    expect(layoutNoComments).toMatch(/const authResolutionExpired = isAuthResolutionExpired\(\{/);
    expect(layoutNoComments).toMatch(
      /elapsedMs: authResolveStartedAt === null \? 0 : Date\.now\(\) - authResolveStartedAt/,
    );
    // Elapsed check compares wall-clock against the ceiling.
    expect(layoutNoComments).toMatch(
      /Date\.now\(\) - authResolveStartedAt >= AUTH_RESOLUTION_CEILING_MS/,
    );
  });

  test("keeps a wakeup interval for the OPPOSITE case (a quiet deadlock with no render loop) to force a re-render near the ceiling", () => {
    expect(layoutNoComments).toMatch(
      /setInterval\([\s\S]{0,400}?hasAuthResolutionDeadlinePassed\(\)[\s\S]{0,200}?forceDeadlineTick/,
    );
  });

  test("clears the anchor when auth resolves (a later cold load starts a fresh window — no stale carry-over)", () => {
    expect(layoutNoComments).toMatch(/clearAuthResolveStart\(\);/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (6) — index.tsx boot spinner is bounded by the same ceiling
// ─────────────────────────────────────────────────────────────────────

describe("ORCH-1102 Wave 2 — index.tsx boot spinner is bounded", () => {
  const index = businessFile("app/index.tsx");
  const indexNoComments = stripComments(index);

  test("imports the shared ceiling", () => {
    expect(indexNoComments).toMatch(/AUTH_RESOLUTION_CEILING_MS/);
  });

  test("the boot spinner is gated on (loading && !bootDeadlineExpired) so it can never be permanent", () => {
    expect(indexNoComments).toMatch(/if \(loading && !bootDeadlineExpired\)/);
    // After the deadline, with no user, it falls through to BusinessWelcomeScreen.
    expect(indexNoComments).toMatch(/const bootDeadlineExpired = isWeb && hasBootDeadlinePassed\(\);/);
    expect(indexNoComments).toMatch(/BusinessWelcomeScreen/);
  });

  test("uses the same REMOUNT- AND RENDER-LOOP-IMMUNE module-level anchor read at render time as _layout", () => {
    expect(indexNoComments).toMatch(/let bootLoadingStartedAt: number \| null = null;/);
    expect(indexNoComments).toMatch(/function hasBootDeadlinePassed\(\): boolean/);
    expect(indexNoComments).toMatch(/const bootDeadlineExpired = isWeb && hasBootDeadlinePassed\(\);/);
    expect(indexNoComments).toMatch(/setInterval\(/);
    expect(indexNoComments).toMatch(
      /Date\.now\(\) - bootLoadingStartedAt >= AUTH_RESOLUTION_CEILING_MS/,
    );
  });
});
