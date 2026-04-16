/**
 * ORCH-0437: Near You Leaderboard — Type definitions
 *
 * Matches the database schema from Phase 1 migrations and the
 * edge function contracts from SPEC_ORCH-0437_NEAR_YOU_BACKEND.md.
 */

// --- Leaderboard Presence ---

/** Matches the `leaderboard_presence` table row exactly */
export interface LeaderboardPresenceRow {
  user_id: string;
  is_discoverable: boolean;
  visibility_level: VisibilityLevel;
  lat: number;
  lng: number;
  activity_status: string | null;
  preference_categories: string[];
  last_swiped_category: string | null; // format: "category_slug:swipe_count"
  available_seats: number;
  active_collab_session_id: string | null;
  swipe_count: number;
  session_started_at: string; // ISO timestamp
  last_swipe_at: string;     // ISO timestamp
  user_level: number;
  created_at: string;
  updated_at: string;
}

/** Enriched with profile data and computed client-side fields */
export interface LeaderboardUser extends LeaderboardPresenceRow {
  display_name: string;
  first_name: string | null;
  avatar_url: string | null;
  // Computed client-side:
  proximity_tier: ProximityTier;
  distance_km: number;
  active_for_minutes: number;
  parsed_swiped_category: string | null; // category only, without the ":count" suffix
}

// --- Tag-Along Requests ---

export interface TagAlongRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: TagAlongStatus;
  collab_session_id: string | null;
  created_at: string;
  responded_at: string | null;
  expires_at: string;
}

/** Enriched with sender profile for the banner UI */
export interface TagAlongRequestWithSender extends TagAlongRequest {
  sender_display_name: string;
  sender_avatar_url: string | null;
  sender_level: number;
  sender_status: string | null;
}

// --- Edge Function Responses ---

export interface UpsertPresenceResponse {
  success: boolean;
  user_level: number;
  swipe_count: number;
}

export interface SendTagAlongResponse {
  success: boolean;
  request_id: string;
  already_friends: boolean;
}

export interface AcceptTagAlongResponse {
  success: boolean;
  collab_session_id: string;
  session_name: string;
  friendship_created: boolean;
  merged_categories: string[];
}

export interface DeclineTagAlongResponse {
  success: boolean;
}

// --- Enums & Constants ---

export type VisibilityLevel = 'off' | 'paired' | 'friends' | 'friends_of_friends' | 'everyone';

export type TagAlongStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export type ProximityTier = 'very_close' | 'nearby' | 'in_your_area' | 'further_out' | 'far_away';

/** Distance thresholds in km for each proximity tier */
export const PROXIMITY_THRESHOLDS: Record<ProximityTier, number> = {
  very_close: 1,
  nearby: 5,
  in_your_area: 20,
  further_out: 50,
  far_away: 100,
} as const;

// --- Utilities ---

/** Compute proximity tier from distance in km */
export function getProximityTier(distanceKm: number): ProximityTier {
  if (distanceKm < PROXIMITY_THRESHOLDS.very_close) return 'very_close';
  if (distanceKm < PROXIMITY_THRESHOLDS.nearby) return 'nearby';
  if (distanceKm < PROXIMITY_THRESHOLDS.in_your_area) return 'in_your_area';
  if (distanceKm < PROXIMITY_THRESHOLDS.further_out) return 'further_out';
  return 'far_away';
}

/** Parse the "category_slug:swipe_count" format from last_swiped_category */
export function parseSwipedCategory(raw: string | null): string | null {
  if (!raw) return null;
  const colonIdx = raw.lastIndexOf(':');
  if (colonIdx <= 0) return raw;
  return raw.substring(0, colonIdx);
}

/** Haversine distance between two lat/lng points, in km */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
