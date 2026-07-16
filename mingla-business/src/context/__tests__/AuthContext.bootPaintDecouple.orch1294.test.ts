/**
 * ORCH-1294 [business boot spinner root cause — first-paint gated behind
 * un-timed network calls] — implementor HAPPY-PATH regression test.
 *
 * THE BUG: in AuthProvider's bootstrap(), the signed-in path awaited a network
 * chain BEFORE the loading gate was released. `getUser()` is bounded
 * (withTimeout), but `ensureCreatorAccount(s.user)` and
 * `tryRecoverAccountIfDeleted(s.user.id)` are UN-TIMED and were still awaited
 * before `setLoading(false)`. On a stalled/proxied network either one hangs →
 * `loading` stays true → deriveBusinessAuthStatus never returns
 * "signed_in_ready" → isAuthReady stays false → the brand-profile spinner
 * (isBrandRouteResolving) freezes and the brand list stays disabled until the 7s
 * hard-ceiling backstop fires.
 *
 * THE FIX (ORCH-1294): release the loading gate immediately after the local
 * getSession() state is applied (for BOTH the signed-in and no-session cases),
 * and move the entire signed-in post-getSession chain — the ref-guarded
 * getUser() probe, ensureCreatorAccount, tryRecoverAccountIfDeleted, and the
 * analytics/identity binds — into a NON-AWAITED background IIFE. The 7s
 * AUTH_LOADING_GATE_RELEASE_BACKSTOP_MS timer remains as defense-in-depth.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Test-style note (mirrors AuthContext.timeout.test.ts /
 * authContext.sync-hydration.orch1204.test.tsx /
 * AuthContext.tokenAttachReconcile.orch1251.test.ts):
 *
 * mingla-business/jest.config.cjs uses `testEnvironment: "node"` +
 * `preset: "ts-jest"` with NO @testing-library/react-native, NO
 * react-test-renderer, NO jsdom. AuthContext.tsx also transitively imports RN /
 * Expo natives that won't load under node/ts-jest, so we CANNOT mount
 * <AuthProvider>. The established repo convention for THIS file is a dual
 * surface:
 *
 *   (A) A PURE-LOGIC behavioral proof: faithfully reproduce the bootstrap
 *       signed-in tail ORDERING (both the fixed and the old buggy order) driven
 *       by a valid session + a NEVER-RESOLVING ensureCreatorAccount/getUser, and
 *       feed the resulting state through the REAL, unchanged readiness
 *       derivation (deriveBusinessAuthStatus → isBusinessAuthReady). This proves
 *       the semantics: the fixed order flips loading=false / isAuthReady=true
 *       WITHOUT the hung promise resolving; the old order leaves loading stuck.
 *
 *   (B) Source-text structural assertions on the ACTUAL AuthContext.tsx
 *       bootstrap body — the fails-on-revert anchor. Reverting the fix (loading
 *       gate released only after the awaited network chain, no background IIFE,
 *       no `const bootUser`) deletes these lines, so Surface B fails.
 *
 * The ADVERSARIAL angles (revoked-session probe still signs out, unmount race,
 * live-fire on a throttled network) are the tester's deliverable — not authored
 * here.
 * ─────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "fs";
import path from "path";

import { afterEach, describe, expect, it } from "@jest/globals";

import type { Session, User } from "@supabase/supabase-js";

import {
  deriveBusinessAuthStatus,
  isBusinessAuthReady,
} from "../../utils/authReadiness";

// ─────────────────────────────────────────────────────────────────────
// Shared fixtures + a minimal auth-state model (session/user/loading — the
// exact three values deriveBusinessAuthStatus consumes).
// ─────────────────────────────────────────────────────────────────────

const VALID_SESSION = {
  access_token: "valid-access-token-1294",
  refresh_token: "refresh-1294",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  user: { id: "user-1294", email: "seth@usemingla.com" },
} as unknown as Session;

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  authError: Error | null;
}

// A promise that NEVER settles — the exact bug shape: an un-timed network call
// (ensureCreatorAccount) hung behind a stalled/proxied connection.
const neverResolves = (): Promise<never> =>
  new Promise<never>(() => {
    /* intentionally never resolves */
  });

// Drain the microtask queue a few times so any synchronously-fired background
// IIFE reaches (and parks on) its first await, without ever settling the hung
// promise.
const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};

// ── FIXED ordering (ORCH-1294) — releases the gate, THEN runs the network
// chain in a non-awaited background IIFE. Byte-mirrors the shipped structure. ──
const runFixedBootstrapTail = async (
  s: Session | null,
  state: AuthState,
  hung: {
    getUser: () => Promise<unknown>;
    ensureCreatorAccount: (u: User) => Promise<unknown>;
    tryRecoverAccountIfDeleted: (id: string) => Promise<unknown>;
  },
): Promise<void> => {
  state.authError = null;
  state.session = s;
  state.user = s?.user ?? null;
  // ORCH-1294 — loading gate released HERE, before any network call, for BOTH
  // the signed-in and no-session cases.
  state.loading = false;
  const bootUser = s?.user ?? null;
  if (bootUser) {
    // NOT awaited — the un-timed network chain runs in the background.
    void (async () => {
      await hung.getUser();
      await hung.ensureCreatorAccount(bootUser);
      await hung.tryRecoverAccountIfDeleted(bootUser.id);
    })();
  }
};

// ── OLD (buggy, pre-ORCH-1294) ordering — awaits the un-timed chain BEFORE
// releasing the gate. Reproduced only to prove the bug shape / contrast. ──
const runOldBootstrapTail = async (
  s: Session | null,
  state: AuthState,
  hung: {
    getUser: () => Promise<unknown>;
    ensureCreatorAccount: (u: User) => Promise<unknown>;
    tryRecoverAccountIfDeleted: (id: string) => Promise<unknown>;
  },
): Promise<void> => {
  state.authError = null;
  state.session = s;
  state.user = s?.user ?? null;
  if (s?.user) {
    // getUser is bounded in prod, but ensureCreatorAccount is UN-TIMED — the old
    // order awaits it here, so a hang never reaches setLoading(false).
    await hung.getUser();
    await hung.ensureCreatorAccount(s.user);
    await hung.tryRecoverAccountIfDeleted(s.user.id);
  }
  state.loading = false; // never reached when the chain hangs
};

describe("ORCH-1294 — boot loading gate released before the un-timed network chain (behavioral)", () => {
  it(
    "FIXED order: valid session + a NEVER-RESOLVING ensureCreatorAccount/getUser → loading flips false and isAuthReady=true WITHOUT the hung promise resolving",
    async () => {
      // Native / no-stored-session cold start: loading starts true.
      const state: AuthState = {
        session: null,
        user: null,
        loading: true,
        authError: null,
      };
      let probeResolved = false;
      let ensureResolved = false;
      let recoverResolved = false;
      const hung = {
        getUser: () => neverResolves().then(() => {
          probeResolved = true;
        }),
        ensureCreatorAccount: () => neverResolves().then(() => {
          ensureResolved = true;
        }),
        tryRecoverAccountIfDeleted: () => neverResolves().then(() => {
          recoverResolved = true;
        }),
      };

      await runFixedBootstrapTail(VALID_SESSION, state, hung);
      await drainMicrotasks();

      // The gate is released off ONE local getSession read — no network settled.
      expect(probeResolved).toBe(false);
      expect(ensureResolved).toBe(false);
      expect(recoverResolved).toBe(false);

      // loading released; the REAL readiness derivation reports ready.
      expect(state.loading).toBe(false);
      const authStatus = deriveBusinessAuthStatus({
        authError: state.authError,
        loading: state.loading,
        session: state.session,
        user: state.user,
      });
      expect(authStatus).toBe("signed_in_ready");
      expect(isBusinessAuthReady(authStatus, state.session)).toBe(true);
    },
    5000,
  );

  it(
    "CONTRAST — the OLD order awaits the hung chain BEFORE setLoading(false) → loading stays true and isAuthReady=false (the freeze this ORCH removes)",
    async () => {
      const state: AuthState = {
        session: null,
        user: null,
        loading: true,
        authError: null,
      };
      const hung = {
        // getUser resolves fine; ensureCreatorAccount is the un-timed hang.
        getUser: () => Promise.resolve({ data: { user: VALID_SESSION.user }, error: null }),
        ensureCreatorAccount: () => neverResolves(),
        tryRecoverAccountIfDeleted: () => Promise.resolve(false),
      };

      // Fire WITHOUT awaiting — the old tail never returns when the chain hangs.
      void runOldBootstrapTail(VALID_SESSION, state, hung);
      await drainMicrotasks();

      // Session/user are applied, but the gate is still stuck behind the hang.
      expect(state.loading).toBe(true);
      const authStatus = deriveBusinessAuthStatus({
        authError: state.authError,
        loading: state.loading,
        session: state.session,
        user: state.user,
      });
      // With loading still true + a usable session/user, status is "refreshing"
      // (NOT signed_in_ready), so isAuthReady is false → the spinner freezes.
      expect(authStatus).toBe("refreshing");
      expect(isBusinessAuthReady(authStatus, state.session)).toBe(false);
    },
    5000,
  );

  it(
    "FIXED order, NO-SESSION case: getSession resolves with no user → loading flips false, no background chain fires, status=signed_out",
    async () => {
      const state: AuthState = {
        session: null,
        user: null,
        loading: true,
        authError: null,
      };
      let anyNetworkFired = false;
      const hung = {
        getUser: () => {
          anyNetworkFired = true;
          return neverResolves();
        },
        ensureCreatorAccount: () => {
          anyNetworkFired = true;
          return neverResolves();
        },
        tryRecoverAccountIfDeleted: () => {
          anyNetworkFired = true;
          return neverResolves();
        },
      };

      await runFixedBootstrapTail(null, state, hung);
      await drainMicrotasks();

      expect(anyNetworkFired).toBe(false); // no user → no signed-in chain
      expect(state.loading).toBe(false);
      const authStatus = deriveBusinessAuthStatus({
        authError: state.authError,
        loading: state.loading,
        session: state.session,
        user: state.user,
      });
      expect(authStatus).toBe("signed_out");
      expect(isBusinessAuthReady(authStatus, state.session)).toBe(false);
    },
    5000,
  );
});

// ─────────────────────────────────────────────────────────────────────
// Surface B — source-text structural assertions (fails-on-revert anchor).
//
// These pin the ORCH-1294 contract to the ACTUAL bootstrap() body in
// AuthContext.tsx: the loading gate is released BEFORE the un-timed network
// chain, which lives in a NON-AWAITED background IIFE. Reverting the fix removes
// the ORCH-1294 comment, the `const bootUser` capture, and the IIFE — and
// restores `await ensureCreatorAccount(...)` ahead of `setLoading(false)` — so
// these assertions fail.
//
// The bootstrap body is sliced OUT of the file (up to the `bootstrap();`
// invocation) so the onAuthStateChange handler's own ensureCreatorAccount /
// setTimeout IIFE (defined AFTER `bootstrap();`) is excluded.
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

const BOOTSTRAP_BODY = AUTH_CONTEXT_SOURCE.slice(
  AUTH_CONTEXT_SOURCE.indexOf("const bootstrap = async () =>"),
  AUTH_CONTEXT_SOURCE.indexOf("bootstrap();"),
);

describe("ORCH-1294 — AuthContext.tsx bootstrap() source-text assertions (fails-on-revert)", () => {
  afterEach(() => {
    /* no shared state */
  });

  it("carries the ORCH-1294 boot-paint-decouple comment explaining WHY the gate is released early", () => {
    expect(BOOTSTRAP_BODY).toMatch(/ORCH-1294 \[boot-paint-decouple\]/);
  });

  it("releases the loading gate and THEN captures bootUser for the background chain (setLoading(false) immediately precedes `const bootUser`)", () => {
    expect(BOOTSTRAP_BODY).toMatch(
      /setLoading\(false\);\s*\n\s*const bootUser = s\?\.user \?\? null;/,
    );
  });

  it("runs the signed-in post-getSession chain in a NON-AWAITED background IIFE (void (async () => { ... })())", () => {
    expect(BOOTSTRAP_BODY).toMatch(/if \(bootUser\) \{[\s\S]*?void \(async \(\) => \{/);
  });

  it("orders the gate-release BEFORE the IIFE, and the IIFE BEFORE every network call (getUser probe / ensureCreatorAccount / tryRecoverAccountIfDeleted)", () => {
    const idxGate = BOOTSTRAP_BODY.indexOf("const bootUser = s?.user ?? null;");
    const idxIIFE = BOOTSTRAP_BODY.indexOf("void (async () => {");
    const idxProbe = BOOTSTRAP_BODY.indexOf("supabase.auth.getUser()");
    const idxEnsure = BOOTSTRAP_BODY.indexOf("await ensureCreatorAccount(");
    const idxRecover = BOOTSTRAP_BODY.indexOf(
      "await tryRecoverAccountIfDeleted(",
    );

    expect(idxGate).toBeGreaterThan(-1);
    expect(idxIIFE).toBeGreaterThan(-1);
    expect(idxProbe).toBeGreaterThan(-1);
    expect(idxEnsure).toBeGreaterThan(-1);
    expect(idxRecover).toBeGreaterThan(-1);

    // gate released → user captured → background IIFE → network chain.
    expect(idxGate).toBeLessThan(idxIIFE);
    expect(idxIIFE).toBeLessThan(idxProbe);
    expect(idxIIFE).toBeLessThan(idxEnsure);
    expect(idxIIFE).toBeLessThan(idxRecover);
  });

  it("does NOT await ANY un-timed network call before the loading gate is released (the exact defect)", () => {
    const idxGate = BOOTSTRAP_BODY.indexOf("const bootUser = s?.user ?? null;");
    expect(idxGate).toBeGreaterThan(-1);
    const beforeGate = BOOTSTRAP_BODY.slice(0, idxGate);
    expect(beforeGate).not.toMatch(/await ensureCreatorAccount\(/);
    expect(beforeGate).not.toMatch(/await tryRecoverAccountIfDeleted\(/);
    expect(beforeGate).not.toMatch(/await withTimeout\(/);
  });

  it("preserves the revoked-session sign-out invariant inside the background chain (signOut + setSession(null)/setUser(null))", () => {
    // The ORCH-1106 probe still positively signs out an invalid session.
    expect(BOOTSTRAP_BODY).toMatch(/await supabase\.auth\.signOut\(\);/);
    expect(BOOTSTRAP_BODY).toMatch(/setSession\(null\);/);
    expect(BOOTSTRAP_BODY).toMatch(/setUser\(null\);/);
    // Probe is still ref-guarded to run at most once per cold start.
    expect(BOOTSTRAP_BODY).toMatch(/if \(!bootSessionProbedRef\.current\) \{/);
  });
});
