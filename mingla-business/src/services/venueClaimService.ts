/**
 * Ve3 — fetch venue claim status for mingla-business operators.
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
  brandId: string,
): Promise<VenueClaimStatusRow | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("kind, claim_status, rejection_reason, claim_follow_up_at")
    .eq("id", brandId)
    .is("deleted_at", null)
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
  round: number;
  category: FeedbackCategory;
  note: string;
  overall_message: string | null;
  status: "open" | "fixed";
  created_at: string;
  resolved_at: string | null;
}

/**
 * ORCH-1064 — read the active feedback round for a brand (owner-RLS-gated view).
 * Returns the rows ordered by category then created_at. Throws on error
 * (services throw; the hook surfaces the error state).
 */
export async function fetchVenueClaimFeedback(
  brandId: string,
): Promise<VenueClaimFeedbackItem[]> {
  const { data, error } = await supabase
    .from("venue_claim_active_feedback")
    .select(
      "id, brand_id, round, category, note, overall_message, status, created_at, resolved_at",
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
 */
export async function resubmitVenueClaim(
  brandId: string,
): Promise<{ ok: boolean; brand_id: string; resubmitted_round: number }> {
  const { data, error } = await supabase.rpc("biz_resubmit_venue_claim", {
    p_brand_id: brandId,
  });
  if (error !== null) throw error;
  return data as { ok: boolean; brand_id: string; resubmitted_round: number };
}
