/**
 * #4273 wave B — the server's combined audience: one de-duplicated set built
 * from several groups. Totals and names only; recipients stay on the server.
 *
 * Service-layer error contract (Constitution #3): every function THROWS.
 */
import { supabase } from "../supabase";
import type { MarketingAudienceSourceTotal } from "../../types/marketing";

export interface CombinedAudienceSummary {
  peopleCount: number;
  sources: MarketingAudienceSourceTotal[];
  followersTotal: number | null;
  followersAlsoInBook: number | null;
}

export async function getOrCreateCombinedAudience(input: {
  actor_id: string;
  brand_id: string;
  sources: readonly string[];
}): Promise<{ audienceId: string; name: string; sources: string[] }> {
  const { data, error } = await supabase.rpc(
    "biz_get_or_create_marketing_combined_audience_v1",
    { p_actor_id: input.actor_id, p_brand_id: input.brand_id, p_sources: input.sources },
  );
  if (error) throw error;
  return data as { audienceId: string; name: string; sources: string[] };
}

export async function getCombinedAudienceSummary(input: {
  actor_id: string;
  brand_id: string;
  sources: readonly string[];
}): Promise<CombinedAudienceSummary> {
  const { data, error } = await supabase.rpc(
    "biz_marketing_combined_audience_summary_v1",
    { p_actor_id: input.actor_id, p_brand_id: input.brand_id, p_sources: input.sources },
  );
  if (error) throw error;
  return data as CombinedAudienceSummary;
}
