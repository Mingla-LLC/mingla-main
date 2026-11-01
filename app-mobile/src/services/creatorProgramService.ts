import { supabase } from './supabase';
import { postHogService } from './postHogService';
import { programEdge, programRead, programWrite } from './programApi';
import { toProgramError } from './programResult';
import { FORMAT_INFO } from '../utils/programFormat';
import { cityOptions, homeCityFrom, homeCitySetParams, homeCityFromSetResult, profileSaveParams, type CityOption, type HomeCity, type ProfileSaveInput } from './creatorProgramMapping';

export const CREATOR_NICHES = ['food', 'nightlife', 'culture', 'outdoors', 'wellness', 'music', 'family', 'travel'] as const;
export const CREATOR_LANGUAGES = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'French', 'Spanish', 'Portuguese', 'Arabic'] as const;
export const CREATOR_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'x', 'snapchat'] as const;
export const POST_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'x'] as const;
export const CREATOR_FORMATS = FORMAT_INFO.map(({ key, name }) => ({ key, name }));

export type CreatorVerification = 'incomplete' | 'review' | 'needs_more' | 'verified' | 'declined' | 'suspended';
export type SetupCheck = { key: string; done: boolean; label: string };
export type CreatorHandle = { id: string; platform: string; handle: string; verify_code: string; verified: boolean; review_required: boolean; expires_at: string; follower_band?: string | null };
export type CreatorPackage = {
  id: string; format_key: string; platforms: string[]; price_minor: number; currency: string; turnaround_days: number;
  includes_usage_days: 30 | 90 | 365; extra_usage_price_minor: number | null; active: boolean;
};

export type CreatorSetupStatus = {
  profile: boolean;
  mode_enabled?: boolean;
  verification?: CreatorVerification;
  review_note?: string | null;
  declined_reason?: string | null;
  checks?: SetupCheck[];
  /** How hosts see you (name and niches), straight from the status call. */
  display_name?: string | null;
  niches?: string[] | null;
  /** Legacy raw keys; never shown. */
  missing?: string[];
  handles?: CreatorHandle[];
  packages?: CreatorPackage[];
  /** Round 2: the saved home city, live or not (`{id, name, is_live}`). */
  home_city?: { id: string | null; name: string; is_live: boolean } | null;
};

export type CreatorAgreement = { version: string; document_url: string; document_sha256: string; effective_at: string; accepted: boolean };

export type CreatorOwnProfile = {
  display_name: string; bio: string | null; home_city_id: string | null; home_city_name: string | null;
  /** Round 2: the saved home city, live or not, from `creator_profile_home_city`. */
  home_city: HomeCity | null;
  niches: string[]; languages: string[]; date_of_birth: string | null; usage_ads_opt_in: boolean;
};

export type PublicCreatorProfile = {
  id: string;
  display_name: string;
  niches: string[];
  showcase: Array<{ media_id: string; thumb: string | null; title?: string | null }>;
  completed_gigs: number;
  /** Optional: a live gig the creator is promoting right now. */
  promoting_now?: string[] | { title: string; url?: string | null } | null;
};

export type City = { id: string; name: string; country_code: string | null };

/** Which setup step is done: the server's checks first, legacy keys as fallback. */
export function setupChecks(status: CreatorSetupStatus | null | undefined): SetupCheck[] {
  if (status?.checks?.length) return status.checks;
  const missing = new Set(status?.missing ?? []);
  const legacy: Array<[string, string, boolean]> = [
    ['profile', 'Profile', Boolean(status?.profile)],
    ['rates', 'Rates', !missing.has('package')],
    ['showcase', 'Showcase video', !missing.has('processed_showcase')],
    ['socials', 'Verify a social account', !missing.has('verified_handle')],
    ['payout', 'Payout account', !missing.has('active_payout')],
    ['agreement', 'Agreement', !missing.has('signed_agreement')],
  ];
  return legacy.map(([key, label, done]) => ({ key, label, done: Boolean(status?.profile) && done }));
}

export const creatorProgramService = {
  status: () => programRead<CreatorSetupStatus>('creator_setup_status'),
  currentAgreement: () => programRead<CreatorAgreement | null>('creator_current_agreement'),
  publicProfile: (userId: string) => programRead<PublicCreatorProfile | null>('public_creator_profile', { p_creator_account_id: userId }),

  /** Your own profile row (owner-read RLS), for editing and the hub header. */
  ownProfile: async (): Promise<CreatorOwnProfile | null> => {
    const { data: auth } = await supabase.auth.getUser();
    const id = auth.user?.id;
    if (!id) return null;
    const { data, error } = await supabase
      .from('creator_profiles')
      .select('display_name,bio,home_city_id,niches,languages,date_of_birth,usage_ads_opt_in,home_city:creator_profile_home_city')
      .eq('creator_account_id', id)
      .maybeSingle();
    if (error) throw toProgramError(error);
    if (!data) return null;
    const row = data as unknown as Omit<CreatorOwnProfile, 'home_city_name' | 'home_city'> & { home_city: unknown };
    const city = homeCityFrom(Array.isArray(row.home_city) ? row.home_city[0] : row.home_city);
    return {
      display_name: row.display_name, bio: row.bio, home_city_id: row.home_city_id, home_city_name: city?.name ?? null, home_city: city,
      niches: row.niches ?? [], languages: row.languages ?? [], date_of_birth: row.date_of_birth, usage_ads_opt_in: Boolean(row.usage_ads_opt_in),
    };
  },

  /** Cities live on Mingla, for the home-city picker and gig filters. */
  cities: async (): Promise<City[]> => {
    const { data, error } = await supabase.from('seeding_cities').select('id,name,country_code').eq('is_live_for_consumers', true).order('name');
    if (error) throw toProgramError(error);
    return (data ?? []) as City[];
  },

  /** Home-city picker: live cities first; with a query, any city (non-live ones marked). */
  citySearch: async (query?: string | null): Promise<CityOption[]> => {
    const q = query?.trim() ? query.trim() : null;
    return cityOptions(await programRead<unknown>('creator_city_search', { p_query: q }));
  },

  /** Saves the home city, live or not. `{ok:false, error:'city_required'}` throws. */
  setHomeCity: async (option: Pick<CityOption, 'id' | 'name' | 'countryCode' | 'isLive'>): Promise<HomeCity | null> =>
    homeCityFromSetResult(await programWrite<unknown>('creator_home_city_set', homeCitySetParams(option))),

  /**
   * Date of birth is optional here: it is collected and checked (18+) when
   * signing the agreement. Paid-ads use is part of every gig: always sent true.
   */
  saveProfile: async (input: ProfileSaveInput) => {
    const result = await programWrite('creator_profile_save', profileSaveParams(input));
    postHogService.capture('creator_mode_enabled');
    return result;
  },
  saveHandle: (input: { platform: string; handle: string; followerBand?: string | null }) => programWrite<{ id: string; verify_code: string; expires_at: string }>('creator_handle_upsert', {
    p_platform: input.platform, p_handle: input.handle.trim().replace(/^@+/, '').toLowerCase(), p_follower_band: input.followerBand ?? null,
  }),
  verifyHandle: (handleId: string) => programEdge<{ status: 'verified' | 'pending' | 'review' | 'expired' }>('creator-handle-verify', { handleId }),
  savePackage: (input: { formatKey: string; platforms: string[]; priceMinor: number; currency: string; turnaroundDays: number; active?: boolean }) => programWrite('creator_package_upsert', {
    p_format_key: input.formatKey, p_platforms: input.platforms, p_price_minor: input.priceMinor,
    p_currency: input.currency, p_turnaround_days: input.turnaroundDays,
    // Legacy storage sentinel. New contracts receive the non-negotiable perpetual licence from the server.
    p_includes_usage_days: 90, p_extra_usage_price_minor: null, p_active: input.active ?? true,
  }),
  /** The server selects and fingerprints the current agreement; the client never supplies a version. */
  signAgreement: (dateOfBirth: string) => programWrite('creator_agreement_sign', { p_date_of_birth: dateOfBirth }),
  recompute: async () => {
    const data = await programEdge<{ status?: unknown; reasons?: unknown } | null>('creator-verify', {});
    if (data?.status === 'verified') {
      postHogService.capture('creator_verified', { reasons_count: Array.isArray(data.reasons) ? data.reasons.length : 0 });
    }
    return data;
  },
};
