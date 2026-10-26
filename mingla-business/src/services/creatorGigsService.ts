import { supabase } from "./supabase";
import { postHogService } from "./postHogService";

export type PublicGig = {
  id: string;
  title_public: string;
  brief_public: string;
  format_key: string;
  deliverables: Array<{ platform: string; kind: string; count: number }>;
  city_name: string;
  category: string;
  shoot_window: { start: string; end: string };
  post_by: string;
  usage_days: number;
  budget_band: string;
  sales_share_bps: number | null;
  slots_left: number;
};

export type GigApplicant = {
  interest_id: string;
  creator_id: string;
  display_name: string;
  niches: string[];
  follower_bands: Array<{ platform: string; band: string; verified: boolean }>;
  rating: number | null;
  completed: number;
  reliability: number | null;
  quote_minor: number;
  currency: string;
  package_id: string;
  note: string | null;
  status: string;
};

export type GigDisputeOffer = {
  id: string;
  offered_by: "host" | "creator";
  refund_bps: number;
  note: string | null;
  status: "open" | "accepted" | "declined" | "expired";
  created_at: string;
};

export type GigDispute = {
  id: string;
  status: string;
  opened_by: "host" | "creator";
  reason: string;
  statement: string;
  decided_outcome: string | null;
  decided_refund_bps: number | null;
  decided_note: string | null;
  offers: GigDisputeOffer[];
};

export type GigWorkspace = {
  contract: { id: string; state: string; state_deadline_at: string | null; fix_rounds_used: number };
  party: "host" | "creator" | "admin";
  revealed: boolean;
  gig: Record<string, unknown> & { title_public: string; brief_public: string; format_key: string; post_by: string };
  terms: Array<Record<string, unknown> & { version: number; fee_minor: number; booking_fee_minor: number; currency: string }>;
  proposals: Array<{ id: string; from_version: number; proposed_by: "host" | "creator"; changes: Record<string, unknown>; reason: string; note: string | null; status: string; expires_at: string }>;
  events: Array<{ id: string; at: string; actor: string; kind: string; data: Record<string, unknown> }>;
  hold: Record<string, unknown> | null;
  shoot_plan: Record<string, unknown> | null;
  scripts: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown> & { id: string; round: number; decision: string | null }>;
  posts: Array<Record<string, unknown>>;
  dispute: GigDispute | null;
  ratings: Array<Record<string, unknown>>;
};

async function rpc<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

export async function fetchCreatorGigsAccess(brandId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("brand_creator_gigs_access", { p_brand_id: brandId });
  if (error) throw error;
  return data === true;
}

export const creatorGigsService = {
  board: (cityId?: string | null, formatKey?: string | null) => rpc<PublicGig[]>("creator_gig_board", { p_city_id: cityId ?? null, p_format_key: formatKey ?? null }),
  detail: (gigId: string) => rpc<PublicGig>("creator_gig_detail", { p_gig_id: gigId }),
  sendInterest: (gigId: string, packageId: string, quotedMinor: number, note?: string) => rpc("gig_interest_send", { p_gig_id: gigId, p_package_id: packageId, p_quoted_minor: quotedMinor, p_note: note ?? null }),
  hostHome: (brandId: string) => rpc<{ gigs: Array<Record<string, unknown>>; contracts: Array<Record<string, unknown>> }>("gig_host_home", { p_brand_id: brandId }),
  saveGig: async (payload: Record<string, unknown>) => {
    const result = await rpc<{ ok: boolean; id?: string; error?: string; reasons?: string[] }>("gig_save", { p_payload: payload });
    if (result.ok) postHogService.capture("gig_created", { format: typeof payload.format_key === "string" ? payload.format_key : "unknown" });
    return result;
  },
  applicants: (gigId: string) => rpc<GigApplicant[]>("gig_applicants", { p_gig_id: gigId }),
  prehireProfile: (creatorId: string) => rpc<Record<string, unknown>>("prehire_creator_profile", { p_creator_account_id: creatorId }),
  decideInterest: (interestId: string, status: "shortlisted" | "passed") => rpc("gig_interest_decide", { p_interest_id: interestId, p_status: status }),
  workspace: (contractId: string) => rpc<GigWorkspace>("gig_contract_workspace", { p_contract_id: contractId }),
  transition: (contractId: string, expectedState: string, action: string, payload: Record<string, unknown> = {}) => rpc("gig_transition", { p_contract_id: contractId, p_expected_state: expectedState, p_action: action, p_payload: payload }),
  proposeChange: (contractId: string, changes: Record<string, unknown>, reason: string, note?: string) => rpc("gig_change_proposal_save", { p_contract_id: contractId, p_changes: changes, p_reason: reason, p_note: note ?? null }),
  respondToChange: (proposalId: string, accept: boolean) => rpc("gig_change_proposal_respond", { p_proposal_id: proposalId, p_accept: accept }),
  planShoot: (contractId: string, shootAt: string, arrivalNote: string, confirm: boolean) => rpc("gig_shoot_plan_save", { p_contract_id: contractId, p_shoot_at: shootAt, p_arrival_note: arrivalNote, p_confirm: confirm }),
  saveScript: (contractId: string, body: Record<string, unknown>, source: "ari" | "creator", send: boolean) => rpc("gig_script_save", { p_contract_id: contractId, p_body: body, p_source: source, p_send: send }),
  submitDelivery: (contractId: string, mediaJobId: string) => rpc("gig_delivery_submit", { p_contract_id: contractId, p_media_job_id: mediaJobId }),
  decideDelivery: (deliveryId: string, decision: "approved" | "fix_requested", categories: string[] = [], note?: string) => rpc("gig_delivery_decide", { p_delivery_id: deliveryId, p_decision: decision, p_fix_categories: categories, p_fix_note: note ?? null }),
  submitPosts: (contractId: string, posts: Array<{ platform: string; url: string }>) => rpc("gig_posts_submit", { p_contract_id: contractId, p_posts: posts }),
  openDispute: (contractId: string, reason: string, statement: string) => rpc("gig_dispute_open", { p_contract_id: contractId, p_reason: reason, p_statement: statement, p_evidence_media_ids: [] }),
  offerDispute: (disputeId: string, refundBps: number, note?: string) => rpc("gig_dispute_offer", { p_dispute_id: disputeId, p_refund_bps: refundBps, p_note: note ?? null }),
  async respondToDisputeOffer(offerId: string, accept: boolean) {
    const { data, error } = await supabase.functions.invoke("gig-dispute-resolve", { body: { offer_id: offerId, accept } });
    if (error) throw error;
    return data;
  },
  rate: (contractId: string, stars: number, tags: string[], note?: string) => rpc("gig_rating_submit", { p_contract_id: contractId, p_stars: stars, p_tags: tags, p_note: note ?? null }),
  async refund(contractId: string, branch: "host_before_accept" | "host_after_accept_before_lock" | "creator_after_accept" | "creator_decline" | "declined_or_expired" | "resolved_partial" | "resolved_refund", refundBps?: number) {
    const { data, error } = await supabase.functions.invoke("gig-refund", { body: { contract_id: contractId, branch, refund_bps: refundBps } });
    if (error) throw error;
    return data;
  },
};
