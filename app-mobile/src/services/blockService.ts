/**
 * Block Service
 * 
 * Handles user blocking and unblocking functionality.
 * Server-side enforcement is done via RLS policies in Supabase.
 */

import { supabase } from "./supabase";
import { withTimeout } from "../utils/withTimeout";

export interface BlockedUser {
  id: string;
  blocker_id: string;
  blocked_id: string;
  reason?: string;
  created_at: string;
  // Joined profile data
  profile?: {
    id: string;
    username: string;
    display_name: string;
    first_name: string;
    last_name: string;
  };
}

export type BlockReason = "harassment" | "spam" | "inappropriate" | "other";

/**
 * Block a user
 * @param userId - The ID of the user to block
 * @param reason - Optional reason for blocking
 */
export async function blockUser(
  userId: string,
  reason?: BlockReason
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    if (user.id === userId) {
      return { success: false, error: "Cannot block yourself" };
    }

    const { error } = await supabase
      .from("blocked_users")
      .insert({
        blocker_id: user.id,
        blocked_id: userId,
        reason: reason || null,
      });

    if (error) {
      // Handle unique constraint violation (already blocked)
      if (error.code === "23505") {
        return { success: true }; // Already blocked, consider it a success
      }
      console.error("Error blocking user:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Error in blockUser:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Unblock a user
 * @param userId - The ID of the user to unblock
 */
export async function unblockUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    const { error } = await supabase
      .from("blocked_users")
      .delete()
      .eq("blocker_id", user.id)
      .eq("blocked_id", userId);

    if (error) {
      console.error("Error unblocking user:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Error in unblockUser:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Get list of users blocked by the current user
 */
export async function getBlockedUsers(): Promise<{
  data: BlockedUser[];
  error?: string;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { data: [], error: "Not authenticated" };
    }

    // First, get the blocked_users records
    const { data: blockedData, error: blockedError } = await supabase
      .from("blocked_users")
      .select("id, blocker_id, blocked_id, reason, created_at")
      .eq("blocker_id", user.id)
      .order("created_at", { ascending: false });

    if (blockedError) {
      // Table might not exist yet - return empty array
      if (blockedError.code === "42P01" || blockedError.message?.includes("does not exist")) {
        return { data: [] };
      }
      console.error("Error fetching blocked users:", blockedError);
      return { data: [], error: blockedError.message };
    }

    if (!blockedData || blockedData.length === 0) {
      return { data: [] };
    }

    // Get profile data for blocked users
    const blockedIds = blockedData.map((b) => b.blocked_id);
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, username, display_name, first_name, last_name")
      .in("id", blockedIds);

    if (profilesError) {
      console.error("Error fetching blocked user profiles:", profilesError);
    }

    // Map profiles to blocked users
    const profilesMap = new Map(
      (profilesData || []).map((p) => [p.id, p])
    );

    const result: BlockedUser[] = blockedData.map((blocked) => ({
      ...blocked,
      profile: profilesMap.get(blocked.blocked_id),
    }));

    return { data: result };
  } catch (err) {
    console.error("Error in getBlockedUsers:", err);
    return { data: [], error: "An unexpected error occurred" };
  }
}

/**
 * Check if a specific user is blocked by the current user
 * @param userId - The ID of the user to check
 */
export async function isUserBlocked(userId: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return false;
    }

    const { data, error } = await supabase
      .from("blocked_users")
      .select("id")
      .eq("blocker_id", user.id)
      .eq("blocked_id", userId)
      .single();

    if (error) {
      // PGRST116 = no rows returned, which is expected if not blocked
      // 42P01 = table doesn't exist yet
      if (error.code !== "PGRST116" && error.code !== "42P01" && !error.message?.includes("does not exist")) {
        console.error("Error checking block status:", error);
      }
      return false;
    }

    return !!data;
  } catch (err) {
    console.error("Error in isUserBlocked:", err);
    return false;
  }
}

/**
 * Check if the current user is blocked by another user
 * This is useful for showing appropriate UI when viewing profiles
 * @param userId - The ID of the user who might have blocked current user
 */
export async function isBlockedByUser(userId: string): Promise<boolean> {
  try {
    return await withTimeout(
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          return false;
        }

        // Use RPC call since we can't directly query if we're blocked
        const { data, error } = await supabase.rpc("is_blocked_by", {
          blocker: userId,
          target: user.id,
        });

        if (error) {
          // Ignore errors if function doesn't exist yet (migration not run)
          if (!error.message?.includes("does not exist")) {
            console.error("Error checking if blocked by user:", error);
          }
          return false;
        }

        return !!data;
      })(),
      5000,
      'isBlockedByUser'
    );
  } catch (err) {
    console.error("Error in isBlockedByUser:", err);
    return false;
  }
}

/**
 * Check if there's any block between current user and another user
 * @param userId - The ID of the other user
 */
export async function hasBlockBetween(userId: string): Promise<boolean> {
  try {
    return await withTimeout(
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          return false;
        }

        const { data, error } = await supabase.rpc("has_block_between", {
          user1: user.id,
          user2: userId,
        });

        if (error) {
          // Ignore errors if function doesn't exist yet (migration not run)
          if (!error.message?.includes("does not exist")) {
            console.error("Error checking block between users:", error);
          }
          return false;
        }

        return !!data;
      })(),
      5000,
      'hasBlockBetween'
    );
  } catch (err) {
    console.error("Error in hasBlockBetween:", err);
    return false;
  }
}

export const blockService = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  isUserBlocked,
  isBlockedByUser,
  hasBlockBetween,
};

export default blockService;
