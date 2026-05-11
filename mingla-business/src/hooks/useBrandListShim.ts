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
import {
  resolveBrandListStatus,
  type BrandListStatus,
} from "../utils/brandListState";
import { useBrands } from "./useBrands";

export { resolveBrandListStatus, type BrandListStatus };

export interface BrandListState {
  brands: Brand[];
  status: BrandListStatus;
  isTrueEmpty: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
}

export const useBrandListState = (): BrandListState => {
  const { authStatus, user } = useAuth();
  const query = useBrands(user?.id ?? null);
  const brands = query.data ?? [];
  const status = resolveBrandListStatus({
    authStatus,
    hasUser: user !== null,
    isError: query.isError,
    isFetched: query.isFetched,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    itemCount: brands.length,
  });
  return {
    brands,
    status,
    isTrueEmpty: status === "empty",
    isLoading: status === "auth_loading" || status === "query_loading",
    error: query.error ?? null,
    refetch: query.refetch,
  };
};

export const useBrandList = (): Brand[] => {
  const { brands } = useBrandListState();
  return brands;
};
