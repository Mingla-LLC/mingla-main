import { supabase } from "./supabase";
import { fetchCreatorSetupStatus } from "./creatorSetupStatusService";

export type { CreatorSetupStatus } from "./creatorProgramContract";

async function rpc<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

export const creatorProgramService = {
  status: fetchCreatorSetupStatus,
  saveProfile: (input: {
    displayName: string;
    bio: string;
    homeCityId?: string | null;
    niches: string[];
    languages: string[];
    dateOfBirth: string;
    usageAdsOptIn: boolean;
  }) => rpc("creator_profile_save", {
    p_display_name: input.displayName,
    p_bio: input.bio,
    p_home_city_id: input.homeCityId ?? null,
    p_niches: input.niches,
    p_languages: input.languages,
    p_date_of_birth: input.dateOfBirth,
    p_usage_ads_opt_in: input.usageAdsOptIn,
  }),
  saveHandle: (input: { platform: string; handle: string; followerBand?: string | null }) =>
    rpc<{ id: string; verify_code: string; expires_at: string }>("creator_handle_upsert", {
      p_platform: input.platform,
      p_handle: input.handle,
      p_follower_band: input.followerBand ?? null,
    }),
  verifyHandle: async (handleId: string) => {
    const { data, error } = await supabase.functions.invoke("creator-handle-verify", { body: { handleId } });
    if (error) throw error;
    return data as { status: "verified" | "pending" | "review" | "expired" };
  },
  savePackage: (input: {
    formatKey: string;
    platforms: string[];
    priceMinor: number;
    currency: string;
    turnaroundDays: number;
    includesUsageDays: 30 | 90 | 365;
    extraUsagePriceMinor?: number | null;
  }) => rpc("creator_package_upsert", {
    p_format_key: input.formatKey,
    p_platforms: input.platforms,
    p_price_minor: input.priceMinor,
    p_currency: input.currency,
    p_turnaround_days: input.turnaroundDays,
    p_includes_usage_days: input.includesUsageDays,
    p_extra_usage_price_minor: input.extraUsagePriceMinor ?? null,
    p_active: true,
  }),
  signAgreement: (version: string) => rpc("creator_agreement_sign", { p_agreement_version: version }),
  recompute: async () => {
    const { data, error } = await supabase.functions.invoke("creator-verify", { body: {} });
    if (error) throw error;
    return data;
  },
};
