import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { listSourceRefundSummaries } from "../services/sourceRefundService";
import { supabase } from "../services/supabase";
import type { SourceRefundSummary } from "../types/venueReservation";

export const rsvpContributionRefundKeys = {
  list: (brandId: string, ids: string[]) =>
    ["sourceRefunds", brandId, "rsvp_contribution", [...ids].sort()] as const,
};

export function useRsvpContributionRefunds(
  brandId: string | null,
  contributionIds: string[],
) {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && Boolean(brandId) &&
    contributionIds.length > 0;
  return useQuery({
    queryKey: rsvpContributionRefundKeys.list(brandId ?? "none", contributionIds),
    enabled,
    queryFn: () => listSourceRefundSummaries({
      brandId: brandId as string,
      sourceType: "rsvp_contribution",
      subjectIds: contributionIds,
    }),
    staleTime: 15_000,
  });
}

export interface EventRsvpContributionRefund {
  contributionId: string;
  rsvpId: string | null;
  refund: SourceRefundSummary | null;
}

export function useEventRsvpContributionRefunds(eventId: string) {
  const { isAuthReady } = useAuth();
  return useQuery({
    queryKey: ["sourceRefunds", "event", eventId] as const,
    enabled: isAuthReady && eventId.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<EventRsvpContributionRefund[]> => {
      const { data, error } = await supabase
        .from("event_rsvp_contributions")
        .select("id,rsvp_id,brand_id")
        .eq("event_id", eventId)
        .in("status", ["paid", "partially_refunded", "refunded"]);
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        rsvp_id: string | null;
        brand_id: string;
      }>;
      if (rows.length === 0) return [];
      const refunds = await listSourceRefundSummaries({
        brandId: rows[0].brand_id,
        sourceType: "rsvp_contribution",
        subjectIds: rows.map((row) => row.id),
      });
      const byContribution = new Map(
        refunds.map((refund) => [refund.subjectId, refund]),
      );
      return rows.map((row) => ({
        contributionId: row.id,
        rsvpId: row.rsvp_id,
        refund: byContribution.get(row.id) ?? null,
      }));
    },
  });
}
