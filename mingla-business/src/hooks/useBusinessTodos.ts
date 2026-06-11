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
import { useMyPendingInvites } from "./useBrandInvitations";
import { useCurrentBrand } from "./useCurrentBrand";
import { useCurrentBrandRecovery } from "./useCurrentBrandRecovery";
import { useServerDraftsForBrand } from "./useServerDraftEvents";
import { useUpcomingForBrand } from "./useUpcomingForBrand";
import { isBrandPayoutReady } from "../utils/brandPayout";
import {
  useCurrentBrandStore,
  useCurrentBrandHasHydrated,
} from "../store/currentBrandStore";
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
  const { user, isAuthReady } = useAuth();
  const brandsQuery = useBrands(user?.id ?? null);
  const brands = brandsQuery.data ?? [];
  const currentBrand = useCurrentBrand();
  const currentBrandId = useCurrentBrandStore((s) => s.currentBrandId);
  // ORCH-1100 Wave 1A (RC-1) — until the persisted store rehydrates, a null
  // currentBrandId is ambiguous; treat it as resolving so the to-do list does
  // not flash a "create your first brand" / no-selection row during the
  // multi-tab auth-lock hydration window.
  const hasBrandHydrated = useCurrentBrandHasHydrated();
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

  const isBrandResolving =
    !hasBrandHydrated ||
    !brandsQuery.isFetched ||
    brandRecovery.isResolving ||
    (brands.length > 0 && currentBrandId !== null && currentBrand === null);
  // ORCH-1100 Wave 1A (RC-1) — only assert "no brands" once resolution has
  // genuinely settled. `buildBusinessTodos` checks hasNoBrands BEFORE the
  // brandResolving early-return, so without this guard a transient
  // mid-hydration empty read would flash "Create a brand".
  const hasNoBrands =
    brandsQuery.isFetched && brands.length === 0 && !isBrandResolving;
  const hasBrandsButNoSelection =
    brandsQuery.isFetched &&
    brands.length > 0 &&
    currentBrandId === null &&
    currentBrand === null &&
    !isBrandResolving;

  // ORCH-1111 — pending-invite detection. Flash-safe gate (mirrors ORCH-1100
  // RC-1 + the hasNoBrands guard above): only query once auth has settled, we
  // have an account id, the brand list has resolved, and the brand pointer is
  // not mid-hydration. Gating on the SAME isBrandResolving the to-do list
  // trusts keeps the invite row's appearance atomic with the rest of the list,
  // structurally preventing a one-frame invite-row flash.
  const inviteDetectionReady =
    isAuthReady === true &&
    user?.id != null &&
    brandsQuery.isFetched &&
    !isBrandResolving;
  const myPending = useMyPendingInvites(user?.id ?? null, inviteDetectionReady);
  const myPendingData = myPending.data;
  const pendingInvites = useMemo(
    () =>
      (myPendingData ?? []).map((p) => ({ id: p.id, brandName: p.brand_name })),
    [myPendingData],
  );

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
        pendingInvites,
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
        stripeActive: isBrandPayoutReady(currentBrand),
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
      pendingInvites,
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
