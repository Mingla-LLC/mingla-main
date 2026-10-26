import { supabase } from './supabase';
import { postHogService } from './postHogService';

export type PublicGig = {
  id: string; title_public: string; brief_public: string; format_key: string;
  deliverables: Array<{ platform: string; kind: string; count: number }>;
  city_name: string; category: string; shoot_window: { start: string; end: string };
  post_by: string; usage_days: number; budget_band: string; sales_share_bps: number | null; slots_left: number;
};

export type GigWorkspace = {
  contract: { id: string; state: string; state_deadline_at: string | null; fix_rounds_used: number };
  party: 'host' | 'creator' | 'admin'; revealed: boolean;
  gig: Record<string, unknown> & { title_public: string; brief_public: string; format_key: string; post_by: string };
  terms: Array<Record<string, unknown> & { version: number; fee_minor: number; booking_fee_minor: number; currency: string }>;
  proposals: Array<{ id: string; from_version: number; proposed_by: 'host' | 'creator'; changes: Record<string, unknown>; reason: string; note: string | null; status: string; expires_at: string }>;
  events: Array<{ id: string; at: string; actor: string; kind: string; data: Record<string, unknown> }>;
  hold: Record<string, unknown> | null; shoot_plan: Record<string, unknown> | null;
  scripts: Array<Record<string, unknown>>; deliveries: Array<Record<string, unknown> & { id: string; round: number; decision: string | null }>;
  posts: Array<Record<string, unknown>>; dispute: null | { id: string; status: string; statement: string; offers: Array<{ id: string; offered_by: 'host' | 'creator'; refund_bps: number; note: string | null; status: string }> };
  ratings: Array<Record<string, unknown>>;
};

async function rpc<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

export const creatorGigsService = {
  home: () => rpc<{ contracts: Array<{ id: string; state: string; deadline_at: string | null; title: string; format_key: string; city: string; post_by: string; fee_minor: number; currency: string; updated_at: string }>; interests: Array<{ id: string; gig_id: string; title: string; status: string; quote_minor: number; currency: string; created_at: string }> }>('gig_creator_home'),
  board: (formatKey?: string | null) => rpc<PublicGig[]>('creator_gig_board', { p_city_id: null, p_format_key: formatKey ?? null }),
  detail: (gigId: string) => rpc<PublicGig>('creator_gig_detail', { p_gig_id: gigId }),
  sendInterest: async (gigId: string, packageId: string, quotedMinor: number, note?: string) => {
    const result = await rpc('gig_interest_send', { p_gig_id: gigId, p_package_id: packageId, p_quoted_minor: quotedMinor, p_note: note ?? null });
    postHogService.capture('gig_interest_sent');
    return result;
  },
  workspace: (contractId: string) => rpc<GigWorkspace>('gig_contract_workspace', { p_contract_id: contractId }),
  transition: async (contractId: string, expectedState: string, action: string, payload: Record<string, unknown> = {}) => {
    const result = await rpc('gig_transition', { p_contract_id: contractId, p_expected_state: expectedState, p_action: action, p_payload: payload });
    if (action === 'accept') postHogService.capture('gig_accepted');
    return result;
  },
  proposeChange: (contractId: string, changes: Record<string, unknown>, reason: string, note?: string) => rpc('gig_change_proposal_save', { p_contract_id: contractId, p_changes: changes, p_reason: reason, p_note: note ?? null }),
  respondToChange: (proposalId: string, accept: boolean) => rpc('gig_change_proposal_respond', { p_proposal_id: proposalId, p_accept: accept }),
  planShoot: (contractId: string, shootAt: string, arrivalNote: string, confirm: boolean) => rpc('gig_shoot_plan_save', { p_contract_id: contractId, p_shoot_at: shootAt, p_arrival_note: arrivalNote, p_confirm: confirm }),
  saveScript: async (contractId: string, body: Record<string, unknown>, send: boolean) => {
    const result = await rpc('gig_script_save', { p_contract_id: contractId, p_body: body, p_source: 'creator', p_send: send });
    if (send) postHogService.capture('gig_script_sent', { source: 'creator' });
    return result;
  },
  submitDelivery: async (contractId: string, mediaJobId: string) => {
    const result = await rpc('gig_delivery_submit', { p_contract_id: contractId, p_media_job_id: mediaJobId });
    const delivery = result as { round?: unknown } | null;
    postHogService.capture('gig_video_delivered', { round: typeof delivery?.round === 'number' ? delivery.round : 1 });
    return result;
  },
  submitPosts: (contractId: string, posts: Array<{ platform: string; url: string }>) => rpc('gig_posts_submit', { p_contract_id: contractId, p_posts: posts }),
  openDispute: async (contractId: string, reason: string, statement: string) => {
    const result = await rpc('gig_dispute_open', { p_contract_id: contractId, p_reason: reason, p_statement: statement, p_evidence_media_ids: [] });
    postHogService.capture('gig_dispute_opened', { reason });
    return result;
  },
  offerDispute: (disputeId: string, refundBps: number, note?: string) => rpc('gig_dispute_offer', { p_dispute_id: disputeId, p_refund_bps: refundBps, p_note: note ?? null }),
  respondToDisputeOffer: async (offerId: string, accept: boolean) => {
    const { data, error } = await supabase.functions.invoke('gig-dispute-resolve', { body: { offer_id: offerId, accept } });
    if (error) throw error;
    return data;
  },
  rate: (contractId: string, stars: number) => rpc('gig_rating_submit', { p_contract_id: contractId, p_stars: stars, p_tags: [], p_note: null }),
  refund: async (contractId: string, branch: string, refundBps?: number) => {
    const { data, error } = await supabase.functions.invoke('gig-refund', { body: { contract_id: contractId, branch, refund_bps: refundBps } });
    if (error) throw error;
    return data;
  },
};
