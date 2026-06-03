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

export function usePartnerSplits(params: {
  from?: string;
  to?: string;
  currency?: string;
} = {}) {
  return useQuery<PartnerSplitRow[], Error>({
    queryKey: partnerSplitsKeys.list(params),
    queryFn: () => listPartnerSplits(params),
    staleTime: 60_000,
  });
}

export function usePartnerEarningsSummary(
  params: { from?: string; to?: string } = {},
) {
  return useQuery<PartnerEarningsSummary, Error>({
    queryKey: partnerSplitsKeys.summary(params),
    queryFn: () => getPartnerEarningsSummary(params),
    staleTime: 60_000,
  });
}
