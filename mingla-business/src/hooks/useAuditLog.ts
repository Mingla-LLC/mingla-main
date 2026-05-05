/**
 * useAuditLog — React Query hook for the brand-level audit log (Cycle 13a).
 *
 * Reads `audit_log` rows scoped by brand_id, newest-first, capped at 100.
 * RLS enforces self-only visibility today (`Users can read own audit_log
 * rows`) — brand-admin-can-read-all is queued for B-cycle (SPEC §10.4).
 *
 * Per Cycle 13a SPEC §4.12.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../services/supabase";

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
}

const STALE_TIME_MS = 60 * 1000; // 1 min
const ROW_LIMIT = 100;

export const auditLogKeys = {
  all: ["audit-log"] as const,
  byBrand: (brandId: string): readonly [string, string] =>
    ["audit-log", brandId] as const,
};

const DISABLED_KEY = ["audit-log-disabled"] as const;

export interface UseAuditLogState {
  rows: AuditLogRow[];
  isLoading: boolean;
  isError: boolean;
}

export const useAuditLog = (brandId: string | null): UseAuditLogState => {
  const enabled = brandId !== null;

  const { data, isLoading, isError } = useQuery<AuditLogRow[]>({
    queryKey: enabled ? auditLogKeys.byBrand(brandId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<AuditLogRow[]> => {
      if (!enabled || brandId === null) return [];
      const { data: rows, error } = await supabase
        .from("audit_log")
        .select("id, user_id, action, target_type, target_id, created_at")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(ROW_LIMIT);
      if (error) throw error;
      return (rows ?? []) as AuditLogRow[];
    },
  });

  return { rows: data ?? [], isLoading, isError };
};
