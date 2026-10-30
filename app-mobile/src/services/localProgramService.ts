import { supabase } from './supabase';
import { postHogService } from './postHogService';
import { programRead, programWrite } from './programApi';
import { toProgramError } from './programResult';

export type LocalCityProgram = {
  city_id: string; city: string; seats: number;
  /** Per-city monthly pay in its payout currency (Admin sets both). */
  monthly_rate_minor?: number | null; payout_currency?: string | null;
  /** Legacy USD rate. */
  monthly_usd_minor?: number | null;
};
export type LocalApplication = {
  id: string; city_id: string; city: string; status: string; created_at: string;
  agreement_version?: string | null; agreement_due_at?: string | null;
};
export type LocalAgreement = {
  version: string; document_url: string; document_sha256: string; effective_at: string;
};
export type LocalSeat = {
  id: string; city_id: string; city: string; status: string; since: string;
  agreement_version?: string | null; agreement_signed_at?: string | null;
};
export type LocalLanding = {
  enabled: boolean;
  programs: LocalCityProgram[];
  applications: LocalApplication[];
  agreement: LocalAgreement | null;
  local: null | LocalSeat;
  /** The viewer's home city (creator or profile), when known. */
  viewer_city_id?: string | null;
};
export type LocalMonth = Record<string, unknown> & {
  id: string; month: string; status: string; place_id: string | null; place_name?: string | null;
  picked_at?: string | null; visited_at?: string | null; submitted_at?: string | null; approved_at?: string | null; published_at?: string | null;
  payout_currency?: string | null; payout_amount_minor?: number | null; changes_due_at?: string | null;
};
export type LocalHome = {
  local: LocalSeat; current_month: LocalMonth | null; months: LocalMonth[];
  payout: null | { stripe_status?: string | null; paystack_status?: string | null; currency?: string | null };
};
export type LocalPlaceCandidate = { id: string; name: string; address: string | null; primary_type: string | null; eligible: boolean; reason: string | null };
export type PublicLocalProfile = { user_id: string; name: string; avatar_url: string | null; city: string; local_since: string; reviews: { local_month_id: string; place_id: string; place_name: string; rating: number; title: string; body: string; visited_on: string; media_job_ids: string[]; reply: string | null }[] };
export type PublicLocalPlaceReview = { local_month_id: string; local_user_id: string; name: string; avatar_url: string | null; rating: number; title: string; excerpt: string; body: string; visited_on: string; media_job_ids: string[]; reply: string | null; published_at: string };

export { localCityRate } from '../utils/programFormat';

export const localProgramService = {
  landing: () => programRead<LocalLanding>('local_landing'),
  apply: async (cityId: string, handles: Record<string, string>, sampleLinks: string[], why: string) => {
    const result = await programWrite('local_application_save', { p_city_id: cityId, p_handles: handles, p_sample_links: sampleLinks, p_why: why.trim() });
    postHogService.capture('local_applied');
    return result;
  },
  signAgreement: async (applicationId: string, version: string, signatureName: string) => {
    const result = await programWrite('local_agreement_sign', {
      p_application_id: applicationId,
      p_agreement_version: version,
      p_signature_name: signatureName.trim(),
    });
    postHogService.capture('local_agreement_signed');
    return result;
  },
  home: () => programRead<LocalHome | null>('local_home'),
  places: (query?: string) => programRead<LocalPlaceCandidate[]>('local_place_candidates', { p_query: query?.trim() || null }),
  /** Names for the places on your own months (place_pool is readable by signed-in people). */
  placeNames: async (ids: string[]): Promise<Record<string, string>> => {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (!unique.length) return {};
    const { data, error } = await supabase.from('place_pool').select('id,name').in('id', unique);
    if (error) throw toProgramError(error);
    return Object.fromEntries(((data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  },
  pickPlace: async (placeId: string, personalTie = false) => {
    const result = await programWrite('local_pick_place', { p_place_id: placeId, p_personal_tie: personalTie });
    postHogService.capture('local_pick', { result: personalTie ? 'ineligible' : 'eligible' });
    return result;
  },
  markVisited: (monthId: string, visitedOn: string, receiptMediaJobId?: string | null) => programWrite('local_mark_visited', { p_local_month_id: monthId, p_visited_on: visitedOn, p_receipt_media_job_id: receiptMediaJobId ?? null }),
  submitReview: async (input: { monthId: string; rating: number; title: string; body: string; visitedOn: string; spendBand: string | null; mediaJobIds: string[]; socialPostUrl: string }) => {
    const result = await programWrite('local_review_submit', { p_local_month_id: input.monthId, p_rating: input.rating, p_title: input.title.trim(), p_body: input.body.trim(), p_visited_on: input.visitedOn, p_spend_band: input.spendBand, p_media_job_ids: input.mediaJobIds, p_social_post_url: input.socialPostUrl.trim(), p_disclosure_ack: true });
    postHogService.capture('local_submitted');
    return result;
  },
  publicProfile: (userId: string) => programRead<PublicLocalProfile | null>('public_local_profile', { p_user_id: userId }),
  publicPlaceReviews: (placeId: string) => programRead<PublicLocalPlaceReview[]>('public_place_local_reviews', { p_place_id: placeId }),
};
