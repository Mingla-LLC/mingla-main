/**
 * useAuditLog — React Query hook for the brand-level audit log (Cycle 13a +
 * ORCH-0806 pagination/filter overhaul).
 *
 * Reads `audit_log` rows scoped by brand_id, newest-first, paginated via
 * `useInfiniteQuery` in PAGE_SIZE increments using created_at as the cursor.
 *
 * RLS today scopes audit_log SELECT to `user_id = auth.uid()` — users see
 * only their own actions. Brand-admin-can-read-all is queued for B-cycle
 * (SPEC §10.4). The banner copy was updated by ORCH-0806 to be honest about
 * the self-only scope across all roles.
 *
 * Category filtering is client-side: every row is resolved through
 * resolveAuditActionLabel and filtered by AuditCategory. Server-side filtering
 * would require a category column (out of scope for ORCH-0806).
 *
 * Per Cycle 13a SPEC §4.12 + ORCH-0806 SPEC §6.3.
 */

import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  type AuditCategory,
  resolveAuditActionLabel,
} from "../utils/auditActionLabels";

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
}

const STALE_TIME_MS = 60 * 1000; // 1 min
const PAGE_SIZE = 25;

export type AuditCategoryFilter = AuditCategory | "all";

export const auditLogKeys = {
  all: ["audit-log"] as const,
  byBrand: (
    brandId: string,
    filter: AuditCategoryFilter,
  ): readonly [string, string, AuditCategoryFilter] =>
    ["audit-log", brandId, filter] as const,
};

const DISABLED_KEY = ["audit-log-disabled"] as const;

export interface UseAuditLogState {
  rows: AuditLogRow[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  fetchMore: () => void;
}

interface AuditPage {
  rows: AuditLogRow[];
  /** ISO timestamp of the oldest row in this page; null when the page is empty. */
  nextCursor: string | null;
  /** True when this page returned fewer than PAGE_SIZE rows. */
  isLast: boolean;
}

export const useAuditLog = (
  brandId: string | null,
  categoryFilter: AuditCategoryFilter = "all",
): UseAuditLogState => {
  // ORCH-1004 — audit_log RLS scopes SELECT to user_id = auth.uid(); firing
  // pre-auth returns 200 + [] cached as success. Gate on auth readiness.
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null;

  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery<AuditPage, Error>({
    queryKey: enabled
      ? auditLogKeys.byBrand(brandId, categoryFilter)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage): string | null => {
      if (lastPage.isLast) return null;
      return lastPage.nextCursor;
    },
    queryFn: async ({ pageParam }): Promise<AuditPage> => {
      if (!enabled || brandId === null) {
        return { rows: [], nextCursor: null, isLast: true };
      }
      let query = supabase
        .from("audit_log")
        .select("id, user_id, action, target_type, target_id, created_at")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (typeof pageParam === "string" && pageParam.length > 0) {
        query = query.lt("created_at", pageParam);
      }
      const { data: rows, error } = await query;
      if (error) throw error;
      const fetched = (rows ?? []) as AuditLogRow[];
      const isLast = fetched.length < PAGE_SIZE;
      const nextCursor =
        fetched.length > 0
          ? fetched[fetched.length - 1]?.created_at ?? null
          : null;
      return { rows: fetched, nextCursor, isLast };
    },
  });

  const flatRows = useMemo<AuditLogRow[]>(() => {
    if (data === undefined) return [];
    return data.pages.flatMap((page) => page.rows);
  }, [data]);

  const filteredRows = useMemo<AuditLogRow[]>(() => {
    if (categoryFilter === "all") return flatRows;
    return flatRows.filter(
      (r) => resolveAuditActionLabel(r.action).category === categoryFilter,
    );
  }, [flatRows, categoryFilter]);

  return {
    rows: filteredRows,
    isLoading,
    isError,
    hasMore: hasNextPage === true,
    isFetchingMore: isFetchingNextPage,
    fetchMore: (): void => {
      void fetchNextPage();
    },
  };
};
