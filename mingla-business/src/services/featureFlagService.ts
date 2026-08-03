import { supabase } from "./supabase";

interface FeatureFlagRow {
  is_enabled: boolean;
}

/**
 * Authenticated, server-owned feature truth. Missing/unreadable flags fail
 * closed so a stale client cannot expose a dark launch surface.
 */
export async function getFeatureFlag(flagKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("feature_flags")
    .select("is_enabled")
    .eq("flag_key", flagKey)
    .maybeSingle<FeatureFlagRow>();
  if (error !== null || data === null) return false;
  return data.is_enabled === true;
}
