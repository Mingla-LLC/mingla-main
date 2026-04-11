import { SubscriptionTier } from '../types/subscription';

// ─────────────────────────────────────────────────────────────────────────────
// Tier limit definitions (2-tier: free / mingla_plus)
// ─────────────────────────────────────────────────────────────────────────────

export interface TierLimits {
  dailySwipes: number;        // -1 = unlimited
  maxPairings: number;        // -1 = unlimited
  maxSessions: number;        // -1 = unlimited
  maxSessionMembers: number;  // -1 = unlimited
  curatedCardsAccess: boolean; // true = can save curated cards (all users can VIEW)
  customStartingPoint: boolean;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    dailySwipes: -1,
    maxPairings: 1,
    maxSessions: 1,
    maxSessionMembers: -1,
    curatedCardsAccess: false,
    customStartingPoint: false,
  },
  mingla_plus: {
    dailySwipes: -1,
    maxPairings: -1,
    maxSessions: -1,
    maxSessionMembers: -1,
    curatedCardsAccess: true,
    customStartingPoint: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Accessor helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getTierLimits(tier: SubscriptionTier): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}

export function getSessionLimit(tier: SubscriptionTier): number {
  return getTierLimits(tier).maxSessions;
}
