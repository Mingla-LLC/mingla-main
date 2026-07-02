/**
 * ORCH-1251 (biz cold-start brands failure) — ADVERSARIAL regression.
 *
 * Different angle from the happy path: attack the REFETCH-STORM / echo-loop risk.
 * The token-attach reconcile fires on onAuthStateChange events (INITIAL_SESSION /
 * SIGNED_IN / TOKEN_REFRESHED). supabase-js emits TOKEN_REFRESHED periodically for
 * an ALREADY-loaded session (autoRefreshToken rotates the JWT roughly hourly), and
 * re-renders/echoes can re-enter the handler. If the reconcile fired on EVERY such
 * event it would:
 *   - hammer invalidateQueries → a refetch storm (the ORCH-0862 cache-cascade
 *     class of bug), and
 *   - risk the #185 "Maximum update depth" re-render loop the AuthContext comments
 *     warn about.
 *
 * The per-user ref guard (reconciledAuthScopedForUserRef) must make the reconcile
 * fire ONCE per session (keyed on user id). This file proves:
 *   1. A TOKEN_REFRESHED for an ALREADY-reconciled session does NOT re-invalidate.
 *   2. Repeated echoes for the same user are all no-ops after the first.
 *   3. SIGNED_OUT clears the latch so a DIFFERENT user's next sign-in DOES
 *      reconcile again (no cross-user cache bleed, no permanent suppression).
 *
 * These attack the storm/loop risk, NOT the happy path.
 */

import { readFileSync } from "fs";
import path from "path";

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { hasUsableBusinessSession } from "../../utils/authReadiness";

// Canonical auth-scoped key roots declared inline — importing the live factories
// pulls in react-native ESM the ts-jest harness cannot transform (see the
// happy-path file's test-style note).
const BRAND_KEYS_ALL = ["brands"] as const;
const CREATOR_ACCOUNT_KEYS_ALL = ["creator-account"] as const;

type TestSession = {
  access_token?: string | null;
  user?: { id?: string | null };
} | null;

// Verbatim replica of the production reconcile decision (see the happy-path file).
function reconcileAuthScopedOnTokenAttach(
  s: TestSession,
  reconciledRef: { current: string | null },
  queryClient: { invalidateQueries: (arg: { queryKey: readonly unknown[] }) => void },
): boolean {
  if (
    hasUsableBusinessSession(s) &&
    s?.user?.id !== undefined &&
    s.user.id !== null &&
    reconciledRef.current !== s.user.id
  ) {
    reconciledRef.current = s.user.id;
    queryClient.invalidateQueries({ queryKey: BRAND_KEYS_ALL });
    queryClient.invalidateQueries({ queryKey: CREATOR_ACCOUNT_KEYS_ALL });
    return true;
  }
  return false;
}

// Models the SIGNED_OUT branch reset (reconciledAuthScopedForUserRef.current = null).
function resetReconcileOnSignedOut(reconciledRef: { current: string | null }): void {
  reconciledRef.current = null;
}

describe("ORCH-1251 — no refetch storm / echo-loop (adversarial, Surface A)", () => {
  let invalidateSpy: ReturnType<typeof jest.fn>;
  let queryClient: {
    invalidateQueries: (arg: { queryKey: readonly unknown[] }) => void;
  };
  let reconciledRef: { current: string | null };

  beforeEach(() => {
    invalidateSpy = jest.fn();
    queryClient = { invalidateQueries: invalidateSpy };
    reconciledRef = { current: null };
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(
    "a TOKEN_REFRESHED for an ALREADY-reconciled session does NOT re-invalidate (guard works — no storm)",
    () => {
      const user = { id: "user-1" };

      // First token-attach event (cold-start recovery) → reconciles once.
      const first: TestSession = { access_token: "jwt-1", user };
      expect(reconcileAuthScopedOnTokenAttach(first, reconciledRef, queryClient)).toBe(
        true,
      );
      expect(invalidateSpy).toHaveBeenCalledTimes(2); // brands + creator-account

      invalidateSpy.mockClear();

      // Later TOKEN_REFRESHED: same user, freshly rotated JWT — the ordinary
      // hourly refresh, NOT a cold-start transition. MUST be a no-op.
      const rotated: TestSession = { access_token: "jwt-1-rotated", user };
      expect(
        reconcileAuthScopedOnTokenAttach(rotated, reconciledRef, queryClient),
      ).toBe(false);
      expect(invalidateSpy).not.toHaveBeenCalled();
    },
    5000,
  );

  it(
    "many rapid echoes for the same user invalidate AT MOST once (no invalidation storm from re-render echoes)",
    () => {
      const user = { id: "user-echo" };
      for (let i = 0; i < 25; i += 1) {
        const s: TestSession = { access_token: `jwt-${i}`, user };
        reconcileAuthScopedOnTokenAttach(s, reconciledRef, queryClient);
      }
      // 25 echoes → exactly ONE reconcile → exactly 2 invalidate calls total.
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    },
    5000,
  );

  it(
    "SIGNED_OUT clears the latch so a DIFFERENT user's next sign-in reconciles again (no permanent suppression, no cross-user bleed)",
    () => {
      const userA = { id: "user-A" };
      reconcileAuthScopedOnTokenAttach(
        { access_token: "jwt-A", user: userA },
        reconciledRef,
        queryClient,
      );
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
      invalidateSpy.mockClear();

      // Sign out — the SIGNED_OUT branch resets the ref.
      resetReconcileOnSignedOut(reconciledRef);
      expect(reconciledRef.current).toBeNull();

      // A different user signs in → must reconcile (the latch was released).
      const userB = { id: "user-B" };
      expect(
        reconcileAuthScopedOnTokenAttach(
          { access_token: "jwt-B", user: userB },
          reconciledRef,
          queryClient,
        ),
      ).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
      expect(reconciledRef.current).toBe("user-B");
    },
    5000,
  );

  it(
    "even WITHOUT an intervening SIGNED_OUT, a genuine user SWITCH (different id) reconciles the new user (id-keyed guard, not a one-shot boolean)",
    () => {
      reconcileAuthScopedOnTokenAttach(
        { access_token: "jwt-1", user: { id: "user-1" } },
        reconciledRef,
        queryClient,
      );
      invalidateSpy.mockClear();

      // Different id arrives (e.g. account-switch echo) → reconciles the new user.
      expect(
        reconcileAuthScopedOnTokenAttach(
          { access_token: "jwt-2", user: { id: "user-2" } },
          reconciledRef,
          queryClient,
        ),
      ).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    },
    5000,
  );
});

// ─────────────────────────────────────────────────────────────────────
// Surface B — the guard + reset are wired into the real AuthContext handler.
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

describe("ORCH-1251 — storm-guard source-text assertions (adversarial, Surface B)", () => {
  it(
    "the reconcile is guarded by a per-user id ref (NOT a plain boolean one-shot) so user-switch still reconciles while token-rotation does not",
    () => {
      // The guard compares against s.user.id (id-keyed), not a boolean.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /reconciledAuthScopedForUserRef\.current !== s\.user\.id/,
      );
      // Ref declared as string | null (holds the reconciled user id, not a flag).
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /useRef<string \| null>\(null\)/,
      );
    },
    5000,
  );

  it(
    "the SIGNED_OUT branch resets the reconcile latch (so the guard cannot permanently suppress a later real cold-start recovery)",
    () => {
      // The reset lives near the SIGNED_OUT store-clear.
      const signedOutBlock = AUTH_CONTEXT_SOURCE.match(
        /_event === "SIGNED_OUT"[\s\S]{0,900}?reconciledAuthScopedForUserRef\.current = null;/,
      );
      expect(signedOutBlock).not.toBeNull();
    },
    5000,
  );

  it(
    "the reconcile does NOT re-run the SIGNED_IN-only analytics/recovery block (it lives BEFORE the if (s?.user) side-effect block, gated only on the token-attach edge)",
    () => {
      // The reconcile block appears before the `if (s?.user) {` ensureCreatorAccount
      // block, so a passive TOKEN_REFRESHED reconcile never triggers SIGNED_IN
      // analytics (anti-flash preserved, per the ORCH-0887-A/1004 contract).
      const reconcileIdx = AUTH_CONTEXT_SOURCE.indexOf(
        "reconciledAuthScopedForUserRef.current = s.user.id;",
      );
      const signedInGateIdx = AUTH_CONTEXT_SOURCE.indexOf(
        'if (_event === "SIGNED_IN") {',
      );
      expect(reconcileIdx).toBeGreaterThan(-1);
      expect(signedInGateIdx).toBeGreaterThan(-1);
      expect(reconcileIdx).toBeLessThan(signedInGateIdx);
    },
    5000,
  );
});
