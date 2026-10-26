import { supabase } from './supabase';
import { postHogService } from './postHogService';

export type LocalLanding = {
  enabled: boolean;
  programs: Array<{ city_id: string; city: string; seats: number; monthly_usd_minor: number }>;
  applications: Array<{ id: string; city_id: string; city: string; status: string; created_at: string }>;
  local: null | { id: string; city_id: string; city: string; status: string; since: string };
};
export type LocalHome = { local: { id: string; city_id: string; city: string; status: string; since: string }; current_month: null | Record<string, unknown> & { id: string; status: string; place_id: string | null }; months: Array<Record<string, unknown>>; payout: null | Record<string, unknown> };
export type LocalPlaceCandidate = { id: string; name: string; address: string | null; primary_type: string | null; eligible: boolean; reason: string | null };
export type PublicLocalProfile = { user_id: string; name: string; avatar_url: string | null; city: string; local_since: string; reviews: Array<{ local_month_id: string; place_id: string; place_name: string; rating: number; title: string; body: string; visited_on: string; media_job_ids: string[]; reply: string | null }> };
export type PublicLocalPlaceReview = { local_month_id: string; local_user_id: string; name: string; avatar_url: string | null; rating: number; title: string; excerpt: string; body: string; visited_on: string; media_job_ids: string[]; reply: string | null; published_at: string };

async function rpc<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

export const localProgramService = {
  landing: () => rpc<LocalLanding>('local_landing'),
  apply: async (cityId: string, handles: Record<string, string>, sampleLinks: string[], why: string) => {
    const result = await rpc('local_application_save', { p_city_id: cityId, p_handles: handles, p_sample_links: sampleLinks, p_why: why });
    postHogService.capture('local_applied');
    return result;
  },
  home: () => rpc<LocalHome | null>('local_home'),
  places: (query?: string) => rpc<LocalPlaceCandidate[]>('local_place_candidates', { p_query: query?.trim() || null }),
  pickPlace: async (placeId: string, personalTie = false) => {
    const result = await rpc('local_pick_place', { p_place_id: placeId, p_personal_tie: personalTie });
    postHogService.capture('local_pick', { result: personalTie ? 'ineligible' : 'eligible' });
    return result;
  },
  markVisited: (monthId: string, visitedOn: string, receiptMediaJobId?: string | null) => rpc('local_mark_visited', { p_local_month_id: monthId, p_visited_on: visitedOn, p_receipt_media_job_id: receiptMediaJobId ?? null }),
  submitReview: async (input: { monthId: string; rating: number; title: string; body: string; visitedOn: string; spendBand: string; mediaJobIds: string[]; socialPostUrl: string }) => {
    const result = await rpc('local_review_submit', { p_local_month_id: input.monthId, p_rating: input.rating, p_title: input.title, p_body: input.body, p_visited_on: input.visitedOn, p_spend_band: input.spendBand, p_media_job_ids: input.mediaJobIds, p_social_post_url: input.socialPostUrl, p_disclosure_ack: true });
    postHogService.capture('local_submitted');
    return result;
  },
  publicProfile: (userId: string) => rpc<PublicLocalProfile | null>('public_local_profile', { p_user_id: userId }),
  publicPlaceReviews: (placeId: string) => rpc<PublicLocalPlaceReview[]>('public_place_local_reviews', { p_place_id: placeId }),
};
