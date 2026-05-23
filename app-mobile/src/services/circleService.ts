import { supabase } from './supabase';
import type {
  CirclePerson,
  CircleRelationshipContextType,
  CircleRelationshipSource,
  CircleTier,
} from '../types/circle';

type CircleRpcRow = {
  user_id: string;
  tier: CircleTier;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  has_business_app: boolean | null;
  relationship_source: string | null;
  relationship_label: string | null;
  relationship_context_type: string | null;
  relationship_context_id: string | null;
  relationship_context_title: string | null;
  relationship_source_count: number | string | null;
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

function isRelationshipSource(value: string | null | undefined): value is CircleRelationshipSource {
  return value === 'paired' ||
    value === 'friend' ||
    value === 'friend_of_friend' ||
    value === 'co_attendee' ||
    value === 'mixed';
}

function isRelationshipContextType(
  value: string | null | undefined,
): value is CircleRelationshipContextType {
  return value === 'user' || value === 'event' || value === 'trip';
}

function fallbackRelationshipSource(tier: CircleTier): CircleRelationshipSource | null {
  if (tier === 'close') return 'paired';
  if (tier === 'friend') return 'friend';
  if (tier === 'extended') return 'mixed';
  return null;
}

function fallbackRelationshipLabel(
  tier: CircleTier,
  source: CircleRelationshipSource | null,
): string | null {
  if (tier === 'close') return 'Close friend';
  if (tier === 'friend') return 'Friend';
  if (tier === 'extended' && source === 'friend_of_friend') return 'Friend of a friend';
  if (tier === 'extended') return 'Connected through Mingla';
  return null;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function mapCircleRow(row: CircleRpcRow): CirclePerson | null {
  if (!row.user_id) {
    throw new Error('get_user_circle returned a row without user_id');
  }
  if (!isCircleTier(row.tier)) {
    throw new Error(`get_user_circle returned invalid tier: ${row.tier}`);
  }

  const relationshipSource = isRelationshipSource(row.relationship_source)
    ? row.relationship_source
    : fallbackRelationshipSource(row.tier);
  const relationshipLabel = normalizeText(row.relationship_label) ??
    fallbackRelationshipLabel(row.tier, relationshipSource);

  if (!relationshipSource || !relationshipLabel) {
    return null;
  }

  const relationshipContextType = isRelationshipContextType(row.relationship_context_type)
    ? row.relationship_context_type
    : null;

  return {
    userId: row.user_id,
    tier: row.tier,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    hasBusinessApp: row.has_business_app === true,
    relationshipSource,
    relationshipLabel,
    relationshipContextType,
    relationshipContextId: row.relationship_context_id ?? null,
    relationshipContextTitle: normalizeText(row.relationship_context_title),
    relationshipSourceCount: Number(row.relationship_source_count ?? 1),
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
  return dedupeByStrongestTier(rows.map(mapCircleRow).filter((person): person is CirclePerson => person !== null));
}
