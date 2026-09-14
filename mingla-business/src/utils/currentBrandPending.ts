/**
 * issue #3345 — is the active brand still LOADING, as opposed to absent?
 *
 * Switching brand stores only the brand id. Until the brand's record arrives,
 * `useCurrentBrand()` has nothing to return, and the top bar ("Create brand")
 * and Home (the brandless empty state) both read that gap as "this organiser has
 * no brand". Filmed 2026-09-14 for 1–19 seconds per switch.
 *
 * "Create brand" is only true once nothing is selected AND brand resolution has
 * settled. Every other `null` is a loading window:
 *   - the persisted pointer has not rehydrated yet (ORCH-1100 RC-1), or
 *   - a brand id IS selected but its record has not arrived, or
 *   - the recovery resolver is still choosing a brand.
 *
 * Leaf module (no imports) so it runs in the node jest environment, and every
 * input tolerates `undefined` — several suites mock the store and the recovery
 * hook with partial shapes.
 */
export interface CurrentBrandPendingInput {
  /** `useCurrentBrand() !== null`. */
  brandPresent: boolean;
  /** The persisted pointer (`currentBrandStore.currentBrandId`). */
  currentBrandId: string | null | undefined;
  /** `currentBrandStore.hasHydrated`. */
  hasHydrated: boolean | undefined;
  /** `useCurrentBrandRecovery().isResolving`, where the caller has it. */
  recoveryResolving?: boolean | undefined;
}

export const isCurrentBrandPending = ({
  brandPresent,
  currentBrandId,
  hasHydrated,
  recoveryResolving,
}: CurrentBrandPendingInput): boolean => {
  if (brandPresent) return false;
  if (hasHydrated === false) return true;
  if (typeof currentBrandId === "string" && currentBrandId.length > 0) {
    return true;
  }
  return recoveryResolving === true;
};
