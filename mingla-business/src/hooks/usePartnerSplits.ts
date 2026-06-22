/**
 * usePartnerSplits — ORCH-1054 React Query hooks for the partner splits ledger.
 *
 * Read-only hooks; the splits table is written exclusively by the
 * stripe-webhook router.
 */

import { useQuery } from "@tanstack/react-query";

import {
  getPartnerEarningsSummary,
  listPartnerSplits,
  type PartnerEarningsSummary,
  partnerSplitsKeys,
  type PartnerSplitRow,
} from "../services/partnerSplitsService";
import { useAuth } from "../context/AuthContext";

const DISABLED_KEY = ["partner-splits-disabled"] as const;

export function usePartnerSplits(params: {
  from?: string;
  to?: string;
  currency?: string;
} = {}) {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;
  return useQuery<PartnerSplitRow[], Error>({
    queryKey: enabled ? partnerSplitsKeys.list(params) : DISABLED_KEY,
    queryFn: () => listPartnerSplits(params),
    enabled,
    staleTime: 60_000,
  });
}

export function usePartnerEarningsSummary(
  params: { from?: string; to?: string } = {},
) {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady;
  return useQuery<PartnerEarningsSummary, Error>({
    queryKey: enabled ? partnerSplitsKeys.summary(params) : DISABLED_KEY,
    queryFn: () => getPartnerEarningsSummary(params),
    enabled,
    staleTime: 60_000,
  });
}
