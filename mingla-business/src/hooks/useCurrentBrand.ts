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

import { useBrand } from "./useBrands";
import {
  useCurrentBrandStore,
  type Brand,
} from "../store/currentBrandStore";

export const useCurrentBrand = (): Brand | null => {
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const setCurrentBrandId = useCurrentBrandStore((s) => s.setCurrentBrandId);
  const { data: brand, isFetched } = useBrand(currentBrandId);

  useEffect(() => {
    if (currentBrandId !== null && isFetched && brand === null) {
      setCurrentBrandId(null);
    }
  }, [currentBrandId, isFetched, brand, setCurrentBrandId]);

  return brand ?? null;
};
