import { postHogService } from './postHogService';
import { programEdge, programRead, programWrite } from './programApi';

export type PublicGig = {
  id: string; title_public: string; brief_public: string; format_key: string;
  deliverables: Array<{ platform: string; kind: string; count: number }>;
  city_name: string; category: string; shoot_window: { start: string; end: string };
  post_by: string; usage_days: number; sales_share_bps: number | null; slots_left: number;
  rights_model?: 'legacy_timed' | 'creator_v1_perpetual'; agreement_version?: string | null; agreement_url?: string | null;
  /** When the video is due and the set shoot time (timestamptz), when the host gave them. */
  video_due_at?: string | null; shoot_at?: string | null;
  saved?: boolean;
  /** The most the host pays each creator, in the gig's currency (null on gigs saved before pay existed). */
  pay_up_to_minor?: number | null; currency?: string | null;
};

export type CreatorHomeContract = {
  id: string; state: string; deadline_at: string | null; title: string; format_key: string; city: string; post_by: string;
  /** The agreed exact due time (current terms). */
  video_due_at?: string | null;
  fee_minor: number; currency: string; updated_at: string;
  /** Creator-words key for the one next action (server), and when it's due. */
  next_action?: string | null; due_at?: string | null; fix_rounds_used?: number | null;
  /** A counter-offer from you is waiting for the host. */
  counter_open?: boolean | null;
};
export type CreatorHomeInterest = { id: string; gig_id: string; title: string; status: string; quote_minor: number; currency: string; created_at: string };
export type CreatorHome = { contracts: CreatorHomeContract[]; interests: CreatorHomeInterest[]; saved?: PublicGig[] };

export type GigTerms = Record<string, unknown> & {
  version: number; fee_minor: number; booking_fee_minor: number; currency: string; format_key?: string;
  deliverables?: Array<{ platform: string; kind: string; count: number }>; shoot_date?: string | null; post_by?: string;
  /** The agreed exact due time for this version. */
  video_due_at?: string | null;
  usage_days?: number; sales_share_bps?: number | null; proposed_by?: 'host' | 'creator'; accepted_at?: string | null; created_at?: string;
};
export type GigProposal = { id: string; from_version: number; proposed_by: 'host' | 'creator'; changes: Record<string, unknown>; reason: string; note: string | null; status: string; expires_at: string; created_at?: string };
export type GigEvent = { id: string; at: string; actor: string; kind: string; data: Record<string, unknown> };
export type GigScript = { version: number; body: { sections?: Array<Record<string, unknown>>; disclosure?: string; estimated_seconds?: number }; source: string; sent_at: string | null; locked_at: string | null; locked_by: string | null };
export type GigDelivery = Record<string, unknown> & { id: string; round: number; decision: string | null; fix_categories?: string[]; fix_note?: string | null; submitted_at?: string };
export type GigPost = { id: string; platform: string; url: string; check_status: string; submitted_at: string };

export type GigWorkspace = {
  contract: { id: string; state: string; state_deadline_at: string | null; fix_rounds_used: number; current_terms_version?: number; created_at?: string };
  party: 'host' | 'creator' | 'admin'; revealed: boolean;
  /** Who the host is and where the shoot happens; only after acceptance. */
  reveal?: { brand_name: string | null; place_name: string | null; place_address: string | null } | null;
  gig: Record<string, unknown> & {
    title_public: string; brief_public: string; format_key: string; post_by: string;
    brief_private?: string | null; must_tag?: string[] | Record<string, string> | null; brand_id?: string | null;
    /** Shown once revealed when the server includes them. */
    brand_name?: string | null; place_name?: string | null; place_address?: string | null;
    shoot_window?: { start: string; end: string } | null; city_name?: string | null;
    video_due_at?: string | null; shoot_at?: string | null;
  };
  terms: GigTerms[];
  proposals: GigProposal[];
  events: GigEvent[];
  hold: Record<string, unknown> | null; shoot_plan: (Record<string, unknown> & { shoot_at?: string; arrival_note?: string | null; confirmed_at?: string | null; proposed_by?: string }) | null;
  scripts: GigScript[]; deliveries: GigDelivery[];
  posts: GigPost[]; dispute: null | { id: string; status: string; statement: string; offers: Array<{ id: string; offered_by: 'host' | 'creator'; refund_bps: number; note: string | null; status: string }> };
  ratings: Array<Record<string, unknown> & { rated_by?: string; stars?: number }>;
  /** Creator-words key for the one next action (server). */
  next_action?: string | null;
  /** The host still owes a top-up after accepting a higher counter. */
  pending_topup?: boolean | null;
  /** Round 2: where the creator's fee is (On the way · Ready · Paid, or refunded). */
  money_state?: 'on_the_way' | 'ready' | 'paid' | 'refunded' | 'partially_refunded' | null;
  /** When the payout was confirmed, if the server sends it (for "Paid to your bank on Nov 27"). */
  money_paid_at?: string | null;
  rights?: GigRights | null;
};

export type GigRights = {
  model: 'legacy_timed' | 'creator_v1_perpetual';
  status: 'legacy' | 'pending' | 'active' | 'not_granted';
  label: string;
  usage_days?: number | null;
  agreement_version?: string | null;
  agreement_url?: string | null;
  whitelisting_requires_platform_authorization?: boolean;
};

export type EarningsRow = { kind: 'gig' | 'referral' | 'local'; title: string; amount_minor: number; currency: string; state: 'on_the_way' | 'ready' | 'paid'; at: string };
export type CreatorEarningsSummary = { currency: string; on_the_way_minor: number; ready_minor: number; paid_minor: number; rows: EarningsRow[] };

export const creatorGigsService = {
  home: () => programRead<CreatorHome>('gig_creator_home'),
  board: (input: { cityId?: string | null; formatKey?: string | null } = {}) => programRead<PublicGig[]>('creator_gig_board', { p_city_id: input.cityId ?? null, p_format_key: input.formatKey ?? null }),
  detail: (gigId: string) => programRead<PublicGig | null>('creator_gig_detail', { p_gig_id: gigId }),
  withdrawInterest: (interestId: string) => programWrite<{ ok: true }>('gig_interest_withdraw', { p_interest_id: interestId }),
  saveGig: (gigId: string, saved: boolean) => programWrite<{ ok: true; saved: boolean }>('creator_gig_save', { p_gig_id: gigId, p_saved: saved }),
  savedGigs: () => programRead<PublicGig[]>('creator_saved_gigs'),
  /** `{ok:false}` (note_not_anonymous, payout_rail_mismatch, creator_not_ready, gig_full, already_interested) throws. */
  sendInterest: async (gigId: string, packageId: string, quotedMinor: number, note?: string) => {
    const result = await programWrite('gig_interest_send', { p_gig_id: gigId, p_package_id: packageId, p_quoted_minor: quotedMinor, p_note: note?.trim() || null });
    postHogService.capture('gig_interest_sent');
    return result;
  },
  earningsSummary: () => programRead<CreatorEarningsSummary>('creator_earnings_summary'),
  workspace: async (contractId: string): Promise<GigWorkspace | null> => {
    const [workspace, rights] = await Promise.all([
      programRead<GigWorkspace | null>('gig_contract_workspace', { p_contract_id: contractId }),
      programRead<GigRights | null>('gig_rights_status', { p_contract_id: contractId }),
    ]);
    return workspace ? { ...workspace, rights } : null;
  },
  transition: async (contractId: string, expectedState: string, action: string, payload: Record<string, unknown> = {}) => {
    const result = await programWrite('gig_transition', { p_contract_id: contractId, p_expected_state: expectedState, p_action: action, p_payload: payload });
    if (action === 'accept') postHogService.capture('gig_accepted');
    return result;
  },
  counter: (contractId: string, feeMinor: number, note?: string) => programWrite<{ ok: true; proposal_id: string }>('gig_counter_send', { p_contract_id: contractId, p_fee_minor: feeMinor, p_note: note?.trim() || null }),
  proposeChange: (contractId: string, changes: Record<string, unknown>, reason: string, note?: string) => programWrite('gig_change_proposal_save', { p_contract_id: contractId, p_changes: changes, p_reason: reason, p_note: note?.trim() || null }),
  respondToChange: (proposalId: string, accept: boolean) => programWrite('gig_change_proposal_respond', { p_proposal_id: proposalId, p_accept: accept }),
  planShoot: (contractId: string, shootAt: string, arrivalNote: string, confirm: boolean) => programWrite('gig_shoot_plan_save', { p_contract_id: contractId, p_shoot_at: shootAt, p_arrival_note: arrivalNote.trim() || null, p_confirm: confirm }),
  saveScript: async (contractId: string, body: Record<string, unknown>, send: boolean) => {
    const result = await programWrite('gig_script_save', { p_contract_id: contractId, p_body: body, p_source: 'creator', p_send: send });
    if (send) postHogService.capture('gig_script_sent', { source: 'creator' });
    return result;
  },
  submitDelivery: async (contractId: string, mediaJobId: string) => {
    const result = await programWrite('gig_delivery_submit', { p_contract_id: contractId, p_media_job_id: mediaJobId });
    const delivery = result as { round?: unknown } | null;
    postHogService.capture('gig_video_delivered', { round: typeof delivery?.round === 'number' ? delivery.round : 1 });
    return result;
  },
  submitPosts: (contractId: string, posts: Array<{ platform: string; url: string }>) => programWrite('gig_posts_submit', { p_contract_id: contractId, p_posts: posts }),
  openDispute: async (contractId: string, reason: string, statement: string) => {
    const result = await programWrite('gig_dispute_open', { p_contract_id: contractId, p_reason: reason, p_statement: statement.trim(), p_evidence_media_ids: [] });
    postHogService.capture('gig_dispute_opened', { reason });
    return result;
  },
  offerDispute: (disputeId: string, refundBps: number, note?: string) => programWrite('gig_dispute_offer', { p_dispute_id: disputeId, p_refund_bps: refundBps, p_note: note?.trim() || null }),
  respondToDisputeOffer: (offerId: string, accept: boolean) => programEdge('gig-dispute-resolve', { offer_id: offerId, accept }),
  rate: (contractId: string, stars: number) => programWrite('gig_rating_submit', { p_contract_id: contractId, p_stars: stars, p_tags: [], p_note: null }),
  refund: (contractId: string, branch: 'creator_decline' | 'creator_after_accept') => programEdge('gig-refund', { contract_id: contractId, branch }),
};
