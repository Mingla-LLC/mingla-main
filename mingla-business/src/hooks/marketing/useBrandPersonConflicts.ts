import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useAuth } from "../../context/AuthContext";
import {
  listBrandPersonConflicts,
  PeopleServiceError,
  resolveBrandPersonConflict,
} from "../../services/peopleService";
import type {
  BrandPersonConflictPage,
  ResolveBrandPersonConflictInput,
  ResolveBrandPersonConflictResult,
} from "../../types/people";
import { marketingKeys } from "./marketingKeys";

/** Same retry predicate as `useBrandPeople` — only the retryable service errors. */
const retry = (count: number, error: Error): boolean =>
  count < 2 && error instanceof PeopleServiceError && error.retryable;

const isForbidden = (error: unknown): boolean =>
  error instanceof PeopleServiceError && error.code === "people_forbidden";

export type ConflictQueryKind =
  | "authLoading" | "roleLoading" | "forbidden" | "offlineStale" | "offlineEmpty"
  | "loading" | "staleError" | "error" | "refreshing" | "success";

/**
 * #2305 — reads the queue `brand_person_identity_conflicts` never had.
 *
 * Rank 20 (marketing_manager) can SEE the queue: `biz_get_brand_person` already
 * returns a person's full email and phone at rank 20, so hiding *which buyer is
 * missing* from the role that owns the sends protects nothing. Resolving is
 * gated at rank 50 inside the RPC and surfaced per row as `canResolve`.
 */
export function useBrandPersonConflicts(
  brandId: string | null,
  roleResolved: boolean,
  accepted: boolean,
  rank: number,
  online = true,
): ReturnType<typeof useQuery<BrandPersonConflictPage>> & {
  kind: ConflictQueryKind;
  openCount: number;
  rows: BrandPersonConflictPage["rows"];
} {
  const { isAuthReady, user } = useAuth();
  const queryClient = useQueryClient();
  const allowed = roleResolved && accepted && rank >= 20;
  const enabled = isAuthReady && user !== null && brandId !== null && allowed;

  useEffect(() => {
    if (!enabled && brandId !== null) {
      void queryClient.cancelQueries({ queryKey: marketingKeys.people.conflicts(brandId) });
    }
  }, [brandId, enabled, queryClient]);

  const query = useQuery<BrandPersonConflictPage>({
    queryKey: brandId ? marketingKeys.people.conflicts(brandId) : marketingKeys.all,
    queryFn: () => listBrandPersonConflicts({ brandId: brandId as string, limit: 50 }),
    enabled,
    staleTime: 30_000,
    retry,
  });

  const hasData = query.data !== undefined;
  const kind: ConflictQueryKind =
    !isAuthReady || user === null ? "authLoading"
    : !roleResolved ? "roleLoading"
    : !allowed || isForbidden(query.error) ? "forbidden"
    : !online && hasData ? "offlineStale"
    : !online && !hasData ? "offlineEmpty"
    : query.isLoading ? "loading"
    : query.isError && hasData ? "staleError"
    : query.isError ? "error"
    : query.isFetching ? "refreshing"
    : "success";

  return {
    ...query,
    kind,
    openCount: query.data?.openCount ?? 0,
    rows: query.data?.rows ?? [],
  };
}

/**
 * Resolving a conflict ADDS a person to the book, so BOTH keys must be
 * invalidated. The People page's payoff frame — the recovered buyers appearing
 * in the roster in the same frame the warning strip disappears — depends on it.
 */
export function useResolveBrandPersonConflict(
  brandId: string,
  onFailure?: (error: unknown) => void,
): ReturnType<typeof useMutation<ResolveBrandPersonConflictResult, Error, ResolveBrandPersonConflictInput>> {
  const queryClient = useQueryClient();
  return useMutation<ResolveBrandPersonConflictResult, Error, ResolveBrandPersonConflictInput>({
    mutationFn: (input) => resolveBrandPersonConflict(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketingKeys.people.conflicts(brandId) });
      void queryClient.invalidateQueries({ queryKey: marketingKeys.people.all(brandId) });
    },
    onError: (error) => {
      onFailure?.(error);
    },
  });
}
