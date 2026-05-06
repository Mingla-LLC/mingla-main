/**
 * [TRANSITIONAL] useBrandList wrapper — Cycle 17e-A.
 *
 * Lives in a separate file from useBrands.ts to avoid circular imports
 * (useBrands depends on currentBrandStore.Brand type). This wrapper
 * delegates to `useBrands(authUserId)` so legacy `useBrandList()` callers
 * (~20 sites) keep working while server state moves to React Query.
 *
 * Const #5 satisfied: state lives in React Query; this wrapper is
 * read-only sugar.
 *
 * I-PROPOSED-C satisfied: the rule bans `setBrands\(` write paths, which
 * were removed. `useBrandList` is read-only.
 *
 * EXIT condition: future cycle migrates each caller to `useBrands(accountId)`
 * directly + this file deletes.
 */

import { useAuth } from "../context/AuthContext";
import type { Brand } from "../store/currentBrandStore";
import { useBrands } from "./useBrands";

export const useBrandList = (): Brand[] => {
  const { user } = useAuth();
  const query = useBrands(user?.id ?? null);
  return query.data ?? [];
};
