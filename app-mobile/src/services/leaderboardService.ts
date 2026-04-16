/**
 * ORCH-0437: Near You Leaderboard — Service layer
 *
 * Wraps edge function calls and direct Supabase queries for
 * leaderboard presence, tag-along requests, and user levels.
 */

import { supabase } from './supabase';
import { extractFunctionError } from '../utils/edgeFunctionError';
import type {
  LeaderboardPresenceRow,
  TagAlongRequest,
  UpsertPresenceResponse,
  SendTagAlongResponse,
  AcceptTagAlongResponse,
  DeclineTagAlongResponse,
} from '../types/leaderboard';

// --- Edge Function Calls ---

export async function upsertPresence(params: {
  lat: number;
  lng: number;
  swiped_category?: string;
  preference_categories?: string[];
  activity_status?: string;
  available_seats?: number;
  is_discoverable?: boolean;
  visibility_level?: string;
}): Promise<UpsertPresenceResponse> {
  const { data, error } = await supabase.functions.invoke('upsert-leaderboard-presence', {
    body: params,
  });

  if (error) {
    const msg = await extractFunctionError(error, 'Failed to update presence');
    throw new Error(msg);
  }

  return data as UpsertPresenceResponse;
}

export async function sendTagAlong(receiverId: string): Promise<SendTagAlongResponse> {
  const { data, error } = await supabase.functions.invoke('send-tag-along', {
    body: { receiver_id: receiverId },
  });

  if (error) {
    const msg = await extractFunctionError(error, 'Failed to send interest');
    throw new Error(msg);
  }

  return data as SendTagAlongResponse;
}

export async function acceptTagAlong(requestId: string): Promise<AcceptTagAlongResponse> {
  const { data, error } = await supabase.functions.invoke('accept-tag-along', {
    body: { request_id: requestId },
  });

  if (error) {
    const msg = await extractFunctionError(error, 'Failed to accept tag-along');
    throw new Error(msg);
  }

  return data as AcceptTagAlongResponse;
}

export async function declineTagAlong(requestId: string): Promise<DeclineTagAlongResponse> {
  const { data, error } = await supabase.functions.invoke('decline-tag-along', {
    body: { request_id: requestId },
  });

  if (error) {
    const msg = await extractFunctionError(error, 'Failed to decline request');
    throw new Error(msg);
  }

  return data as DeclineTagAlongResponse;
}

// --- Direct Supabase Queries (RLS handles access control) ---

export async function fetchNearbyUsers(): Promise<LeaderboardPresenceRow[]> {
  const { data, error } = await supabase
    .from('leaderboard_presence')
    .select('*')
    .eq('is_discoverable', true)
    .gt('available_seats', 0)
    .gte('last_swipe_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('last_swipe_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch nearby users: ${error.message}`);
  }

  return (data ?? []) as LeaderboardPresenceRow[];
}

export async function fetchIncomingRequests(userId: string): Promise<TagAlongRequest[]> {
  const { data, error } = await supabase
    .from('tag_along_requests')
    .select('*')
    .eq('receiver_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch incoming requests: ${error.message}`);
  }

  return (data ?? []) as TagAlongRequest[];
}

export async function fetchOutgoingRequests(userId: string): Promise<TagAlongRequest[]> {
  const { data, error } = await supabase
    .from('tag_along_requests')
    .select('*')
    .eq('sender_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch outgoing requests: ${error.message}`);
  }

  return (data ?? []) as TagAlongRequest[];
}

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
      console.warn('[leaderboardService] Level calculation failed:', rpcError.message);
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

/** Batch fetch profile data for a list of user IDs */
export async function fetchProfilesBatch(userIds: string[]): Promise<Map<string, {
  display_name: string;
  first_name: string | null;
  avatar_url: string | null;
}>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, first_name, avatar_url')
    .in('id', userIds);

  if (error) {
    console.warn('[leaderboardService] Profile batch fetch failed:', error.message);
    return new Map();
  }

  const map = new Map<string, { display_name: string; first_name: string | null; avatar_url: string | null }>();
  for (const p of data ?? []) {
    map.set(p.id, {
      display_name: p.display_name ?? p.first_name ?? 'User',
      first_name: p.first_name ?? null,
      avatar_url: p.avatar_url ?? null,
    });
  }

  return map;
}

export const leaderboardService = {
  upsertPresence,
  sendTagAlong,
  acceptTagAlong,
  declineTagAlong,
  fetchNearbyUsers,
  fetchIncomingRequests,
  fetchOutgoingRequests,
  fetchUserLevel,
  fetchProfilesBatch,
} as const;
