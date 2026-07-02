/**
 * Ve3 — fetch venue claim status for mingla-business operators.
 *
 * META-ORCH-1255 Leg B — RE-KEYED to the `venue_listings` row: the claim
 * lifecycle lives on the VENUE row (I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-
 * ROW), never on `brands.claim_status` (legacy-inert). The review/resubmit
 * RPCs are venue-keyed (`p_venue_id`); the active-feedback view is grouped
 * per venue (Leg A M2).
 */

import { supabase } from "./supabase";
import type { VenueClaimStatusRow } from "./venueClaimBannerLogic";

export type {
  VenueClaimBannerVariant,
  VenueClaimStatusRow,
} from "./venueClaimBannerLogic";
export {
  venueClaimBannerCopy,
  venueClaimBannerVariant,
} from "./venueClaimBannerLogic";

export async function fetchVenueClaimStatus(
  venueId: string,
): Promise<VenueClaimStatusRow | null> {
  const { data, error } = await supabase
    .from("venue_listings")
    .select("claim_status, rejection_reason, claim_follow_up_at")
    .eq("id", venueId)
    .maybeSingle();

  if (error !== null) throw error;
  if (data === null) return null;
  return data as VenueClaimStatusRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCH-1064 — venue-claim feedback loop (admin→business).
// ─────────────────────────────────────────────────────────────────────────────

/** ORCH-1064 — one structured feedback item the admin left on a claim. */
export type FeedbackCategory =
  | "photos"
  | "address"
  | "hours"
  | "category"
  | "description"
  | "quality"
  | "other";

export interface VenueClaimFeedbackItem {
  id: string;
  brand_id: string;
  /** META-ORCH-1255 — feedback rows are keyed per venue. */
  venue_id: string;
  round: number;
  category: FeedbackCategory;
  note: string;
  overall_message: string | null;
  status: "open" | "fixed";
  created_at: string;
  resolved_at: string | null;
}

/**
 * ORCH-1064 — read the active feedback round for a VENUE (owner-RLS-gated
 * view; META-ORCH-1255 re-keyed the round grouping per venue). Returns the
 * rows ordered by category then created_at. Throws on error (services throw;
 * the hook surfaces the error state).
 */
export async function fetchVenueClaimFeedback(
  venueId: string,
): Promise<VenueClaimFeedbackItem[]> {
  const { data, error } = await supabase
    .from("venue_claim_active_feedback")
    .select(
      "id, brand_id, venue_id, round, category, note, overall_message, status, created_at, resolved_at",
    )
    .eq("venue_id", venueId)
    .order("category", { ascending: true })
    .order("created_at", { ascending: true });

  if (error !== null) throw error;
  return (data ?? []) as VenueClaimFeedbackItem[];
}

/**
 * META-ORCH-1255 — ALL active-round feedback rows of a brand in one read (the
 * per-venue to-do badges group these by venue_id; avoids N per-venue fetches).
 */
export async function fetchVenueClaimFeedbackForBrand(
  brandId: string,
): Promise<VenueClaimFeedbackItem[]> {
  const { data, error } = await supabase
    .from("venue_claim_active_feedback")
    .select(
      "id, brand_id, venue_id, round, category, note, overall_message, status, created_at, resolved_at",
    )
    .eq("brand_id", brandId)
    .order("category", { ascending: true })
    .order("created_at", { ascending: true });

  if (error !== null) throw error;
  return (data ?? []) as VenueClaimFeedbackItem[];
}

/**
 * ORCH-1064 — toggle a feedback item open↔fixed via the owner-gated RPC.
 * @returns the persisted `{ ok, id, status }`.
 */
export async function markFeedbackItemFixed(
  feedbackId: string,
  fixed: boolean,
): Promise<{ ok: boolean; id: string; status: "open" | "fixed" }> {
  const { data, error } = await supabase.rpc("biz_mark_feedback_item_fixed", {
    p_feedback_id: feedbackId,
    p_fixed: fixed,
  });
  if (error !== null) throw error;
  return data as { ok: boolean; id: string; status: "open" | "fixed" };
}

/**
 * ORCH-1064 — re-submit a claim that received feedback (clears the follow-up
 * stamp so it returns to the admin Pending queue as a fresh pending_review).
 * META-ORCH-1255 — venue-keyed (`biz_resubmit_venue_claim(p_venue_id)`).
 */
export async function resubmitVenueClaim(
  venueId: string,
): Promise<{ ok: boolean; venue_id: string; resubmitted_round: number }> {
  const { data, error } = await supabase.rpc("biz_resubmit_venue_claim", {
    p_venue_id: venueId,
  });
  if (error !== null) throw error;
  return data as { ok: boolean; venue_id: string; resubmitted_round: number };
}
