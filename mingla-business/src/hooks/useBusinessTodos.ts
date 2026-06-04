/**
 * useBusinessTodos — ORCH-1038 single source of truth for the Business to-do list.
 *
 * Pulls all the live brand / venue / offering / Stripe / draft state and derives
 * the ordered, auto-vanishing to-do list via `buildBusinessTodos`. Home and Hub
 * both call this so the toggle shows the SAME list on both surfaces. All the
 * underlying queries are React-Query keyed, so calling this in two mounted
 * screens dedupes rather than double-fetches.
 */
import { useMemo } from "react";

import { useAuth } from "../context/AuthContext";
import { useBrandPlacePipelineState } from "./useBrandPlacePipelineState";
import { useBrands } from "./useBrands";
import { useCurrentBrand } from "./useCurrentBrand";
import { useCurrentBrandRecovery } from "./useCurrentBrandRecovery";
import { useServerDraftsForBrand } from "./useServerDraftEvents";
import { useUpcomingForBrand } from "./useUpcomingForBrand";
import { useCurrentBrandStore } from "../store/currentBrandStore";
import { useDraftsForBrand } from "../store/draftEventStore";
import { useDraftVenueStore } from "../store/draftVenueStore";
import {
  buildBusinessTodos,
  type BusinessTodo,
} from "../utils/businessTodos";
import {
  hasAnyDraftPaidOffering,
  mostRecentDraftRoute,
} from "../utils/homeNextAction";
import { routeForPipelineStateFix } from "../utils/deckReadinessRoutes";
import { venueClaimBannerVariant } from "../services/venueClaimBannerLogic";
import { useVenueClaimOpenCount } from "./useVenueClaimFeedback";

export function useBusinessTodos(): BusinessTodo[] {
  const { user } = useAuth();
  const brandsQuery = useBrands(user?.id ?? null);
  const brands = brandsQuery.data ?? [];
  const currentBrand = useCurrentBrand();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  const brandRecovery = useCurrentBrandRecovery();
  useServerDraftsForBrand(currentBrand?.id ?? null);
  const pipelineState = useBrandPlacePipelineState(currentBrand?.id ?? null);
  const drafts = useDraftsForBrand(currentBrand?.id ?? null);
  const upcoming = useUpcomingForBrand(currentBrand?.id ?? null);
  const venueDraftInProgress = useDraftVenueStore(
    (s) =>
      s.displayName.trim().length > 0 ||
      s.workingName.trim().length > 0 ||
      s.step > 0,
  );

  const hasNoBrands = brandsQuery.isFetched && brands.length === 0;
  const isBrandResolving =
    !brandsQuery.isFetched ||
    brandRecovery.isResolving ||
    (brands.length > 0 && currentBrandId !== null && currentBrand === null);
  const hasBrandsButNoSelection =
    brandsQuery.isFetched &&
    brands.length > 0 &&
    currentBrandId === null &&
    currentBrand === null &&
    !isBrandResolving;

  // META-ORCH-1059 — the venue-claim "under review" to-do row (replaces the Hub
  // blue banner). Reuse the SAME variant logic the banner used so the row shows
  // for exactly the pending/under-review states (pending_review + admin follow-up).
  const venueClaimVariant = venueClaimBannerVariant(
    currentBrand !== null
      ? {
          claim_status: currentBrand.claimStatus ?? "none",
          rejection_reason: currentBrand.rejectionReason ?? null,
          claim_follow_up_at: currentBrand.claimFollowUpAt ?? null,
        }
      : null,
  );
  const venueClaimPending =
    venueClaimVariant === "pending_review" || venueClaimVariant === "follow_up";

  // ORCH-1064 — open admin-feedback count for the active follow-up round. Reads
  // the feedback query cache (enabled only when a follow-up stamp exists), so it
  // never forces an extra fetch for plain pending / verified / rejected claims.
  const venueClaimOpenFeedbackCount = useVenueClaimOpenCount(
    currentBrand?.id ?? null,
    currentBrand?.claimFollowUpAt ?? null,
  );

  const pipelineRoute = useMemo(
    () =>
      currentBrand !== null
        ? routeForPipelineStateFix({
            brandId: currentBrand.id,
            state: pipelineState.data,
            fix: "review_pipeline",
          })
        : "",
    [currentBrand, pipelineState.data],
  );

  return useMemo(
    () =>
      buildBusinessTodos({
        hasNoBrands,
        hasBrandsButNoSelection,
        brandResolving: isBrandResolving,
        hasBrand: currentBrand !== null,
        pipelineFetched: pipelineState.isFetched,
        pipelineStatus: pipelineState.data?.status ?? null,
        pipelineRoute,
        venueDraftInProgress,
        hasPhysicalLocation: currentBrand?.hasPhysicalLocation === true,
        counts: {
          total: upcoming.counts.total,
          live: upcoming.counts.live,
          draft: upcoming.counts.draft,
        },
        stripeActive: currentBrand?.stripeStatus === "active",
        hasDraftPaidOffering: hasAnyDraftPaidOffering(drafts),
        stripeRoute:
          currentBrand !== null ? `/brand/${currentBrand.id}/payments` : "",
        draftRoute: mostRecentDraftRoute(drafts),
        venueClaimPending,
        venueListingRoute:
          currentBrand !== null ? `/brand/${currentBrand.id}/listing` : "",
        venueClaimOpenFeedbackCount,
        venueFeedbackRoute:
          currentBrand !== null
            ? `/brand/${currentBrand.id}/listing?focus=feedback`
            : "",
      }),
    [
      hasNoBrands,
      hasBrandsButNoSelection,
      isBrandResolving,
      currentBrand,
      pipelineState.isFetched,
      pipelineState.data,
      pipelineRoute,
      venueDraftInProgress,
      upcoming.counts,
      drafts,
      venueClaimPending,
      venueClaimOpenFeedbackCount,
    ],
  );
}
