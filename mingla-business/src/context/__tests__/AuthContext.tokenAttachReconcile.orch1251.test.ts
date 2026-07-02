/**
 * ORCH-1251 (biz cold-start brands failure) — HAPPY-PATH regression.
 *
 * THE BUG (native iOS / TestFlight): on a COLD start the business app shows
 * "Couldn't load your brands." (BrandSwitcherSheet isError branch). Force-quit +
 * reopen fixes it.
 *
 * TRUE ROOT CAUSE: `isAuthReady` (the React flag useBrands/useCreatorAccount gate
 * on) flips true a BEAT BEFORE the supabase-js client attaches the JWT to outgoing
 * PostgREST requests. The `enabled`-edge refetch (ORCH-1249) can therefore fire in
 * that pre-token window → getBrands THROWS BrandsAuthSessionNotAttachedError →
 * React Query caches isError. When the token ACTUALLY attaches (via
 * onAuthStateChange), the `enabled` flag never transitions again, so nothing
 * refetches and the error persists until a force-quit. Restart cures it because on
 * the 2nd launch AsyncStorage is warm and the token is attached before the query
 * fires.
 *
 * THE FIX (ORCH-1251): drive a refetch/invalidation off the REAL token-attach
 * signal — the supabase `onAuthStateChange` event delivering a USABLE session
 * (INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED) — not the isAuthReady flag. When
 * that fires for a not-yet-reconciled user, invalidate the auth-scoped React Query
 * keys (brandKeys.all + creatorAccountKeys.all) so any query that errored/emptied
 * in the pre-token window re-runs now that the JWT is attached.
 *
 * ─────────────────────────────────────────────────────────────────────
 * Test-style note (mirrors AuthContext.timeout.test.ts):
 *
 * AuthContext.tsx contains JSX which the project's ts-jest config does NOT
 * transform when imported from a `.test.ts` file (the Provider on the last line
 * trips "SyntaxError: Unexpected token '<'"). There is no
 * @testing-library/react-native in this Jest harness, so we CANNOT mount
 * <AuthProvider>. The repo convention (see AuthContext.timeout.test.ts,
 * EventListCard_defensiveFilter.test.tsx) is:
 *
 *   (A) Pure-logic test of the EXACT handler decision — replicate the production
 *       predicate verbatim (hasUsableBusinessSession + the reconciled-per-user
 *       ref guard) driving queryClient.invalidateQueries with the REAL key
 *       factories imported from the source, and SPY on invalidateQueries. This
 *       proves the cold-start ordering: a usable-session event invalidates the
 *       auth-scoped brands + creator-account queries so the read re-runs
 *       post-token.
 *   (B) Source-text structural assertions — confirm AuthContext.tsx wires the
 *       reconcile into the real onAuthStateChange handler. This is the
 *       fails-on-revert mechanism.
 *
 * fails-on-revert VERIFIED at b9ab64e15 (this fix commit): removing the reconcile
 * block from AuthContext.tsx made 4 Surface-B assertions FAIL (the
 * invalidateQueries({ queryKey: brandKeys.all }) / creatorAccountKeys.all
 * source-text checks); restoring the block returned all 17 to PASS.
 * ─────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from "fs";
import path from "path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

import { hasUsableBusinessSession } from "../../utils/authReadiness";

// brandKeys (useBrands) and creatorAccountKeys (useCreatorAccount) both
// transitively import AuthContext → react-native ESM, which this ts-jest harness
// does NOT transform (SyntaxError on the react-native import). We therefore
// declare the two canonical `all` roots inline and assert each matches its
// source-of-truth below (mirrors how AuthContext.timeout.test.ts re-declares
// AUTH_BOOTSTRAP_TIMEOUT_MS inline + regex-checks it against the source).
const BRAND_KEYS_ALL = ["brands"] as const;
const CREATOR_ACCOUNT_KEYS_ALL = ["creator-account"] as const;

// ─────────────────────────────────────────────────────────────────────
// Surface A — token-attach reconcile decision (pure logic)
//
// Replicates the EXACT decision the onAuthStateChange handler makes:
//   if (hasUsableBusinessSession(s) && s?.user?.id !== undefined &&
//       reconciledRef.current !== s.user.id) {
//     reconciledRef.current = s.user.id;
//     queryClient.invalidateQueries({ queryKey: brandKeys.all });
//     queryClient.invalidateQueries({ queryKey: CREATOR_ACCOUNT_KEYS_ALL });
//   }
// ─────────────────────────────────────────────────────────────────────

type TestSession = {
  access_token?: string | null;
  user?: { id?: string | null };
} | null;

/**
 * Same predicate + ref-guard shape as the production handler. Drives an injected
 * queryClient-like spy. Returns whether it invalidated (so the storm/echo guard
 * can be asserted in the adversarial file too).
 */
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

describe("ORCH-1251 — token-attach reconcile decision (Surface A)", () => {
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
    "cold-start ordering: the brands read errored pre-token; then INITIAL_SESSION arrives WITH a usable session → the auth-scoped brands + creator-account queries are invalidated so the read re-runs post-token",
    () => {
      // Simulate the pre-token window: the query already fired + errored while no
      // token was attached. Represented by the ref NOT yet reconciled (null) and
      // a queryClient with a cached error — modeled here as "no invalidation has
      // happened yet".
      expect(invalidateSpy).not.toHaveBeenCalled();

      // Token attaches: onAuthStateChange delivers INITIAL_SESSION with a usable
      // session (real JWT). This is the moment the supabase client holds the token.
      const initialSession: TestSession = {
        access_token: "real.jwt.token",
        user: { id: "user-cold-1" },
      };
      const didReconcile = reconcileAuthScopedOnTokenAttach(
        initialSession,
        reconciledRef,
        queryClient,
      );

      expect(didReconcile).toBe(true);
      // Both auth-scoped roots invalidated → brands + creator-account re-run authed.
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: BRAND_KEYS_ALL });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: CREATOR_ACCOUNT_KEYS_ALL,
      });
      // The reconcile is now recorded for this user (idempotency latch).
      expect(reconciledRef.current).toBe("user-cold-1");
    },
    5000,
  );

  it(
    "SIGNED_IN with a usable session also reconciles (fresh sign-in path, not just cold-restore)",
    () => {
      const signedInSession: TestSession = {
        access_token: "jwt-signin",
        user: { id: "user-signin" },
      };
      const didReconcile = reconcileAuthScopedOnTokenAttach(
        signedInSession,
        reconciledRef,
        queryClient,
      );
      expect(didReconcile).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledTimes(2);
    },
    5000,
  );

  it(
    "an event WITHOUT a usable session (no access_token — the pre-token window itself) does NOT invalidate (there is no token to re-run under)",
    () => {
      const noTokenSession: TestSession = {
        access_token: null,
        user: { id: "user-x" },
      };
      const didReconcile = reconcileAuthScopedOnTokenAttach(
        noTokenSession,
        reconciledRef,
        queryClient,
      );
      expect(didReconcile).toBe(false);
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(reconciledRef.current).toBeNull();
    },
    5000,
  );

  it(
    "the inline key roots match the brandKeys.all / creatorAccountKeys.all source-of-truth (now the standalone keyless modules — guards drift between this test and production)",
    () => {
      // ORCH-1251 — the canonical home for these factories is the standalone
      // keyless modules (./hooks/brandKeys, ./hooks/creatorAccountKeys), extracted
      // to break the require-cycle. Read them directly for the source-of-truth.
      const brandKeysSource = readFileSync(
        path.resolve(__dirname, "..", "..", "hooks", "brandKeys.ts"),
        "utf8",
      );
      const creatorAccountKeysSource = readFileSync(
        path.resolve(__dirname, "..", "..", "hooks", "creatorAccountKeys.ts"),
        "utf8",
      );
      // brandKeys.all = ["brands"] as const;
      expect(brandKeysSource).toMatch(/all:\s*\["brands"\] as const/);
      expect(BRAND_KEYS_ALL).toEqual(["brands"]);
      // creatorAccountKeys.all = ["creator-account"] as const;
      expect(creatorAccountKeysSource).toMatch(
        /all:\s*\["creator-account"\] as const/,
      );
      expect(CREATOR_ACCOUNT_KEYS_ALL).toEqual(["creator-account"]);
      // The hook files still re-export the factories (backward compat).
      const useBrandsSource = readFileSync(
        path.resolve(__dirname, "..", "..", "hooks", "useBrands.ts"),
        "utf8",
      );
      const useCreatorAccountSource = readFileSync(
        path.resolve(__dirname, "..", "..", "hooks", "useCreatorAccount.ts"),
        "utf8",
      );
      expect(useBrandsSource).toMatch(
        /export \{ brandKeys \} from "\.\/brandKeys";/,
      );
      expect(useCreatorAccountSource).toMatch(
        /export \{ creatorAccountKeys \} from "\.\/creatorAccountKeys";/,
      );
    },
    5000,
  );
});

// ─────────────────────────────────────────────────────────────────────
// Surface B — AuthContext.tsx source-text structural assertions
//
// Project convention (AuthContext.timeout.test.ts Surface B). These prove the
// reconcile is wired into the REAL onAuthStateChange handler. Reverting the fix
// (removing the hasUsableBusinessSession-gated invalidateQueries block) makes
// these fail — the fails-on-revert mechanism.
// ─────────────────────────────────────────────────────────────────────

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

describe("ORCH-1251 — AuthContext.tsx source-text assertions (Surface B / fails-on-revert)", () => {
  it(
    "imports the auth-scoped key factories from the STANDALONE keyless modules (NOT the hooks) so no require-cycle is introduced (ORCH-1251 / I-PROPOSED-K)",
    () => {
      // Must import from ./hooks/brandKeys + ./hooks/creatorAccountKeys — the
      // hook files (useBrands / useCreatorAccount) import useAuth from THIS file,
      // so importing the keys from them would create a require-cycle the
      // I-PROPOSED-K gate rejects. The keyless modules import nothing from
      // AuthContext.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /import \{ brandKeys \} from "\.\.\/hooks\/brandKeys";/,
      );
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /import \{ creatorAccountKeys \} from "\.\.\/hooks\/creatorAccountKeys";/,
      );
      // Guard against a regression back to the cyclic hook imports.
      expect(AUTH_CONTEXT_SOURCE).not.toMatch(
        /import \{ brandKeys \} from "\.\.\/hooks\/useBrands";/,
      );
      expect(AUTH_CONTEXT_SOURCE).not.toMatch(
        /import \{ creatorAccountKeys \} from "\.\.\/hooks\/useCreatorAccount";/,
      );
    },
    5000,
  );

  it(
    "declares the per-user reconcile ref (reconciledAuthScopedForUserRef = useRef<string | null>(null))",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /const reconciledAuthScopedForUserRef = useRef<string \| null>\(null\);/,
      );
    },
    5000,
  );

  it(
    "gates the reconcile on hasUsableBusinessSession(s) AND a not-yet-reconciled user id (the token-attach edge, ONCE per session)",
    () => {
      // The gate condition — hasUsableBusinessSession + ref !== s.user.id.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /hasUsableBusinessSession\(s\) &&[\s\S]{0,160}?reconciledAuthScopedForUserRef\.current !== s\.user\.id/,
      );
      // Latches the ref so a later TOKEN_REFRESHED for the same user is a no-op.
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /reconciledAuthScopedForUserRef\.current = s\.user\.id;/,
      );
    },
    5000,
  );

  it(
    "invalidates BOTH auth-scoped roots — brandKeys.all and creatorAccountKeys.all — and does NOT use queryClient.clear() as the reconcile (too broad)",
    () => {
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /invalidateQueries\(\{ queryKey: brandKeys\.all \}\)/,
      );
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /queryKey: creatorAccountKeys\.all,/,
      );
      // The reconcile block references invalidateQueries, never clear().
      const reconcileBlock = AUTH_CONTEXT_SOURCE.match(
        /token-attach reconcile[\s\S]{0,900}?creatorAccountKeys\.all,\s*\}\);/,
      );
      expect(reconcileBlock).not.toBeNull();
      if (reconcileBlock) {
        expect(reconcileBlock[0]).not.toMatch(/queryClient\.clear\(\)/);
      }
    },
    5000,
  );

  it(
    "resets the reconcile ref on SIGNED_OUT so the NEXT sign-in re-reconciles",
    () => {
      // The reset appears in the SIGNED_OUT branch (near clearAllStores()).
      expect(AUTH_CONTEXT_SOURCE).toMatch(
        /reconciledAuthScopedForUserRef\.current = null;/,
      );
    },
    5000,
  );

  it(
    "does NOT remove ORCH-1249's complementary settle guards (timeout/networkMode still referenced in useBrands.ts)",
    () => {
      const useBrandsSource = readFileSync(
        path.resolve(__dirname, "..", "..", "hooks", "useBrands.ts"),
        "utf8",
      );
      expect(useBrandsSource).toMatch(/BRANDS_FETCH_TIMEOUT_MS/);
      expect(useBrandsSource).toMatch(/networkMode:\s*"always"/);
      expect(useBrandsSource).toMatch(/refetchQueries\(\{ queryKey: brandKeys\.list\(accountId\) \}\)/);
    },
    5000,
  );
});
