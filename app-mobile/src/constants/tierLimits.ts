import { SubscriptionTier } from '../types/subscription';

// ─────────────────────────────────────────────────────────────────────────────
// Tier limit definitions
// ─────────────────────────────────────────────────────────────────────────────

export interface TierLimits {
  dailySwipes: number;        // -1 = unlimited
  maxPairings: number;        // -1 = unlimited, 0 = none
  maxSessions: number;        // -1 = unlimited
  maxSessionMembers: number;
  curatedCardsAccess: boolean;
  customStartingPoint: boolean;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    dailySwipes: 20,
    maxPairings: 0,
    maxSessions: 1,
    maxSessionMembers: 5,
    curatedCardsAccess: false,
    customStartingPoint: false,
  },
  pro: {
    dailySwipes: -1,
    maxPairings: 0,
    maxSessions: 3,
    maxSessionMembers: 5,
    curatedCardsAccess: true,
    customStartingPoint: true,
  },
  elite: {
    dailySwipes: -1,
    maxPairings: -1,
    maxSessions: -1,
    maxSessionMembers: 15,
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

export function canAccessCuratedCards(tier: SubscriptionTier): boolean {
  return getTierLimits(tier).curatedCardsAccess;
}

export function canSetCustomStartingPoint(tier: SubscriptionTier): boolean {
  return getTierLimits(tier).customStartingPoint;
}

export function canPair(tier: SubscriptionTier): boolean {
  return tier === 'elite';
}

export function getSessionLimit(tier: SubscriptionTier): number {
  return getTierLimits(tier).maxSessions;
}

export function getSwipeLimit(tier: SubscriptionTier): number {
  return getTierLimits(tier).dailySwipes;
}
