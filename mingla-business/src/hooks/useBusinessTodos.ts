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
import { useBrandPipelineStates } from "./useBrandPlacePipelineState";
import { useBrands } from "./useBrands";
import { useVenueListings } from "./useVenueListings";
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
import {
  draftVenueInProgress,
  useVenueDraftEntriesForBrand,
} from "../store/draftVenueStore";
import { deriveBrandProfileTodoInput } from "../utils/brandProfileCompleteness";
import {
  buildBusinessTodos,
  type BusinessTodo,
  type VenueTodoClaim,
  type VenueTodoDraft,
  type VenueTodoPipeline,
} from "../utils/businessTodos";
import {
  hasAnyDraftPaidOffering,
  mostRecentDraftRoute,
} from "../utils/homeNextAction";
import { routeForPipelineStateFix } from "../utils/deckReadinessRoutes";
import { venueClaimBannerVariant } from "../services/venueClaimBannerLogic";
import { useVenueClaimOpenCountsByVenue } from "./useVenueClaimFeedback";

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
  // META-ORCH-1255 — venues are first-class rows: read the brand's venue
  // listings + ALL its per-venue pipeline rows.
  const venueListings = useVenueListings(currentBrand?.id ?? null);
  const pipelineStates = useBrandPipelineStates(currentBrand?.id ?? null);
  const drafts = useDraftsForBrand(currentBrand?.id ?? null);
  const upcoming = useUpcomingForBrand(currentBrand?.id ?? null);
  const currentBrandIdForDraft = currentBrand?.id ?? null;
  // Issue #1685 — EVERY unfinished venue draft of the CURRENT brand becomes its
  // own "Finish adding <venue>" row. `/venue/create` no longer resumes, so this
  // row (which carries the draft id) is the only door back into a draft.
  const venueDraftEntries = useVenueDraftEntriesForBrand(currentBrandIdForDraft);
  const venueDrafts = useMemo<VenueTodoDraft[]>(
    () =>
      venueDraftEntries
        .filter((e) => draftVenueInProgress(e.state))
        .map((e) => ({
          draftId: e.id,
          // Mirrors the ORCH-1263 claim resume card (create.tsx:401).
          venueName: e.state.displayName.trim() || e.state.workingName.trim(),
          route: `/venue/create?draft=${e.id}`,
        })),
    [venueDraftEntries],
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

  // META-ORCH-1255 — per-venue claim rows. The variant logic is REUSED
  // unchanged, fed each VENUE row's claim fields (the brand claim columns are
  // legacy-inert). Open-feedback counts come from ONE brand-level read,
  // grouped per venue — enabled only when some venue carries a follow-up.
  const venues = venueListings.data ?? [];
  const hasAnyFollowUp = venues.some((v) => v.claimFollowUpAt !== null);
  const openCountsByVenue = useVenueClaimOpenCountsByVenue(
    currentBrand?.id ?? null,
    hasAnyFollowUp,
  );

  // ORCH-1256 — brand-profile completeness input (band 6, tail rows). Derived
  // ONLY once a brand is selected AND its record has resolved: `currentBrand`
  // is null until useBrand's fetch settles, and the extra `!isBrandResolving`
  // guard is belt-and-braces for the ORCH-1100 RC-1 hydration window — so no
  // profile row can ever render (or flash) for a null/resolving brand.
  const profile = useMemo(
    () =>
      currentBrand !== null && !isBrandResolving
        ? {
            ...deriveBrandProfileTodoInput(currentBrand),
            editRoute: `/brand/${currentBrand.id}/edit`,
          }
        : undefined,
    [currentBrand, isBrandResolving],
  );

  const venueClaims = useMemo<VenueTodoClaim[]>(() => {
    if (currentBrand === null) return [];
    const rows: VenueTodoClaim[] = [];
    for (const v of venues) {
      const variant = venueClaimBannerVariant({
        claim_status: v.claimStatus,
        rejection_reason: v.rejectionReason,
        claim_follow_up_at: v.claimFollowUpAt,
      });
      if (variant !== "pending_review" && variant !== "follow_up") continue;
      rows.push({
        venueId: v.id,
        venueName: v.name,
        variant,
        openCount: openCountsByVenue[v.id] ?? 0,
        route: `/brand/${currentBrand.id}/listing?venue=${v.id}`,
        feedbackRoute: `/brand/${currentBrand.id}/listing?venue=${v.id}&focus=feedback`,
      });
    }
    return rows;
  }, [currentBrand, venues, openCountsByVenue]);

  // META-ORCH-1255 — per-venue pipeline rows for `get_venue_live`.
  const venuePipelines = useMemo<VenueTodoPipeline[]>(() => {
    if (currentBrand === null) return [];
    const nameByVenue = new Map(venues.map((v) => [v.id, v.name] as const));
    return (pipelineStates.data ?? []).map((state) => ({
      venueId: state.venue_id,
      venueName: nameByVenue.get(state.venue_id) ?? "your venue",
      status: state.status,
      route: routeForPipelineStateFix({
        brandId: currentBrand.id,
        state,
        fix: "review_pipeline",
      }),
    }));
  }, [currentBrand, venues, pipelineStates.data]);

  return useMemo(
    () =>
      buildBusinessTodos({
        pendingInvites,
        hasNoBrands,
        hasBrandsButNoSelection,
        brandResolving: isBrandResolving,
        hasBrand: currentBrand !== null,
        // META-ORCH-1255 — the per-venue arrays REPLACE the legacy singular
        // pipeline/claim inputs (which stay only for pinned test fixtures).
        pipelineFetched: pipelineStates.isFetched,
        pipelineStatus: null,
        pipelineRoute: "",
        venuePipelines,
        venueClaims,
        venueDrafts,
        venueDraftInProgress: venueDrafts.length > 0,
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
        venueClaimPending: false,
        venueListingRoute:
          currentBrand !== null ? `/brand/${currentBrand.id}/listing` : "",
        venueClaimOpenFeedbackCount: 0,
        venueFeedbackRoute:
          currentBrand !== null
            ? `/brand/${currentBrand.id}/listing?focus=feedback`
            : "",
        profile,
      }),
    [
      profile,
      pendingInvites,
      hasNoBrands,
      hasBrandsButNoSelection,
      isBrandResolving,
      currentBrand,
      pipelineStates.isFetched,
      venuePipelines,
      venueClaims,
      venueDrafts,
      upcoming.counts,
      drafts,
    ],
  );
}
