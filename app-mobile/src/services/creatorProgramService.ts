import { supabase } from './supabase';
import { postHogService } from './postHogService';

export const CREATOR_NICHES = ['food', 'nightlife', 'culture', 'outdoors', 'wellness', 'music', 'family', 'travel'] as const;
export const CREATOR_FORMATS = [
  { key: 'first_timer_reaction', name: 'First-timer reaction' },
  { key: 'night_out_30', name: 'Night out in 30 seconds' },
  { key: 'what_price_gets', name: 'What the price gets you' },
  { key: 'behind_the_scenes', name: 'Behind the scenes' },
  { key: 'three_reasons', name: 'Three reasons to go' },
  { key: 'date_idea', name: 'Date idea' },
] as const;

export type CreatorSetupStatus = {
  profile: boolean;
  mode_enabled?: boolean;
  verification?: 'incomplete' | 'verified' | 'review' | 'rejected' | 'suspended';
  missing: string[];
  handles?: Array<{ id: string; platform: string; handle: string; verify_code: string; verified: boolean; review_required: boolean; expires_at: string }>;
  packages?: Array<Record<string, unknown>>;
};

export type PublicCreatorProfile = {
  id: string;
  display_name: string;
  niches: string[];
  showcase: Array<{ media_id: string; thumb: string | null }>;
  completed_gigs: number;
};

async function rpc<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

export const creatorProgramService = {
  status: () => rpc<CreatorSetupStatus>('creator_setup_status'),
  publicProfile: (userId: string) => rpc<PublicCreatorProfile | null>('public_creator_profile', { p_creator_account_id: userId }),
  saveProfile: async (input: { displayName: string; bio: string; homeCityId?: string | null; niches: string[]; languages: string[]; dateOfBirth: string; usageAdsOptIn: boolean }) => {
    const result = await rpc('creator_profile_save', {
      p_display_name: input.displayName, p_bio: input.bio, p_home_city_id: input.homeCityId ?? null,
      p_niches: input.niches, p_languages: input.languages, p_date_of_birth: input.dateOfBirth,
      p_usage_ads_opt_in: input.usageAdsOptIn,
    });
    postHogService.capture('creator_mode_enabled');
    return result;
  },
  saveHandle: (input: { platform: string; handle: string; followerBand?: string | null }) => rpc<{ id: string; verify_code: string; expires_at: string }>('creator_handle_upsert', {
    p_platform: input.platform, p_handle: input.handle, p_follower_band: input.followerBand ?? null,
  }),
  verifyHandle: async (handleId: string) => {
    const { data, error } = await supabase.functions.invoke('creator-handle-verify', { body: { handleId } });
    if (error) throw error;
    return data as { status: 'verified' | 'pending' | 'review' | 'expired' };
  },
  savePackage: (input: { formatKey: string; platforms: string[]; priceMinor: number; currency: string; turnaroundDays: number; includesUsageDays: 30 | 90 | 365; extraUsagePriceMinor?: number | null }) => rpc('creator_package_upsert', {
    p_format_key: input.formatKey, p_platforms: input.platforms, p_price_minor: input.priceMinor,
    p_currency: input.currency, p_turnaround_days: input.turnaroundDays,
    p_includes_usage_days: input.includesUsageDays, p_extra_usage_price_minor: input.extraUsagePriceMinor ?? null, p_active: true,
  }),
  signAgreement: (version: string) => rpc('creator_agreement_sign', { p_agreement_version: version }),
  recompute: async () => {
    const { data, error } = await supabase.functions.invoke('creator-verify', { body: {} });
    if (error) throw error;
    const result = data as { status?: unknown; reasons?: unknown } | null;
    if (result?.status === 'verified') {
      postHogService.capture('creator_verified', {
        reasons_count: Array.isArray(result.reasons) ? result.reasons.length : 0,
      });
    }
    return data;
  },
};
