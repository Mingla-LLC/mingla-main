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
// #3355 P5 — type-only: brand profile + money rows come from the server's
// canonical readiness read (brand_readiness); nothing here derives them.
import type { BrandReadinessState } from "../services/brandReadinessService";
// #2829 W9a — type-only: the website row is derived by the plan module,
// which the boot path loads lazily (useWebsiteTodo).
import type { WebsiteTodo } from "../sites/websiteTodo";

/**
 * META-ORCH-1255 — one per-venue pipeline row for the `get_venue_live` band.
 * `route` is precomputed by the caller (routeForPipelineStateFix fed the
 * venue's pipeline row) — this module stays route-string-agnostic.
 */
export interface VenueTodoPipeline {
  venueId: string;
  venueName: string;
  status: BrandPlacePipelineState["status"];
  route: string;
}

/**
 * Issue #1685 [venue-draft-multi] — one unfinished venue draft, as a resume row
 * input. Each half-built venue gets its OWN row, because `/venue/create` no
 * longer resumes anything: the row's `route` (which carries the draft id) is the
 * only door back into that draft.
 */
export interface VenueTodoDraft {
  draftId: string;
  /** displayName || workingName, trimmed. Empty when the operator has not named it yet. */
  venueName: string;
  /** Precomputed by the caller — `/venue/create?draft=<draftId>`. */
  route: string;
}

/**
 * Issue #1735 G-15 — one Insights nudge row input. `route` is precomputed by
 * the caller (`/venue/{venueId}?module=insights`) — this module stays
 * route-string-agnostic. The caller emits a row ONLY when the underlying
 * latest-read genuinely answered `status:"none"` (never on loading/error —
 * a to-do row must be a true statement), only for verified non-stay venues,
 * and the `pricing` kind only once #1737 registers its instrument (a to-do
 * row must never deep-link to a surface that doesn't render).
 */
export interface InsightsNudgeTodo {
  venueId: string;
  venueName: string;
  kind: "site" | "pricing";
  route: string;
}

export interface VenueOrderCompletenessTodo {
  venueId: string;
  venueName: string;
  kind: "zones" | "item_costs";
  count: number;
  route: string;
}

/** META-ORCH-1255 — one per-venue claim row for the `venue_claim_review` band. */
export interface VenueTodoClaim {
  venueId: string;
  venueName: string;
  variant: "pending_review" | "follow_up";
  /** Open admin-feedback items in the active round (0 = plain pending). */
  openCount: number;
  /** Route to the venue's listing surface. */
  route: string;
  /** Route with the feedback sheet auto-opened (used when openCount > 0). */
  feedbackRoute: string;
}

export type BusinessTodoAction =
  | { kind: "open_brand_switcher" }
  | { kind: "open_universal_creator" }
  | { kind: "route"; route: string }
  // ORCH-1111 — open the Accept/Decline sheet for a pending brand invitation.
  | { kind: "open_pending_invite"; invitationId: string; brandName: string }
  // #3355 P5 (C9) — a row this member cannot act on. It names who can and is
  // rendered as plain text (no chevron, no tap), never as a dead button.
  | { kind: "info" };

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
  /** #3355 P5 — the canonical readiness item key behind this row. */
  readinessKey?: string;
  /** #3355 P5 — the readiness read failed; the row offers "Try again". */
  retryReadinessBrandId?: string;
}

/** One canonical readiness item as Home needs it (mapped by the hook). */
export interface BusinessTodoReadinessItem {
  key: string;
  state: BrandReadinessState;
  canCallerFix: boolean;
  /** Server copy, e.g. "a brand admin or the owner". */
  whoCanFix: string;
}

/**
 * #3355 P5 — the canonical brand readiness answer for the current brand.
 * `loading` → no brand/profile/money rows yet (a row must be a true
 * statement); `error` → one honest "couldn't check" row with Try again.
 */
export type BusinessTodoBrandReadiness =
  | { status: "loading" }
  | { status: "error"; brandId: string }
  | {
      status: "ready";
      brandId: string;
      /** `/brand/{id}/edit`, precomputed by the caller. */
      editRoute: string;
      /** Scanner role: profile and money rows are hidden entirely (C9). */
      hideBrandRows: boolean;
      items: readonly BusinessTodoReadinessItem[];
    };

/**
 * #3355 P5 — the Home rows that come from canonical readiness items. ONE map,
 * so Home and Ari name the same keys. Keys absent here are not Home rows:
 * Website items (the website row covers them), money keys (the money band
 * below), action-scoped items, and `timezone` (no Host form control yet —
 * Ari asks it; a Home row would be a dead end).
 */
export const HOME_READINESS_ROWS = [
  { key: "cover_media", id: "profile_add_cover", label: "Add a cover", sublabel: "Make your public page pop", section: "cover" },
  { key: "profile_photo", id: "profile_add_photo", label: "Add a profile photo", sublabel: "Put a face on your brand", section: "photo" },
  { key: "name", id: "profile_add_name", label: "Add your brand name", sublabel: "What people will call you", section: "about" },
  { key: "tagline", id: "profile_add_tagline", label: "Add a tagline", sublabel: "One line that says what you do", section: "about" },
  { key: "description", id: "profile_add_description", label: "Describe your brand", sublabel: "Tell people what you're about", section: "about" },
  { key: "address", id: "profile_add_address", label: "Add your address", sublabel: "Help people find you", section: "address" },
  { key: "city_country", id: "profile_add_city_country", label: "Add your city and country", sublabel: "Pick your address to set them", section: "address" },
  { key: "contact_email", id: "profile_add_email", label: "Add a contact email", sublabel: "So customers can reach you", section: "contact" },
  { key: "contact_phone", id: "profile_add_phone", label: "Add a phone number", sublabel: "Another way to reach you", section: "contact" },
  { key: "social_links", id: "profile_add_socials", label: "Add your social links", sublabel: "Instagram, TikTok, your website and more", section: "social" },
  { key: "theme", id: "profile_choose_theme", label: "Choose your page look", sublabel: "Colours and font for your public page", section: "theme" },
] as const;

/** Readiness keys behind the money rows (money band). */
export const HOME_MONEY_READINESS_KEYS = {
  canSell: "money.can_sell",
  canBePaidOut: "money.can_be_paid_out",
} as const;

const isReadinessDone = (state: BrandReadinessState): boolean =>
  state === "verified" || state === "not_applicable";

function readinessSublabel(
  item: BusinessTodoReadinessItem,
  fallback: string,
): string {
  if (!item.canCallerFix) return `Ask ${item.whoCanFix} to do this`;
  switch (item.state) {
    case "stale":
    case "conflict":
      return "Check this — it may be out of date";
    case "invalid":
      return "This needs fixing";
    default:
      return fallback;
  }
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
  /**
   * #4111 D4 — one row per customer enquiry waiting on the team (new|waiting),
   * across every brand the person answers enquiries for. Rendered right after
   * invites. Precomputed by the caller (`brandEnquiryTodos`).
   */
  enquiryTodos?: { id: string; label: string; sublabel: string; route: string }[];
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
   * Issue #1685 — EVERY unfinished venue draft for the current brand, newest
   * first (the live hook always passes it). WHEN PRESENT the single
   * `finish_venue` row is REPLACED by one `finish_venue:<draftId>` row per
   * draft, named when there is more than one — the `get_venue_live` naming
   * precedent below. Absent → legacy singular behaviour (pinned fixtures).
   */
  venueDrafts?: VenueTodoDraft[];
  /**
   * ORCH-1040 — the brand has a physical location (opt-in toggle).
   * [TRANSITIONAL] META-ORCH-1255: OPTIONAL + production-dormant. The toggle
   * is deleted (venue creation lives in the creator sheet) and the LIVE hook
   * passes the per-venue arrays below instead; this field only keeps the
   * append-only pinned fixtures compiling/behaving. Exit: fixture supersession.
   */
  hasPhysicalLocation?: boolean;
  /**
   * META-ORCH-1255 — per-venue pipeline rows. WHEN PRESENT (the live hook
   * always passes it) the legacy singular pipelineStatus/pipelineRoute venue
   * band is REPLACED by one `get_venue_live` row PER venue with status ∈
   * processing|needs_fix|failed, and `add_venue` never renders (creation
   * lives in the creator sheet — an unconditional nag is what ORCH-1040
   * forbade). Absent → legacy behavior (pinned fixtures).
   */
  venuePipelines?: VenueTodoPipeline[];
  /**
   * META-ORCH-1255 — per-venue claim rows. WHEN PRESENT the legacy singular
   * venueClaimPending band is REPLACED by one `venue_claim_review` row per
   * venue with a pending/follow-up claim. Absent → legacy behavior.
   */
  venueClaims?: VenueTodoClaim[];
  /** Upcoming buckets (total = live+upcoming+draft; past already filtered out). */
  counts: { total: number; live: number; draft: number };
  /**
   * The brand can sell (take paid sales). With `brandReadiness` this is the
   * server's `money.can_sell` (`pg_brand_can_collect`), never a client guess.
   */
  stripeActive: boolean;
  /**
   * #3645 PR10 — the brand can RECEIVE payouts (bank / recipient connected).
   * `stripeActive` stays the charge-ready flag (publish + sell). When this is
   * explicitly `false` while `stripeActive` is true the brand is selling but
   * its money is waiting, so Home shows "Add a bank to get paid". Absent →
   * no bank row (legacy fixtures).
   */
  payoutReady?: boolean;
  /** Server-derived payout action. Absent on loading/error so the readiness fallback remains honest. */
  payoutAttention?: {
    kind: "add_bank" | "fix_bank" | "finish_stripe";
    amountLabel?: string;
  };
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
  /**
   * #3355 P5 — the canonical brand readiness answer (replaces the ORCH-1256
   * client-derived `profile` booleans). OPTIONAL so callers/tests that never
   * pass it compile + behave unchanged: absent ⇒ zero profile rows and the
   * money band reads `stripeActive` / `payoutReady` as given. Present ⇒ the
   * profile band is built from its items and the money band waits for it.
   */
  brandReadiness?: BusinessTodoBrandReadiness;
  /**
   * #2829 W9a — the website plan row ("Build your website" / "Finish your
   * website · n of 8 done · next: …" / "Your website · Ask an admin to start
   * it"), already decided from Core's plan answer. Absent or null → no row.
   */
  website?: WebsiteTodo | null;
  /**
   * Issue #1735 G-15 — Insights nudge rows. OPTIONAL so pre-1735
   * callers/tests compile + behave unchanged (absent ⇒ zero rows). Emitted
   * as the LAST band, AFTER the ORCH-1256 profile band: these are nudges,
   * never setup blockers, and the operator-locked priority order above them
   * is untouched.
   */
  insightsNudges?: InsightsNudgeTodo[];
  /** #1795 — successful, authorized order-metrics completeness actions only. */
  venueOrderCompleteness?: VenueOrderCompletenessTodo[];
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

  // #4111 — guests waiting for a reply come straight after invites, whatever
  // brand is selected (the route opens the enquiry itself).
  const enquiryTodos: BusinessTodo[] = (input.enquiryTodos ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    sublabel: row.sublabel,
    action: { kind: "route", route: row.route },
  }));
  const leadingTodos: BusinessTodo[] = [...inviteTodos, ...enquiryTodos];

  // 1 — Brand gate. Without a usable brand, the only thing to do is create/select
  // one; nothing downstream applies, so we return early — but invite(s) first.
  if (input.hasNoBrands) {
    return [
      ...leadingTodos,
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
      ...leadingTodos,
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
    return leadingTodos;
  }

  const todos: BusinessTodo[] = [...leadingTodos];

  // 2 — Venue. META-ORCH-1255: PER-VENUE rows when the caller passes the
  // venue arrays (the live hook always does). `add_venue` is GONE on this
  // path — creation lives in the creator sheet's 4th option; `finish_venue`
  // stays, gated ONLY on the CURRENT brand's in-progress draft.
  const multiVenue = input.venuePipelines !== undefined;
  if (multiVenue) {
    // Issue #1685 — one resume row PER unfinished draft. This row's route is
    // the ONLY way back into a draft: "+" -> "Create venue listing" always
    // starts fresh now.
    const venueDrafts = input.venueDrafts;
    if (venueDrafts !== undefined) {
      // Named only when there is more than one, exactly like `get_venue_live`
      // below — so the single-draft experience stays byte-identical to today.
      const namedDrafts = venueDrafts.length > 1;
      for (const d of venueDrafts) {
        todos.push({
          id: `finish_venue:${d.draftId}`,
          label:
            namedDrafts && d.venueName.length > 0
              ? `Finish adding ${d.venueName}`
              : "Finish adding your venue",
          sublabel: "Pick up where you left off",
          action: { kind: "route", route: d.route },
        });
      }
    } else if (input.venueDraftInProgress) {
      todos.push({
        id: "finish_venue",
        label: "Finish adding your venue",
        sublabel: "Pick up where you left off",
        action: { kind: "route", route: "/venue/create" },
      });
    }
    const namedVenues = (input.venuePipelines ?? []).length > 1;
    for (const vp of input.venuePipelines ?? []) {
      if (
        vp.status !== "processing" &&
        vp.status !== "needs_fix" &&
        vp.status !== "failed"
      ) {
        continue;
      }
      todos.push({
        id: `get_venue_live:${vp.venueId}`,
        label: namedVenues ? `Get ${vp.venueName} live` : "Get your venue live",
        sublabel: venueLiveSublabel(vp.status),
        action: { kind: "route", route: vp.route },
      });
    }
  } else if (input.pipelineFetched && input.pipelineStatus === null) {
    // [TRANSITIONAL] legacy singular band (pinned fixtures only — the live
    // hook always passes venuePipelines). ORCH-1040 gating preserved verbatim.
    if (input.hasPhysicalLocation === true) {
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
  if (input.venueClaims !== undefined) {
    // META-ORCH-1255 — one row PER venue with a pending/follow-up claim; the
    // label names the venue when the brand has >1 venue.
    const namedClaims =
      (input.venuePipelines ?? input.venueClaims).length > 1;
    for (const vc of input.venueClaims) {
      if (vc.variant === "follow_up" && vc.openCount > 0) {
        todos.push({
          id: `venue_claim_review:${vc.venueId}`,
          label: namedClaims
            ? `Updates requested — ${vc.venueName}`
            : "Updates requested",
          sublabel: "A few tweaks will get you live — tap to see what to fix",
          badge: vc.openCount === 1 ? "1 to fix" : `${vc.openCount} to fix`,
          action: { kind: "route", route: vc.feedbackRoute },
        });
      } else {
        todos.push({
          id: `venue_claim_review:${vc.venueId}`,
          label: namedClaims
            ? `${vc.venueName} claim under review`
            : "Venue claim under review",
          sublabel:
            "We're verifying your venue — usually within 4 business hours",
          action: { kind: "route", route: vc.route },
        });
      }
    }
  } else if (input.venueClaimPending) {
    // [TRANSITIONAL] legacy singular band (pinned fixtures only).
    // EXIT: delete when the pinned append-only fixtures retire (ORCH-1261).
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

  // 4 — Money. ORCH-1040: show whenever the brand cannot take payments — any
  // brand that can't sell can't take payments yet, so surface it regardless
  // of whether a paid offering exists. Sublabel sharpens when a paid draft waits.
  // #3355 P5 — when the caller passes canonical readiness, `stripeActive` /
  // `payoutReady` are the server's can_sell / can_be_paid_out; the band waits
  // for that answer, is hidden for scanners, and names who can fix it.
  const readiness = input.brandReadiness;
  const moneyKnown = readiness === undefined || readiness.status === "ready";
  const moneyHidden = readiness?.status === "ready" && readiness.hideBrandRows;
  const moneyItem = (key: string): BusinessTodoReadinessItem | undefined =>
    readiness?.status === "ready"
      ? readiness.items.find((item) => item.key === key)
      : undefined;
  const moneyRow = (todo: BusinessTodo, key: string): BusinessTodo => {
    const item = moneyItem(key);
    if (item === undefined) return todo;
    return {
      ...todo,
      sublabel: readinessSublabel(item, todo.sublabel ?? ""),
      action: item.canCallerFix ? todo.action : { kind: "info" },
      readinessKey: item.key,
    };
  };
  if (!moneyKnown || moneyHidden) {
    // No money row until the canonical answer exists; none for scanners.
  } else if (!input.stripeActive) {
    todos.push(
      moneyRow(
        {
          id: "connect_stripe",
          label: "Connect bank to take payments",
          sublabel: input.hasDraftPaidOffering
            ? "You have a paid offering ready"
            : "Set up payouts so you can sell",
          action: { kind: "route", route: input.stripeRoute },
        },
        HOME_MONEY_READINESS_KEYS.canSell,
      ),
    );
  } else if (input.payoutAttention?.kind === "add_bank") {
    todos.push(
      moneyRow(
        {
          id: "add_bank_to_get_paid",
          label: input.payoutAttention.amountLabel
            ? `Add a bank to get ${input.payoutAttention.amountLabel}`
            : "Add a bank to get paid",
          sublabel: "Your sales are waiting. Takes about a minute.",
          action: { kind: "route", route: input.stripeRoute },
        },
        HOME_MONEY_READINESS_KEYS.canBePaidOut,
      ),
    );
  } else if (input.payoutAttention?.kind === "fix_bank") {
    todos.push({
      id: "fix_bank_details",
      label: "Fix your bank details",
      sublabel: "Your payout couldn’t be sent.",
      action: { kind: "route", route: input.stripeRoute },
    });
  } else if (input.payoutAttention?.kind === "finish_stripe") {
    todos.push({
      id: "finish_stripe_to_get_paid",
      label: "Finish verification to get paid",
      sublabel: "Our payment partner needs to confirm your details before it can pay you.",
      action: { kind: "route", route: input.stripeRoute },
    });
  } else if (input.payoutReady === false) {
    // #3645 PR10 — charge-ready but not payout-ready: the brand can keep
    // selling, its money waits until a bank is added. Same rung as
    // `homeNextAction` (rung 1b).
    todos.push(
      moneyRow(
        {
          id: "add_bank_to_get_paid",
          label: "Add a bank to get paid",
          sublabel: "You can keep selling. Your money waits until you add a bank.",
          action: { kind: "route", route: input.stripeRoute },
        },
        HOME_MONEY_READINESS_KEYS.canBePaidOut,
      ),
    );
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

  // 5b — #2829 W9a — the website plan (design contract chapter 1: after
  // getting paid, before profile polish). Vanishes after the first publish.
  if (input.website) {
    const website = input.website;
    if (website.variant === "build") {
      todos.push({
        id: "website_build",
        label: "Build your website",
        sublabel: "Ari walks you through it · about 15 min",
        action: { kind: "route", route: website.route },
      });
    } else if (website.variant === "finish") {
      todos.push({
        id: "website_build",
        label: "Finish your website",
        sublabel: website.nextLabel
          ? `${website.done} of 8 done · next: ${website.nextLabel}`
          : `${website.done} of 8 done`,
        action: { kind: "route", route: website.route },
      });
    } else {
      todos.push({
        id: "website_build",
        label: "Your website",
        sublabel: "Ask an admin to start it",
        action: { kind: "route", route: website.route },
      });
    }
  }

  // 6 — Brand profile (ORCH-1256, rebuilt #3355 P5). TAIL band, after
  // finish_draft: profile fields are presentation polish that block NO
  // transaction, so they rank BELOW every revenue/liveness gate above. The
  // rows are the canonical readiness items (brand_readiness) through ONE map
  // (HOME_READINESS_ROWS) — the same keys and states Ari reads. A row shows
  // while its item is not done. Home is the reminder list (Seth, 2026-11-01):
  // an Ari "not now" never hides, dims or reorders a row here.
  // Each row deep-links its brand-edit section via ?section=.
  if (readiness?.status === "error") {
    todos.push({
      id: "brand_readiness_error",
      label: "Couldn't check your brand setup",
      sublabel: "Your to-do list may be missing items",
      action: { kind: "info" },
      retryReadinessBrandId: readiness.brandId,
    });
  } else if (readiness?.status === "ready" && !readiness.hideBrandRows) {
    for (const row of HOME_READINESS_ROWS) {
      const item = readiness.items.find((candidate) => candidate.key === row.key);
      if (item === undefined || isReadinessDone(item.state)) continue;
      todos.push({
        id: row.id,
        label: row.label,
        sublabel: readinessSublabel(item, row.sublabel),
        action: item.canCallerFix
          ? { kind: "route", route: `${readiness.editRoute}?section=${row.section}` }
          : { kind: "info" },
        readinessKey: item.key,
      });
    }
  }

  // 7 — Insights nudges (issue #1735 G-15). LAST band, after profile: a nudge,
  // never a setup blocker. One row per (venue, kind); each vanishes the
  // moment a stored check exists (the caller stops emitting it).
  for (const nudge of input.insightsNudges ?? []) {
    if (nudge.kind === "site") {
      todos.push({
        id: `insights_site:${nudge.venueId}`,
        label: `You haven't checked ${nudge.venueName}'s website`,
        sublabel: "Free check — takes under a minute",
        action: { kind: "route", route: nudge.route },
      });
    } else {
      todos.push({
        id: `insights_pricing:${nudge.venueId}`,
        label: `You haven't checked ${nudge.venueName}'s pricing`,
        sublabel: "Are you undercharging?",
        action: { kind: "route", route: nudge.route },
      });
    }
  }

  // 8 — #1795 order-data completeness. These rows are emitted only after a
  // successful authorized RPC read with at least one order; loading, error,
  // offline-without-cache, unauthorized, and zero-order states never reach here.
  for (const action of input.venueOrderCompleteness ?? []) {
    if (action.kind === "zones") {
      todos.push({
        id: `venue_order_zones:${action.venueId}`,
        label: `Zone ${action.venueName}'s tables`,
        sublabel: `${action.count} active ${action.count === 1 ? "table needs" : "tables need"} a zone`,
        action: { kind: "route", route: action.route },
      });
    } else {
      todos.push({
        id: `venue_order_item_costs:${action.venueId}`,
        label: `Add item costs for ${action.venueName}`,
        sublabel: `${action.count} sold ${action.count === 1 ? "item needs" : "items need"} a cost`,
        action: { kind: "route", route: action.route },
      });
    }
  }

  return todos;
}
