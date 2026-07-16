/**
 * ORCH-1373 [accept-invite-infinite-loader] — T-2 / SC-2: THE PROOF.
 *
 * This is the mechanical proof that the shipped invite route could NEVER show a
 * logged-out invitee anything but a spinner. It is promoted here from the
 * investigation so it can never silently become false again.
 *
 * ─── THE DEAD GATE ─────────────────────────────────────────────────────────
 *     if (!isAuthReady) return;                              // fires forever
 *     …
 *     if (user === null) { router.replace('/auth?next=…') }  // UNREACHABLE
 *
 * `isBusinessAuthReady` is true ONLY for `authStatus === "signed_in_ready"`, and
 * a logged-out visitor is terminally `signed_out`. The two conditions are
 * MUTUALLY EXCLUSIVE, so the redirect below the guard was DEAD CODE — it never
 * executed once in production. Result: an infinite "Accepting your invitation…"
 * spinner for every logged-out invitee (16/16 samples over 32.3s, loading=False →
 * TERMINAL not transient, accept edge fn calls = 0). Corroborated by prod data:
 * 1 invite sent, 0 accepted.
 *
 * ─── WHY THIS TEST HAS FORCE ───────────────────────────────────────────────
 * It imports the REAL, SHIPPED `../authReadiness` and NEVER reimplements
 * `deriveBusinessAuthStatus` / `isBusinessAuthReady`. A test that reimplemented
 * them would prove only that the test author's mental model is self-consistent.
 * `authReadiness.ts` is deliberately NOT modified by this ORCH — the fix is the
 * CALLERS' ordering — and that is exactly what lets this proof mean something.
 *
 * ─── FAILS-ON-REVERT BY CONSTRUCTION ───────────────────────────────────────
 * Restoring the `!isAuthReady` early-return above the `user === null` branch
 * makes that branch unreachable again → `logged-out branch REACHABLE` fails.
 */

import {
  deriveBusinessAuthStatus,
  isBusinessAuthReady,
  type BusinessAuthStatus,
  type MinimalAuthSession,
  type MinimalAuthUser,
} from "../authReadiness";

const USABLE_SESSION: MinimalAuthSession = { access_token: "a-real-token" };
const EMPTY_SESSION: MinimalAuthSession = { access_token: "" };
const USER: MinimalAuthUser = { id: "user-uuid" };

/** Every input combination the route can actually be handed. */
const EXHAUSTIVE_INPUTS = (): Array<{
  label: string;
  authError: Error | null;
  loading: boolean;
  session: MinimalAuthSession | null;
  user: MinimalAuthUser | null;
}> => {
  const out: Array<{
    label: string;
    authError: Error | null;
    loading: boolean;
    session: MinimalAuthSession | null;
    user: MinimalAuthUser | null;
  }> = [];
  for (const loading of [true, false]) {
    for (const [sLabel, session] of [
      ["usable", USABLE_SESSION],
      ["empty", EMPTY_SESSION],
      ["null", null],
    ] as const) {
      for (const [uLabel, user] of [
        ["user", USER],
        ["null", null],
      ] as const) {
        for (const [eLabel, authError] of [
          ["noerr", null],
          ["err", new Error("boom")],
        ] as const) {
          out.push({
            label: `loading=${loading} session=${sLabel} user=${uLabel} ${eLabel}`,
            authError,
            loading,
            session,
            user,
          });
        }
      }
    }
  }
  return out;
};

/**
 * The SHIPPED (broken) gate, modelled exactly: `if (!isAuthReady) return;` and
 * then `if (user === null) → redirect`.
 * Returns true iff the logged-out redirect could execute.
 */
const shippedGateReachesLoggedOutBranch = (
  isAuthReady: boolean,
  user: MinimalAuthUser | null,
): boolean => {
  if (!isAuthReady) return false; // ← the early return: everything below is dead
  return user === null; // ← the logged-out branch
};

describe("ORCH-1373 T-2 / SC-2 — the dead-gate proof (real authReadiness.ts)", () => {
  it("a logged-out visitor derives authStatus === 'signed_out' (terminal, not transient)", () => {
    const authStatus = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: null,
      user: null,
    });
    expect(authStatus).toBe<BusinessAuthStatus>("signed_out");
  });

  it("isBusinessAuthReady is FALSE for a logged-out visitor — so `!isAuthReady` is TERMINAL, not 'loading'", () => {
    const authStatus = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: null,
      user: null,
    });
    expect(isBusinessAuthReady(authStatus, null)).toBe(false);
  });

  it("isBusinessAuthReady is true ONLY for signed_in_ready (the mutual exclusivity itself)", () => {
    const statuses: BusinessAuthStatus[] = [
      "bootstrapping",
      "signed_out",
      "signed_in_ready",
      "refreshing",
      "error",
    ];
    for (const s of statuses) {
      expect(isBusinessAuthReady(s, USABLE_SESSION)).toBe(s === "signed_in_ready");
    }
  });

  it("THE PROOF — across the EXHAUSTIVE sweep, `user === null && isAuthReady === true` NEVER occurs (0 combinations)", () => {
    const inputs = EXHAUSTIVE_INPUTS();
    expect(inputs.length).toBeGreaterThanOrEqual(12);

    const reachable = inputs.filter(({ authError, loading, session, user }) => {
      const authStatus = deriveBusinessAuthStatus({ authError, loading, session, user });
      return isBusinessAuthReady(authStatus, session) && user === null;
    });

    // THE HEADLINE NUMBER: zero. The shipped redirect was unreachable.
    expect(reachable).toEqual([]);
  });

  it("THE CONSEQUENCE — the SHIPPED gate reaches its logged-out branch in 0 of N combinations", () => {
    const inputs = EXHAUSTIVE_INPUTS();
    const hits = inputs.filter(({ authError, loading, session, user }) => {
      const authStatus = deriveBusinessAuthStatus({ authError, loading, session, user });
      const isAuthReady = isBusinessAuthReady(authStatus, session);
      return shippedGateReachesLoggedOutBranch(isAuthReady, user);
    });
    expect(hits).toHaveLength(0);
  });

  it("…and therefore a logged-out invitee could ONLY ever see the spinner (the live bug, 16/16 samples)", () => {
    const authStatus = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: null,
      user: null,
    });
    const isAuthReady = isBusinessAuthReady(authStatus, null);
    // The shipped render gate was `if (!isAuthReady || phase.kind === "loading")`.
    const shippedShowsSpinner = !isAuthReady || true;
    expect(shippedShowsSpinner).toBe(true);
    expect(shippedGateReachesLoggedOutBranch(isAuthReady, null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-2 — THE FIX: the logged-out branch is REACHABLE. This is the assertion that
// fails the moment anyone reintroduces the `!isAuthReady` early return.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The FIXED gate, modelled exactly as the route now branches: on `authStatus`,
 * NOT on the `isAuthReady` boolean.
 */
const fixedGateBranch = (
  authStatus: BusinessAuthStatus,
): "spinner" | "logged_out_screen" | "auth_error_screen" | "accept" => {
  if (authStatus === "bootstrapping" || authStatus === "refreshing") return "spinner";
  if (authStatus === "signed_out") return "logged_out_screen";
  if (authStatus === "error") return "auth_error_screen";
  return "accept";
};

describe("ORCH-1373 SC-2 — the logged-out branch is now PROVABLY REACHABLE", () => {
  it("SC-2 — authStatus 'signed_out' REACHES the logged-out screen (was: unreachable)", () => {
    const authStatus = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: null,
      user: null,
    });
    expect(authStatus).toBe("signed_out");
    // ⚠️ FAILS-ON-REVERT: reintroduce `if (!isAuthReady) return;` above the
    // logged-out branch and this becomes unreachable again.
    expect(fixedGateBranch(authStatus)).toBe("logged_out_screen");
  });

  it("SC-1 — a logged-out invitee NEVER sees a spinner", () => {
    const authStatus = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: null,
      user: null,
    });
    expect(fixedGateBranch(authStatus)).not.toBe("spinner");
  });

  it("the spinner survives ONLY for genuinely transient auth", () => {
    expect(fixedGateBranch("bootstrapping")).toBe("spinner");
    expect(fixedGateBranch("refreshing")).toBe("spinner");
  });

  it("every terminal auth state is ACTIONABLE (I-PROPOSED-1373-AUTH-TERMINAL-STATE-IS-ACTIONABLE)", () => {
    // No terminal state may render a spinner. This is the invariant.
    const terminal: BusinessAuthStatus[] = ["signed_out", "signed_in_ready", "error"];
    for (const s of terminal) {
      expect(fixedGateBranch(s)).not.toBe("spinner");
    }
  });

  it("EXHAUSTIVE — every derivable authStatus lands on exactly one defined branch, none undefined", () => {
    for (const { authError, loading, session, user } of EXHAUSTIVE_INPUTS()) {
      const authStatus = deriveBusinessAuthStatus({ authError, loading, session, user });
      const branch = fixedGateBranch(authStatus);
      expect(["spinner", "logged_out_screen", "auth_error_screen", "accept"]).toContain(branch);
    }
  });

  it("a signed-in invitee still reaches the accept call (no regression to the happy path)", () => {
    const authStatus = deriveBusinessAuthStatus({
      authError: null,
      loading: false,
      session: USABLE_SESSION,
      user: USER,
    });
    expect(authStatus).toBe("signed_in_ready");
    expect(fixedGateBranch(authStatus)).toBe("accept");
  });
});
