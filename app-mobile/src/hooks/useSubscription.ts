import { useQuery } from '@tanstack/react-query'
import { getSubscription, getReferralCredits, getReferralStats } from '../services/subscriptionService'
import {
  SubscriptionTier,
  getEffectiveTier,
  getTrialDaysRemaining,
  getReferralMonthsRemaining,
  hasElevatedAccess,
} from '../types/subscription'
import { useCustomerInfo } from './useRevenueCat'
import { useAppStore } from '../store/appStore'

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptionKeys = {
  all: ['subscription'] as const,
  detail: (userId: string) => [...subscriptionKeys.all, userId] as const,
  referrals: (userId: string) => [...subscriptionKeys.all, 'referrals', userId] as const,
  referralStats: (userId: string) => [...subscriptionKeys.all, 'referral-stats', userId] as const,
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase subscription hooks
// ─────────────────────────────────────────────────────────────────────────────

export function useSubscription(userId: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.detail(userId ?? ''),
    queryFn: () => getSubscription(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useReferralCredits(userId: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.referrals(userId ?? ''),
    queryFn: () => getReferralCredits(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useReferralStats(userId: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.referralStats(userId ?? ''),
    queryFn: () => getReferralStats(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified tier hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single source of truth for the current user's subscription tier.
 *
 * Sources (in priority order):
 *   1. RevenueCat CustomerInfo  — active "Mingla Pro" entitlement → 'pro'
 *   2. Supabase subscription    — active 7-day trial or referral bonus months → 'elite'
 *   3. Fallback                 → 'free'
 *
 * This hook is safe to call from any component; it won't cause extra network
 * requests because both underlying queries are cached in React Query.
 */
export function useEffectiveTier(userId: string | undefined): SubscriptionTier {
  const { data: customerInfo } = useCustomerInfo()
  const { data: subscription } = useSubscription(userId)
  const profile = useAppStore((s) => s.profile)
  return getEffectiveTier(
    customerInfo ?? null,
    subscription ?? null,
    profile?.has_completed_onboarding ?? undefined,
  )
}

/**
 * Convenience hook — returns true if the user has any elevated access (pro or elite).
 * Use this for feature gates: `if (!isUpgraded) showPaywall()`
 */
export function useIsUpgraded(userId: string | undefined): boolean {
  const tier = useEffectiveTier(userId)
  return hasElevatedAccess(tier)
}

// ─────────────────────────────────────────────────────────────────────────────
// Status detail hooks
// ─────────────────────────────────────────────────────────────────────────────

/** Returns how many days remain in the free trial, or 0 if no trial is active. */
export function useTrialDaysRemaining(userId: string | undefined): number {
  const { data: subscription } = useSubscription(userId)
  return getTrialDaysRemaining(subscription ?? null)
}

/** Returns how many referral bonus months remain, or 0 if none. */
export function useReferralMonthsRemaining(userId: string | undefined): number {
  const { data: subscription } = useSubscription(userId)
  return getReferralMonthsRemaining(subscription ?? null)
}
