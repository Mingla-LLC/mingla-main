/**
 * useCurrentBrand — server-fresh wrapper for the active organiser brand
 * (Cycle 2 / ORCH-0742).
 *
 * Replaces the v13-and-earlier "persisted Brand snapshot" pattern. Reads
 * `currentBrandId` from Zustand and fetches the live Brand record via React
 * Query (`useBrand(currentBrandId)`). Cycle 1's focusManager (ORCH-0740)
 * refetches on app foreground; the 30s role TTL governs role-cache freshness.
 *
 * Lives in src/hooks/ (not src/store/) to avoid the circular import between
 * currentBrandStore.ts (which exports the Brand type) and useBrands.ts
 * (which depends on Brand). Re-exported from currentBrandStore.ts for
 * backward-compatible imports — mirrors the useBrandList shim pattern.
 *
 * Const #5 satisfied: server state lives in React Query; Zustand holds only
 * the client-state pointer (currentBrandId).
 *
 * I-PROPOSED-J satisfied: nothing server-derived persists in Zustand.
 *
 * Auto-clear: when useBrand(currentBrandId) returns null AFTER an actual
 * server fetch (brand was deleted, access revoked, never existed), the
 * wrapper clears currentBrandId via a useEffect so cold-start does not
 * replay phantom selection. The `isFetched` guard prevents a spurious clear
 * during the initial loading window (when brand === undefined while the
 * query is still in flight).
 */

import { useEffect } from "react";

import { useAuth } from "../context/AuthContext";
import { useBrand } from "./useBrands";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import type { Brand } from "../types/brand";
// ORCH-1100 Wave 1A (RC-1) — hardened auto-clear predicate lives in a leaf util
// (zero RN imports) so it is unit-testable in the node jest environment.
import { shouldClearCurrentBrandId } from "../utils/currentBrandAutoClear";

export { shouldClearCurrentBrandId } from "../utils/currentBrandAutoClear";

export const useCurrentBrand = (): Brand | null => {
  const { isAuthReady } = useAuth();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const hasHydrated = useCurrentBrandStore((s) => s.hasHydrated);
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);
  const { data: brand, isError, isFetched } = useBrand(
    isAuthReady ? currentBrandId : null,
  );

  useEffect(() => {
    // ORCH-1100 Wave 1A (RC-1) — harden the auto-clear against the multi-tab
    // auth-lock token gap via the extracted shouldClearCurrentBrandId predicate.
    if (
      shouldClearCurrentBrandId({
        hasHydrated,
        isAuthReady,
        currentBrandId,
        isFetched,
        isError,
        brandIsNull: brand === null,
      })
    ) {
      setCurrentBrandId(null);
    }
  }, [
    hasHydrated,
    isAuthReady,
    currentBrandId,
    isFetched,
    isError,
    brand,
    setCurrentBrandId,
  ]);

  return brand ?? null;
};
