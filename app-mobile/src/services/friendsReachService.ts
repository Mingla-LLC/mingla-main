// #3682 wave 3 (#1782) — Friends of followers controls for guests.
//
// One read returns whether this build's controls switch is live, the guest's
// opt-in (default off) and the brands they stopped. Every write goes through a
// SECURITY DEFINER RPC (authenticated has no write grant on these tables).
// All errors throw; callers surface them.
import { supabase } from "./supabase";

import {
  parseFriendsReach,
  type FriendsReachPlatform,
  type FriendsReachState,
} from "./friendsReachModel";

export {
  parseFriendsReach,
  type FriendsReachPlatform,
  type FriendsReachState,
  type StoppedBrand,
} from "./friendsReachModel";

export const friendsReachService = {
  async get(platform: FriendsReachPlatform): Promise<FriendsReachState> {
    const { data, error } = await supabase.rpc(
      "issue_3682_explorer_friends_reach_v1",
      { p_platform: platform },
    );
    if (error) throw error;
    return parseFriendsReach(data);
  },

  async setEnabled(
    platform: FriendsReachPlatform,
    enabled: boolean,
  ): Promise<FriendsReachState> {
    const { data, error } = await supabase.rpc(
      "issue_3682_set_friends_reach_v1",
      { p_platform: platform, p_enabled: enabled },
    );
    if (error) throw error;
    return parseFriendsReach(data);
  },

  /**
   * Stop (or allow again) one brand reaching the guest through its circle.
   * `unfollow` is used from the Following menu so the guest is never left
   * "Following" a brand that can no longer reach them.
   */
  async setBrandStopped(
    brandId: string,
    stopped: boolean,
    unfollow = false,
  ): Promise<void> {
    const { error } = await supabase.rpc("issue_3682_set_brand_circle_exit_v1", {
      p_brand_id: brandId,
      p_stopped: stopped,
      p_unfollow: unfollow,
    });
    if (error) throw error;
  },
};
