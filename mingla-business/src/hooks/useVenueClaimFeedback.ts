/**
 * ORCH-1064 — venue-claim feedback loop (business side).
 *
 * Reads the active feedback round for the current brand (owner-RLS-gated view),
 * toggles items open↔fixed optimistically, and re-submits the claim. Wired to
 * the SECURITY DEFINER RPCs in venueClaimService.ts.
 *
 * enabled: only when the brand carries a follow-up stamp (the `follow_up`
 * variant) — no wasted fetch for plain pending / verified / rejected. Errors are
 * surfaced via the mutations' onError (Constitution #3 — no silent failures);
 * the user-facing toast is raised by the consuming sheet/parent (DESIGN §6.7).
 */

import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { brandKeys } from "./useBrands";
import {
  fetchVenueClaimFeedback,
  markFeedbackItemFixed,
  resubmitVenueClaim,
  type VenueClaimFeedbackItem,
} from "../services/venueClaimService";

interface UseVenueClaimFeedbackArgs {
  brandId: string | null;
  /** The brand's claim_follow_up_at stamp — gates the query. */
  followUpAt: string | null | undefined;
  /** The account id, for re-submit list-cache invalidation. */
  accountId?: string | null;
}

export interface MarkFixedVars {
  feedbackId: string;
  fixed: boolean;
}

export interface UseVenueClaimFeedbackResult {
  query: UseQueryResult<VenueClaimFeedbackItem[], Error>;
  items: VenueClaimFeedbackItem[];
  openCount: number;
  fixedCount: number;
  totalCount: number;
  overallMessage: string | null;
  markFixed: UseMutationResult<
    { ok: boolean; id: string; status: "open" | "fixed" },
    Error,
    MarkFixedVars,
    { previous: VenueClaimFeedbackItem[] | undefined }
  >;
  resubmit: UseMutationResult<
    { ok: boolean; brand_id: string; resubmitted_round: number },
    Error,
    void,
    unknown
  >;
}

export function useVenueClaimFeedback({
  brandId,
  followUpAt,
  accountId,
}: UseVenueClaimFeedbackArgs): UseVenueClaimFeedbackResult {
  const queryClient = useQueryClient();
  const enabled = brandId !== null && Boolean(followUpAt);
  const feedbackKey = brandId !== null ? brandKeys.feedback(brandId) : null;

  const query = useQuery<VenueClaimFeedbackItem[], Error>({
    queryKey: feedbackKey ?? brandKeys.feedback("__none__"),
    queryFn: () => fetchVenueClaimFeedback(brandId as string),
    enabled,
    staleTime: 30_000,
  });

  const items = query.data ?? [];
  const openCount = items.filter((i) => i.status === "open").length;
  const fixedCount = items.filter((i) => i.status === "fixed").length;
  const totalCount = items.length;
  const overallMessage =
    items.find((i) => i.overall_message != null)?.overall_message ?? null;

  const markFixed = useMutation<
    { ok: boolean; id: string; status: "open" | "fixed" },
    Error,
    MarkFixedVars,
    { previous: VenueClaimFeedbackItem[] | undefined }
  >({
    mutationFn: ({ feedbackId, fixed }) =>
      markFeedbackItemFixed(feedbackId, fixed),
    // Optimistic flip: update the cached item immediately, roll back on error.
    onMutate: async ({ feedbackId, fixed }) => {
      if (feedbackKey === null) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: feedbackKey });
      const previous = queryClient.getQueryData<VenueClaimFeedbackItem[]>(
        feedbackKey,
      );
      queryClient.setQueryData<VenueClaimFeedbackItem[]>(
        feedbackKey,
        (old) =>
          (old ?? []).map((it) =>
            it.id === feedbackId
              ? {
                  ...it,
                  status: fixed ? "fixed" : "open",
                  resolved_at: fixed ? new Date().toISOString() : null,
                }
              : it,
          ),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (feedbackKey !== null && context?.previous !== undefined) {
        queryClient.setQueryData(feedbackKey, context.previous);
      }
    },
    onSettled: () => {
      if (feedbackKey !== null) {
        void queryClient.invalidateQueries({ queryKey: feedbackKey });
      }
    },
  });

  const resubmit = useMutation<
    { ok: boolean; brand_id: string; resubmitted_round: number },
    Error,
    void,
    unknown
  >({
    mutationFn: () => resubmitVenueClaim(brandId as string),
    onSuccess: () => {
      // The tile reverts to plain pending once claimFollowUpAt clears: invalidate
      // the brand detail (drives the variant), the brand list, and the feedback.
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: brandKeys.detail(brandId),
        });
        void queryClient.invalidateQueries({
          queryKey: brandKeys.feedback(brandId),
        });
      }
      if (accountId) {
        void queryClient.invalidateQueries({
          queryKey: brandKeys.list(accountId),
        });
      }
    },
  });

  return {
    query,
    items,
    openCount,
    fixedCount,
    totalCount,
    overallMessage,
    markFixed,
    resubmit,
  };
}

/**
 * ORCH-1064 — lightweight open-count selector for the Hub tile badge. Reads the
 * feedback query cache without forcing a separate fetch; returns 0 when not
 * loaded. Used by the parent to pass `openCount` into VenueClaimStatusBanner.
 */
export function useVenueClaimOpenCount(
  brandId: string | null,
  followUpAt: string | null | undefined,
): number {
  const enabled = brandId !== null && Boolean(followUpAt);
  const query = useQuery<VenueClaimFeedbackItem[], Error>({
    queryKey:
      brandId !== null ? brandKeys.feedback(brandId) : brandKeys.feedback("__none__"),
    queryFn: () => fetchVenueClaimFeedback(brandId as string),
    enabled,
    staleTime: 30_000,
  });
  const openCount = useCallback(
    () => (query.data ?? []).filter((i) => i.status === "open").length,
    [query.data],
  );
  return openCount();
}
