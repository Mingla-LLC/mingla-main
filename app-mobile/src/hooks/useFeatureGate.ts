import { useCallback } from 'react';
import { useEffectiveTier } from './useSubscription';
import { getTierLimits, TierLimits } from '../constants/tierLimits';
import { SubscriptionTier } from '../types/subscription';
import { useAppStore } from '../store/appStore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type GatedFeature =
  | 'curated_cards'
  | 'custom_starting_point'
  | 'pairing'
  | 'session_creation'
  | 'unlimited_swipes';

export interface FeatureGateResult {
  tier: SubscriptionTier;
  tierLoading: boolean;
  limits: TierLimits;
  canAccess: (feature: GatedFeature) => boolean;
  requiredTier: (feature: GatedFeature) => SubscriptionTier;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimum tier required per feature
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_TIER_MAP: Record<GatedFeature, SubscriptionTier> = {
  curated_cards: 'pro',
  custom_starting_point: 'pro',
  pairing: 'elite',
  session_creation: 'free',
  unlimited_swipes: 'pro',
};

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unified feature-gate hook.
 *
 * Usage:
 *   const { canAccess, requiredTier } = useFeatureGate();
 *   if (!canAccess('curated_cards')) showPaywall(requiredTier('curated_cards'));
 */
export function useFeatureGate(): FeatureGateResult {
  const { user } = useAppStore();
  const { tier, isLoading: tierLoading } = useEffectiveTier(user?.id);
  const limits = getTierLimits(tier);

  const canAccess = useCallback(
    (feature: GatedFeature): boolean => {
      switch (feature) {
        case 'curated_cards':
          return limits.curatedCardsAccess;
        case 'custom_starting_point':
          return limits.customStartingPoint;
        case 'pairing':
          return tier === 'elite';
        case 'unlimited_swipes':
          return limits.dailySwipes === -1;
        case 'session_creation':
          return true;
        default:
          return false;
      }
    },
    [tier, limits],
  );

  const requiredTier = useCallback(
    (feature: GatedFeature): SubscriptionTier => FEATURE_TIER_MAP[feature],
    [],
  );

  return { tier, tierLoading, limits, canAccess, requiredTier };
}
