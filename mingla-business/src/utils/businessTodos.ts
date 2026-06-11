/**
 * ORCH-1038 [Business Home/Hub unified smart To-Do toggle].
 *
 * Pure derivation of the operator's ordered to-do list from live brand/venue/
 * offering state. Emits ONLY the items whose condition is currently UNMET, already
 * sorted by priority (most-important first) — so a row vanishes automatically the
 * moment its underlying state is satisfied. No hooks, no React, no Brand/DraftEvent
 * type coupling (route strings are precomputed by the caller) → trivially unit-tested.
 *
 * Replaces the per-surface conditional cards (no-brand / choose-brand / add-venue /
 * deck-readiness / rule-ladder next-action / offering-chooser) with one source of
 * truth shared by Home and Hub. Priority order (operator-locked 2026-06-01):
 *   brand → venue (add/finish, then get-live) → first offering → Stripe → finish draft.
 */

import type { BrandPlacePipelineState } from "../services/businessPlaceAuthoringService";

export type BusinessTodoAction =
  | { kind: "open_brand_switcher" }
  | { kind: "open_universal_creator" }
  | { kind: "route"; route: string }
  // ORCH-1111 — open the Accept/Decline sheet for a pending brand invitation.
  | { kind: "open_pending_invite"; invitationId: string; brandName: string };

export interface BusinessTodo {
  id: string;
  label: string;
  sublabel?: string;
  action: BusinessTodoAction;
  /**
   * ORCH-1064 — optional worded count pill for a row (e.g. "3 to fix"). Rendered
   * by BusinessTodoToggle on the right of the row, before the chevron. Only the
   * venue-claim-feedback row sets this today; absent → no pill.
   */
  badge?: string;
}

export interface BusinessTodoInput {
  /**
   * ORCH-1111 — pending brand invitations for the signed-in email (already
   * flash-gated by the hook; [] / omitted when none or still resolving).
   * Rendered as the highest-priority rows, ABOVE the brand-gate early-returns,
   * soonest-expiring first (the hook supplies expires_at ASC order). Optional so
   * pre-1108 callers/tests that never pass invites compile unchanged; treated as
   * [] when absent.
   */
  pendingInvites?: { id: string; brandName: string }[];
  /** brandsQuery resolved + zero brands. */
  hasNoBrands: boolean;
  /** Brands exist but none is selected (and not mid-resolve). */
  hasBrandsButNoSelection: boolean;
  /** Brand list / current-brand still resolving — emit nothing to avoid a flash. */
  brandResolving: boolean;
  /** A brand is selected. */
  hasBrand: boolean;
  /** The venue pipeline query has resolved (so `null` status truly means no venue). */
  pipelineFetched: boolean;
  /** Pipeline status, or `null` when the brand has no claimed/authored venue row. */
  pipelineStatus: BrandPlacePipelineState["status"] | null;
  /** Deck-readiness route for the current pipeline state (used by `get_venue_live`). */
  pipelineRoute: string;
  /** A persisted, in-progress venue wizard draft exists (→ "Finish" vs "Add"). */
  venueDraftInProgress: boolean;
  /**
   * ORCH-1040 — the brand has a physical location (opt-in toggle). Gates the
   * add/finish-venue rows so non-physical brands are never nagged to add a venue.
   */
  hasPhysicalLocation: boolean;
  /** Upcoming buckets (total = live+upcoming+draft; past already filtered out). */
  counts: { total: number; live: number; draft: number };
  /** Brand Stripe status is "active". */
  stripeActive: boolean;
  /** At least one draft has a paid (non-free, >0) ticket — gates the Stripe row. */
  hasDraftPaidOffering: boolean;
  /** Route to the brand's Stripe payments screen. */
  stripeRoute: string;
  /** Route to the most-recent draft, or null when there is none. */
  draftRoute: string | null;
  /**
   * META-ORCH-1059 — the brand has a venue claim that is pending / under review
   * (claim_status='pending_review', incl. the admin-follow-up sub-state). Drives
   * the "Venue claim under review" row that replaced the Hub blue banner. Vanishes
   * automatically once the claim resolves (verified / rejected / none).
   */
  venueClaimPending: boolean;
  /** Route to the brand's venue-listing surface (where claim status lives). */
  venueListingRoute: string;
  /**
   * ORCH-1064 — count of OPEN admin-feedback items in the active follow-up round.
   * 0 when the claim is plainly pending (no admin follow-up yet) or all items are
   * addressed. >0 sharpens the venue-claim row: it gains a "N to fix" badge and
   * its action deep-links the listing focused on the feedback sheet. The row
   * itself still appears for any pending claim (with or without open feedback) —
   * the count only escalates an already-present row, preserving the vanish logic.
   */
  venueClaimOpenFeedbackCount: number;
  /**
   * ORCH-1064 — route to the venue listing with the feedback sheet auto-opened.
   * Used as the venue-claim row's action when there is open admin feedback.
   */
  venueFeedbackRoute: string;
}

function venueLiveSublabel(
  status: Exclude<BrandPlacePipelineState["status"], "draft" | "deck_eligible">,
): string {
  switch (status) {
    case "processing":
      return "We're reviewing your details";
    case "needs_fix":
      return "A few things need fixing";
    case "failed":
      return "Something went wrong — tap to retry";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function buildBusinessTodos(input: BusinessTodoInput): BusinessTodo[] {
  // 0 — ORCH-1111 — pending brand invitations. ALWAYS first (an invite is a
  // one-tap relationship decision and must not be stranded behind the
  // "Create a brand" empty-state). The hook supplies them already flash-gated
  // and expires_at ASC; each row vanishes the instant accept/decline drops it
  // from `pendingInvites` (no per-row local state).
  const inviteTodos: BusinessTodo[] = (input.pendingInvites ?? []).map((inv) => ({
    id: `pending_invite_${inv.id}`,
    label: `You've been invited to ${inv.brandName}`,
    sublabel: "Tap to accept or decline",
    action: {
      kind: "open_pending_invite",
      invitationId: inv.id,
      brandName: inv.brandName,
    },
  }));

  // 1 — Brand gate. Without a usable brand, the only thing to do is create/select
  // one; nothing downstream applies, so we return early — but invite(s) first.
  if (input.hasNoBrands) {
    return [
      ...inviteTodos,
      {
        id: "create_brand",
        label: "Create a brand",
        sublabel: "Set up your business on Mingla",
        action: { kind: "open_brand_switcher" },
      },
    ];
  }
  if (input.hasBrandsButNoSelection) {
    return [
      ...inviteTodos,
      {
        id: "select_brand",
        label: "Select a brand",
        sublabel: "Choose which brand to work on",
        action: { kind: "open_brand_switcher" },
      },
    ];
  }
  if (input.brandResolving || !input.hasBrand) {
    // Still surface invites even while the brand resolves (hook-gated already).
    return inviteTodos;
  }

  const todos: BusinessTodo[] = [...inviteTodos];

  // 2 — Venue. ORCH-1040: "Add/Finish your venue" only shows for brands that
  // have toggled ON a physical location (opt-in) — online-only brands, event
  // organizers and pop-ups never get nagged. "Get your venue live" is NOT gated
  // on the flag: it only fires once a venue row exists, which means the brand
  // already engaged the physical path, so an in-progress venue is never stranded.
  if (input.pipelineFetched && input.pipelineStatus === null) {
    if (input.hasPhysicalLocation) {
      todos.push(
        input.venueDraftInProgress
          ? {
              id: "finish_venue",
              label: "Finish adding your venue",
              sublabel: "Pick up where you left off",
              action: { kind: "route", route: "/venue/create" },
            }
          : {
              id: "add_venue",
              label: "Add your venue",
              sublabel: "Get discovered in the Mingla deck",
              action: { kind: "route", route: "/venue/create" },
            },
      );
    }
  } else if (
    input.pipelineStatus !== null &&
    input.pipelineStatus !== "draft" &&
    input.pipelineStatus !== "deck_eligible"
  ) {
    todos.push({
      id: "get_venue_live",
      label: "Get your venue live",
      sublabel: venueLiveSublabel(input.pipelineStatus),
      action: { kind: "route", route: input.pipelineRoute },
    });
  }

  // 2b — Venue claim under review. META-ORCH-1059: replaces the Hub blue
  // "your venue claim is being reviewed" banner. Informational + tappable to the
  // venue listing (where the live claim status is shown). Only present while the
  // claim is actually pending/under-review, so it auto-vanishes on resolution.
  //
  // ORCH-1064: when the admin has left OPEN feedback (follow-up round with items
  // still to fix), the SAME row sharpens into an actionable punch-list pointer —
  // "Updates requested" + an "N to fix" badge — and its action deep-links the
  // listing focused on the feedback sheet. The row's presence is unchanged (it
  // still vanishes the moment the claim resolves); the count only escalates it.
  if (input.venueClaimPending) {
    const openCount = input.venueClaimOpenFeedbackCount;
    if (openCount > 0) {
      todos.push({
        id: "venue_claim_review",
        label: "Updates requested",
        sublabel: "A few tweaks will get you live — tap to see what to fix",
        badge: openCount === 1 ? "1 to fix" : `${openCount} to fix`,
        action: { kind: "route", route: input.venueFeedbackRoute },
      });
    } else {
      todos.push({
        id: "venue_claim_review",
        label: "Venue claim under review",
        sublabel: "We're verifying your venue — usually within 4 business hours",
        action: { kind: "route", route: input.venueListingRoute },
      });
    }
  }

  // 3 — First offering.
  if (input.counts.total === 0) {
    todos.push({
      id: "create_offering",
      label: "Create your first offering",
      sublabel: "Event, experience, or trip",
      action: { kind: "open_universal_creator" },
    });
  }

  // 4 — Stripe. ORCH-1040: show whenever the brand has NOT activated Stripe — any
  // brand without active Stripe can't take payments yet, so surface it regardless
  // of whether a paid offering exists. Sublabel sharpens when a paid draft waits.
  if (!input.stripeActive) {
    todos.push({
      id: "connect_stripe",
      label: "Connect bank to take payments",
      sublabel: input.hasDraftPaidOffering
        ? "You have a paid offering ready"
        : "Set up payouts so you can sell",
      action: { kind: "route", route: input.stripeRoute },
    });
  }

  // 5 — Finish a draft (has a draft, nothing live yet).
  if (
    input.counts.live === 0 &&
    input.counts.draft > 0 &&
    input.draftRoute !== null
  ) {
    todos.push({
      id: "finish_draft",
      label: "Finish your draft",
      sublabel: "Publish it to go live",
      action: { kind: "route", route: input.draftRoute },
    });
  }

  return todos;
}
