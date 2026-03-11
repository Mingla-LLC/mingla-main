import type { CustomerInfo } from 'react-native-purchases'
import { hasProEntitlement } from '../services/revenueCatService'

// ─────────────────────────────────────────────────────────────────────────────
// Tier system
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro' | 'elite'

// ─────────────────────────────────────────────────────────────────────────────
// Supabase subscription record
// ─────────────────────────────────────────────────────────────────────────────

export interface Subscription {
  id: string
  userId: string
  tier: SubscriptionTier
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  referralBonusMonths: number
  referralBonusUsedMonths: number
  isActive: boolean
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ReferralCredit {
  id: string
  referrerId: string
  referredId: string
  status: 'pending' | 'credited' | 'expired'
  creditedAt: string | null
  createdAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier determination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine the effective tier from RevenueCat CustomerInfo alone.
 *
 * Priority:
 *   1. Active "Mingla Pro" entitlement via RevenueCat → 'pro'
 *   2. Otherwise → 'free'
 *
 * Trial and referral-bonus access is checked separately via getEffectiveTierFromSupabase.
 * The unified hook (useEffectiveTier) combines both sources.
 */
export function getEffectiveTierFromRC(customerInfo: CustomerInfo | null): SubscriptionTier {
  if (!customerInfo) return 'free'
  return hasProEntitlement(customerInfo) ? 'pro' : 'free'
}

/**
 * Determine the effective tier from Supabase subscription data alone.
 *
 * Priority:
 *   1. Active trial (7-day) → 'elite'
 *   2. Unused referral bonus months → 'elite'
 *   3. Otherwise → 'free'
 *
 * Note: Paid subscription status is now owned by RevenueCat (getEffectiveTierFromRC).
 * The Supabase tier column is only checked here for legacy records; new paid
 * subscriptions must appear in RevenueCat to be honoured.
 */
export function getEffectiveTierFromSupabase(sub: Subscription | null): SubscriptionTier {
  if (!sub) return 'free'

  // Active trial
  if (sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date()) {
    return 'elite'
  }

  // Unused referral bonus months
  if (sub.referralBonusMonths > sub.referralBonusUsedMonths) {
    return 'elite'
  }

  return 'free'
}

/**
 * Unified tier resolution combining RevenueCat (paid) and Supabase (trial/referral).
 *
 * Priority:
 *   1. RC reports active "Mingla Pro" entitlement → 'pro'
 *   2. Supabase reports active trial or referral bonus → 'elite'
 *   3. Otherwise → 'free'
 *
 * 'pro' ≥ 'elite' ≥ 'free' — all paid features available to 'pro' users are also
 * available to 'elite' users. The PaywallScreen and entitlement checks treat both
 * 'pro' and 'elite' as "has access". Check `tier !== 'free'` to gate features.
 */
export function getEffectiveTier(
  customerInfo: CustomerInfo | null,
  sub: Subscription | null,
): SubscriptionTier {
  const rcTier = getEffectiveTierFromRC(customerInfo)
  if (rcTier !== 'free') return rcTier

  return getEffectiveTierFromSupabase(sub)
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getTrialDaysRemaining(sub: Subscription | null): number {
  if (!sub?.trialEndsAt) return 0
  const diff = new Date(sub.trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function getReferralMonthsRemaining(sub: Subscription | null): number {
  if (!sub) return 0
  return Math.max(0, sub.referralBonusMonths - sub.referralBonusUsedMonths)
}

/**
 * Returns true if the user has any form of paid / elevated access.
 * Use this for feature gates instead of comparing tier strings directly.
 */
export function hasElevatedAccess(tier: SubscriptionTier): boolean {
  return tier === 'pro' || tier === 'elite'
}
