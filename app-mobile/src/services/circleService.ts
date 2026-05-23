import { supabase } from './supabase';
import type { CirclePerson, CircleTier } from '../types/circle';

type CircleRpcRow = {
  user_id: string;
  tier: CircleTier;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  has_business_app: boolean | null;
  sort_score: number | string | null;
};

const TIER_RANK: Record<CircleTier, number> = {
  close: 3,
  friend: 2,
  extended: 1,
};

function isCircleTier(value: string): value is CircleTier {
  return value === 'close' || value === 'friend' || value === 'extended';
}

function mapCircleRow(row: CircleRpcRow): CirclePerson {
  if (!row.user_id) {
    throw new Error('get_user_circle returned a row without user_id');
  }
  if (!isCircleTier(row.tier)) {
    throw new Error(`get_user_circle returned invalid tier: ${row.tier}`);
  }

  return {
    userId: row.user_id,
    tier: row.tier,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    hasBusinessApp: row.has_business_app === true,
    sortScore: Number(row.sort_score ?? 0),
  };
}

function dedupeByStrongestTier(people: CirclePerson[]): CirclePerson[] {
  const byUser = new Map<string, CirclePerson>();
  for (const person of people) {
    const existing = byUser.get(person.userId);
    if (!existing || TIER_RANK[person.tier] > TIER_RANK[existing.tier]) {
      byUser.set(person.userId, person);
    }
  }
  return [...byUser.values()].sort((a, b) => {
    if (b.sortScore !== a.sortScore) return b.sortScore - a.sortScore;
    return a.userId.localeCompare(b.userId);
  });
}

export async function fetchUserCircle(
  viewerUserId: string,
  limit = 60,
  offset = 0,
): Promise<CirclePerson[]> {
  const { data, error } = await supabase.rpc('get_user_circle', {
    p_viewer_user_id: viewerUserId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    throw new Error(error.message || 'Failed to load your circle');
  }

  const rows = Array.isArray(data) ? (data as CircleRpcRow[]) : [];
  return dedupeByStrongestTier(rows.map(mapCircleRow));
}
