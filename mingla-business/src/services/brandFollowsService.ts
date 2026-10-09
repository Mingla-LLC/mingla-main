// #3682 Wave 2.3 — brand_follows direct-RLS writes (buyer web + Host preview).
// Mirrors app-mobile/src/services/brandFollowsService.ts: owner-scoped upsert /
// delete / isFollowing. Upsert uses ignoreDuplicates so re-follow is a no-op.
import { supabase } from "./supabase";

export const brandFollowsService = {
  async followBrand(userId: string, brandId: string): Promise<void> {
    const { error } = await supabase.from("brand_follows").upsert(
      { user_id: userId, brand_id: brandId, source: "brand_page" },
      { onConflict: "user_id,brand_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  },

  async unfollowBrand(userId: string, brandId: string): Promise<void> {
    const { data, error } = await supabase
      .from("brand_follows")
      .delete()
      .eq("user_id", userId)
      .eq("brand_id", brandId)
      .select("brand_id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("brand_follow_unfollow_noop");
    }
  },

  async isFollowing(userId: string, brandId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("brand_follows")
      .select("brand_id")
      .eq("user_id", userId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw error;
    return data !== null;
  },
};
