// Issue #679 — brand_follows direct-RLS writes (savedCardsService shape).
//
// The solo `saved_card` pattern is the bound precedent: single-row,
// single-owner writes go straight through owner-scoped RLS — no RPC (the
// RPC/trigger precedents exist for multi-row atomicity/quorum problems Follow
// does not have). All errors throw; no silent catches. 23505 on the upsert is
// idempotent success (savedCardsService.saveCard precedent).
import { supabase } from "./supabase";

export const brandFollowsService = {
  async followBrand(userId: string, brandId: string): Promise<void> {
    const { error } = await supabase.from("brand_follows").upsert(
      { user_id: userId, brand_id: brandId, source: "brand_page" },
      { onConflict: "user_id,brand_id" },
    );
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        // Duplicate is idempotent success — onConflict already merged.
        console.warn(
          "[brandFollowsService.followBrand] 23505 duplicate — treating as success",
          error,
        );
        return;
      }
      throw error;
    }
  },

  async unfollowBrand(userId: string, brandId: string): Promise<void> {
    // Hard delete (spec §3). Zero rows deleted is success — already unfollowed.
    const { error } = await supabase
      .from("brand_follows")
      .delete()
      .eq("user_id", userId)
      .eq("brand_id", brandId);
    if (error) throw error;
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
