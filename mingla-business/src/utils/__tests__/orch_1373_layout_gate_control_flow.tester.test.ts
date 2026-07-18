/**
 * ORCH-1373 [accept-invite-infinite-loader] — TESTER ADVERSARIAL GUARD.
 *
 * ─── A DIFFERENT ANGLE FROM THE IMPLEMENTOR'S TEST ──────────────────────────
 * `orch_1373_auth_route_gate.test.ts` (the implementor's) slices the
 * `redirectToSignIn` expression out of `app/_layout.tsx` and EXECUTES it. That
 * is a real improvement over a predicate unit test — but it verifies the VALUE
 * OF ONE EXPRESSION IN ISOLATION. It is structurally blind to the CONTROL FLOW
 * AROUND that expression, and to whether the text it sliced is even the code
 * that ships.
 *
 * The tester PROVED both blind spots by mutation during the ORCH-1373 retest.
 * Both mutations left the implementor's suite at a FULL GREEN 21/21 while the
 * shipped layout re-introduced P0-1 verbatim:
 *
 *   ORPHAN-1 (control flow) — add an early return ABOVE the gate:
 *       if (user === null && pathname.startsWith("/auth")) {
 *         return <Redirect href="/" />;      // P0-1 is back: ?next= destroyed
 *       }
 *       if (redirectToSignIn) { ... }        // <- the sliced expression, untouched
 *     The slice still evaluates to `false` for /auth, so every assertion passes.
 *     The invitee is still bounced. GREEN SUITE, DEAD FUNNEL — the exact
 *     signature of the bug this ORCH exists to kill.
 *
 *   ORPHAN-2 (slice integrity) — shadow the gate with a block comment:
 *       /* const redirectToSignIn = shouldRedirectToSignInFromRoute({ ...
 *          pathname,  }); *&#47;                 <- the slice matches THIS (first match)
 *       const redirectToSignIn = shouldRedirectToSignInFromRoute({
 *         ... pathname: "/account",          <- route-blind: the REAL shipped gate
 *       });
 *     `String.match()` returns the FIRST occurrence and cannot tell code from a
 *     comment, so the test executes the comment and never sees the real gate.
 *
 * This file closes both holes. It asserts nothing about the expression's value
 * (that is the implementor's job and it is done well) — it asserts the two
 * structural properties that make that value MEAN something:
 *
 *   (1) SLICE INTEGRITY — the gate is declared exactly ONCE, so a slice-and-
 *       execute test cannot be fed a decoy.
 *   (2) CONTROL-FLOW INTEGRITY — no redirect may pre-empt the gate for a
 *       sign-in route. Every `return <Redirect …>` that executes BEFORE the
 *       gate must be guarded by the sign-in-route predicate.
 *
 * Fails-on-revert: verified by re-injecting ORPHAN-1 and ORPHAN-2 (see the QA
 * report). Both are caught here and by nothing else in the repo.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@jest/globals";

const LAYOUT_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "app",
  "_layout.tsx",
);
const LAYOUT_SOURCE = fs.readFileSync(LAYOUT_PATH, "utf8");

/** The gate declaration, exactly as the implementor's test slices it. */
const GATE_DECL_RE = /const redirectToSignIn = shouldRedirectToSignInFromRoute\(/g;
/** The branch the gate drives. */
const GATE_BRANCH = "if (redirectToSignIn) {";

// ─────────────────────────────────────────────────────────────────────────────
// (1) SLICE INTEGRITY — a slice-and-execute test must not be feedable a decoy
// ─────────────────────────────────────────────────────────────────────────────

describe("ORCH-1373 TESTER (1) slice integrity — the gate cannot be shadowed", () => {
  it("ORPHAN-2: `const redirectToSignIn = shouldRedirectToSignInFromRoute(` appears EXACTLY ONCE", () => {
    // If this is ever >1, some other occurrence (a comment, a dead branch, a
    // second declaration) precedes or follows the real gate — and every
    // slice-and-execute test in this repo silently starts testing the wrong
    // text while staying green. `String.match()` takes the FIRST hit and cannot
    // distinguish code from a comment.
    const hits = LAYOUT_SOURCE.match(GATE_DECL_RE) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("the gate branch it drives appears exactly once too", () => {
    const count = LAYOUT_SOURCE.split(GATE_BRANCH).length - 1;
    expect(count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (2) CONTROL-FLOW INTEGRITY — nothing may bounce /auth before the gate runs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every `return <Redirect …>` reachable BEFORE the gate, paired with the
 * condition of its IMMEDIATELY enclosing top-level `if`.
 */
const redirectsBeforeGate = (): { condition: string; snippet: string }[] => {
  const gateIdx = LAYOUT_SOURCE.indexOf(GATE_BRANCH);
  expect(gateIdx).toBeGreaterThan(-1);
  const before = LAYOUT_SOURCE.slice(0, gateIdx);

  const out: { condition: string; snippet: string }[] = [];
  const redirectRe = /return <Redirect\b[^;]*;/g;
  let m: RegExpExecArray | null;
  while ((m = redirectRe.exec(before)) !== null) {
    // Walk back to the nearest enclosing top-level `if (` (2-space indent).
    const head = before.slice(0, m.index);
    const ifIdx = head.lastIndexOf("\n  if (");
    const condition =
      ifIdx === -1
        ? "<UNGUARDED — no enclosing top-level if>"
        : head.slice(ifIdx + "\n  if (".length, head.indexOf(") {", ifIdx));
    out.push({ condition, snippet: m[0] });
  }
  return out;
};

describe("ORCH-1373 TESTER (2) control flow — no redirect may pre-empt the gate", () => {
  it("ORPHAN-1: every redirect BEFORE the gate is guarded by the sign-in-route predicate", () => {
    const found = redirectsBeforeGate();
    // Today: exactly one — the ORCH-1102-W2 ceiling guard at :752, which is
    // correctly gated on `!atSignInRoute && !atSelfAuthRoute`.
    expect(found.length).toBeGreaterThan(0);

    // Any pre-gate redirect that never consults the sign-in-route predicate can
    // bounce /auth before the gate is reached. That re-introduces ORCH-1373
    // P0-1: the invitee at /auth?next=<token> is sent to "/" and the token is
    // DESTROYED — while the gate's own slice-and-execute tests stay green,
    // because the expression they evaluate is never actually reached.
    // Offenders are surfaced in the diff so the failure names the exact branch.
    const offenders = found
      .filter(({ condition }) => !/atSignInRoute|isSignInRoute/.test(condition))
      .map(({ condition, snippet }) => `if (${condition}) => ${snippet}`);

    expect(offenders).toEqual([]);
  });

  it("the ceiling guard specifically still excludes BOTH sign-in and self-auth routes", () => {
    // Pins the one legitimate pre-gate redirect (ORCH-1102-W2 / ORCH-1376).
    // Losing either arm destroys a credential: `/auth` carries ?next=, the
    // self-auth routes carry an invite token / Stripe client_secret.
    expect(LAYOUT_SOURCE).toMatch(
      /if \(authResolutionExpired && !atSignInRoute && !atSelfAuthRoute\) \{/,
    );
  });

  it("atSignInRoute is derived from the real predicate and the LIVE pathname", () => {
    // If this is ever hardcoded, the guard above becomes decorative.
    expect(LAYOUT_SOURCE).toMatch(
      /const atSignInRoute = isSignInRoute\(pathname\);/,
    );
    expect(LAYOUT_SOURCE).toMatch(/const pathname = usePathname\(\);/);
  });
});
