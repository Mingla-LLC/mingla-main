/**
 * ORCH-1100 Wave 1A (RC-1) — pure predicate for the currentBrandId auto-clear.
 *
 * Leaf module (zero imports) so the guard is unit-testable in the `node` jest
 * environment without pulling the React Native hook chain (AuthContext etc.).
 *
 * Returns true ONLY when it is safe to wipe a persisted `currentBrandId`: the
 * store has rehydrated (so we are not clearing a pointer that simply hasn't
 * loaded), auth is ready, a brand id is set, and a REAL server fetch resolved to
 * null with no error (brand deleted / access revoked / never existed). The
 * `!isError` arm already excludes a 401/403 token gap; the `hasHydrated` arm
 * closes the cold-start / multi-tab auth-lock rehydration window where a valid
 * persisted id must NOT be wiped.
 */
export interface CurrentBrandAutoClearInput {
  hasHydrated: boolean;
  isAuthReady: boolean;
  currentBrandId: string | null;
  isFetched: boolean;
  isError: boolean;
  brandIsNull: boolean;
}

export const shouldClearCurrentBrandId = ({
  hasHydrated,
  isAuthReady,
  currentBrandId,
  isFetched,
  isError,
  brandIsNull,
}: CurrentBrandAutoClearInput): boolean =>
  hasHydrated &&
  isAuthReady &&
  currentBrandId !== null &&
  isFetched &&
  !isError &&
  brandIsNull;
