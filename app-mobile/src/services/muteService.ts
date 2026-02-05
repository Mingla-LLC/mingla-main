/**
 * Mute Service
 * 
 * Handles user muting and unmuting functionality.
 * Muting stops notifications/messages from a user without removing them as a friend.
 */

import { supabase } from "./supabase";

export interface MutedUser {
  id: string;
  muter_id: string;
  muted_id: string;
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

/**
 * Mute a user
 * @param userId - The ID of the user to mute
 */
export async function muteUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    if (user.id === userId) {
      return { success: false, error: "Cannot mute yourself" };
    }

    const { error } = await supabase
      .from("muted_users")
      .insert({
        muter_id: user.id,
        muted_id: userId,
      });

    if (error) {
      // Handle unique constraint violation (already muted)
      if (error.code === "23505") {
        return { success: true }; // Already muted, consider it a success
      }
      console.error("Error muting user:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Error in muteUser:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Unmute a user
 * @param userId - The ID of the user to unmute
 */
export async function unmuteUser(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: "Not authenticated" };
    }

    const { error } = await supabase
      .from("muted_users")
      .delete()
      .eq("muter_id", user.id)
      .eq("muted_id", userId);

    if (error) {
      console.error("Error unmuting user:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Error in unmuteUser:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}

/**
 * Get list of users muted by the current user
 */
export async function getMutedUsers(): Promise<{
  data: MutedUser[];
  error?: string;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { data: [], error: "Not authenticated" };
    }

    // First, get the muted_users records
    const { data: mutedData, error: mutedError } = await supabase
      .from("muted_users")
      .select("id, muter_id, muted_id, created_at")
      .eq("muter_id", user.id)
      .order("created_at", { ascending: false });

    if (mutedError) {
      // Table might not exist yet - return empty array
      if (mutedError.code === "42P01" || mutedError.message?.includes("does not exist")) {
        return { data: [] };
      }
      console.error("Error fetching muted users:", mutedError);
      return { data: [], error: mutedError.message };
    }

    if (!mutedData || mutedData.length === 0) {
      return { data: [] };
    }

    // Get profile data for muted users
    const mutedIds = mutedData.map((m) => m.muted_id);
    const { data: profilesData, error: profilesError } = await supabase
      .from("profiles")
      .select("id, username, display_name, first_name, last_name")
      .in("id", mutedIds);

    if (profilesError) {
      console.error("Error fetching muted user profiles:", profilesError);
    }

    // Map profiles to muted users
    const profilesMap = new Map(
      (profilesData || []).map((p) => [p.id, p])
    );

    const result: MutedUser[] = mutedData.map((muted) => ({
      ...muted,
      profile: profilesMap.get(muted.muted_id),
    }));

    return { data: result };
  } catch (err) {
    console.error("Error in getMutedUsers:", err);
    return { data: [], error: "An unexpected error occurred" };
  }
}

/**
 * Get list of muted user IDs for the current user
 */
export async function getMutedUserIds(): Promise<{
  data: string[];
  error?: string;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { data: [], error: "Not authenticated" };
    }

    const { data: mutedData, error: mutedError } = await supabase
      .from("muted_users")
      .select("muted_id")
      .eq("muter_id", user.id);

    if (mutedError) {
      // Table might not exist yet - return empty array
      if (mutedError.code === "42P01" || mutedError.message?.includes("does not exist")) {
        return { data: [] };
      }
      console.error("Error fetching muted user IDs:", mutedError);
      return { data: [], error: mutedError.message };
    }

    return { data: (mutedData || []).map((m) => m.muted_id) };
  } catch (err) {
    console.error("Error in getMutedUserIds:", err);
    return { data: [], error: "An unexpected error occurred" };
  }
}

/**
 * Check if a specific user is muted by the current user
 * @param userId - The ID of the user to check
 */
export async function isUserMuted(userId: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return false;
    }

    const { data, error } = await supabase
      .from("muted_users")
      .select("id")
      .eq("muter_id", user.id)
      .eq("muted_id", userId)
      .single();

    if (error) {
      // PGRST116 = no rows returned, which is expected if not muted
      // 42P01 = table doesn't exist yet
      if (error.code !== "PGRST116" && error.code !== "42P01" && !error.message?.includes("does not exist")) {
        console.error("Error checking mute status:", error);
      }
      return false;
    }

    return !!data;
  } catch (err) {
    console.error("Error in isUserMuted:", err);
    return false;
  }
}

/**
 * Toggle mute status for a user
 * @param userId - The ID of the user to toggle mute for
 * @returns The new mute status (true = muted, false = unmuted)
 */
export async function toggleMuteUser(
  userId: string
): Promise<{ success: boolean; isMuted: boolean; error?: string }> {
  try {
    const isMuted = await isUserMuted(userId);
    
    if (isMuted) {
      const result = await unmuteUser(userId);
      return { success: result.success, isMuted: false, error: result.error };
    } else {
      const result = await muteUser(userId);
      return { success: result.success, isMuted: true, error: result.error };
    }
  } catch (err) {
    console.error("Error in toggleMuteUser:", err);
    return { success: false, isMuted: false, error: "An unexpected error occurred" };
  }
}

export const muteService = {
  muteUser,
  unmuteUser,
  getMutedUsers,
  getMutedUserIds,
  isUserMuted,
  toggleMuteUser,
};

export default muteService;
