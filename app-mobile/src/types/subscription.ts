import type { CustomerInfo } from 'react-native-purchases'
import { hasMinglaPlus } from '../services/revenueCatService'

// ─────────────────────────────────────────────────────────────────────────────
// Tier system (2-tier: free / mingla_plus)
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'mingla_plus'

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
  referralBonusStartedAt: string | null
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
 * Checks the new "Mingla Plus" entitlement plus legacy Pro/Elite for backward compat.
 */
export function getEffectiveTierFromRC(customerInfo: CustomerInfo | null): SubscriptionTier {
  if (!customerInfo) return 'free'
  if (hasMinglaPlus(customerInfo)) return 'mingla_plus'
  return 'free'
}

/**
 * Determine the effective tier from Supabase subscription data alone.
 *
 * Priority:
 *   1. Active trial (backward compat — no new trials are granted) → 'mingla_plus'
 *   2. Referral bonus (date-based, 30 days per referral) → 'mingla_plus'
 *   3. Legacy paid subscription (tier column) → return as-is
 *   4. Otherwise → 'free'
 *
 * Note: The onboarding trial branch (NULL trial_ends_at + not onboarded = elevated access)
 * has been removed. New users are free during onboarding.
 */
export function getEffectiveTierFromSupabase(
  sub: Subscription | null,
  _hasCompletedOnboarding?: boolean,
): SubscriptionTier {
  if (!sub) return 'free'

  // Active trial (backward compat — existing users only, no new trials granted)
  if (sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date()) {
    return 'mingla_plus'
  }

  // Referral bonus (date-based: 30 days per referral from start date)
  if (
    sub.referralBonusMonths > 0 &&
    sub.referralBonusStartedAt &&
    new Date(sub.referralBonusStartedAt).getTime()
      + sub.referralBonusMonths * 30 * 24 * 60 * 60 * 1000
      > Date.now()
  ) {
    return 'mingla_plus'
  }

  // Manual override / legacy paid record: honour the tier column directly.
  if (
    sub.tier !== 'free' &&
    sub.isActive &&
    (!sub.currentPeriodEnd || new Date(sub.currentPeriodEnd) > new Date())
  ) {
    return sub.tier
  }

  return 'free'
}

/**
 * Unified tier resolution combining RevenueCat (paid) and Supabase (trial/referral).
 *
 * Hierarchy: mingla_plus > free
 *
 * Resolution order:
 *   1. RC reports active entitlement → 'mingla_plus'
 *   2. Supabase reports active trial or referral bonus → 'mingla_plus'
 *   3. Otherwise → 'free'
 */
export function getEffectiveTier(
  customerInfo: CustomerInfo | null,
  sub: Subscription | null,
  hasCompletedOnboarding?: boolean,
): SubscriptionTier {
  const rcTier = getEffectiveTierFromRC(customerInfo)
  if (rcTier !== 'free') return rcTier

  return getEffectiveTierFromSupabase(sub, hasCompletedOnboarding)
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getTrialDaysRemaining(sub: Subscription | null): number {
  if (!sub?.trialEndsAt) return 0
  const diff = new Date(sub.trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

/**
 * Returns the total trial duration in days, derived from the difference between
 * trial_ends_at and the subscription's created_at.
 * Falls back to 7 if dates are missing or invalid.
 */
export function getTrialTotalDays(sub: Subscription | null): number {
  if (!sub?.trialEndsAt) return 7
  const start = new Date(sub.createdAt).getTime()
  const end = new Date(sub.trialEndsAt).getTime()
  const totalMs = end - start
  if (totalMs <= 0) return 7
  return Math.ceil(totalMs / (1000 * 60 * 60 * 24))
}

export function getReferralDaysRemaining(sub: Subscription | null): number {
  if (!sub || !sub.referralBonusStartedAt || sub.referralBonusMonths <= 0) return 0
  const expiresAt = new Date(sub.referralBonusStartedAt).getTime()
    + sub.referralBonusMonths * 30 * 24 * 60 * 60 * 1000
  const remaining = expiresAt - Date.now()
  return Math.max(0, Math.ceil(remaining / (1000 * 60 * 60 * 24)))
}

/**
 * Returns true if the user has Mingla+ access (paid, trial, or referral).
 */
export function hasElevatedAccess(tier: SubscriptionTier): boolean {
  return tier === 'mingla_plus'
}
