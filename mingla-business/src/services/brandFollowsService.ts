// #3682 Wave 2.3 — brand_follows direct-RLS writes (buyer web + Host preview).
// Mirrors app-mobile/src/services/brandFollowsService.ts: owner-scoped upsert /
// delete / isFollowing. Upsert uses ignoreDuplicates so re-follow is a no-op.
import { supabase } from "./supabase";

export type BrandFollowMeta = {
  following: boolean;
  /** brand_follows.source when following; null when not. */
  source: string | null;
};

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
    const meta = await brandFollowsService.getFollowMeta(userId, brandId);
    return meta.following;
  },

  /** Wave 2.4 — distinguish auto-follow (Undo) vs prior follow (no Undo). */
  async getFollowMeta(userId: string, brandId: string): Promise<BrandFollowMeta> {
    const { data, error } = await supabase
      .from("brand_follows")
      .select("brand_id, source")
      .eq("user_id", userId)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (error) throw error;
    if (data === null) {
      return { following: false, source: null };
    }
    const source =
      typeof (data as { source?: unknown }).source === "string"
        ? (data as { source: string }).source
        : null;
    return { following: true, source };
  },
};
