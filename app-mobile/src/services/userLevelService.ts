/**
 * User Level Service — fetches user level/XP from user_levels table.
 * Relocated from leaderboardService.ts (ORCH-0449).
 */

import { supabase } from './supabase';

export async function fetchUserLevel(userId: string): Promise<{ level: number; xp_score: number } | null> {
  // First try cached level
  const { data, error } = await supabase
    .from('user_levels')
    .select('level, xp_score')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch user level: ${error.message}`);
  }

  // If no cached level exists, trigger calculation via RPC
  if (!data) {
    const { data: calculatedLevel, error: rpcError } = await supabase
      .rpc('recalculate_user_level', { target_user_id: userId });

    if (rpcError) {
      console.warn('[userLevelService] Level calculation failed:', rpcError.message);
      return { level: 1, xp_score: 0 };
    }

    // Read the freshly calculated data
    const { data: freshData } = await supabase
      .from('user_levels')
      .select('level, xp_score')
      .eq('user_id', userId)
      .maybeSingle();

    return freshData ?? { level: calculatedLevel ?? 1, xp_score: 0 };
  }

  return data;
}
