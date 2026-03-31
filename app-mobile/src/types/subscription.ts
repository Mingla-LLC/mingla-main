import type { CustomerInfo } from 'react-native-purchases'
import { hasProEntitlement, hasEliteEntitlement } from '../services/revenueCatService'

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
 *
 * Priority:
 *   1. Active "Mingla Elite" entitlement → 'elite'
 *   2. Active "Mingla Pro" entitlement  → 'pro'
 *   3. Otherwise → 'free'
 *
 * Trial and referral-bonus access is checked separately via getEffectiveTierFromSupabase.
 * The unified hook (useEffectiveTier) combines both sources.
 */
export function getEffectiveTierFromRC(customerInfo: CustomerInfo | null): SubscriptionTier {
  if (!customerInfo) return 'free'
  if (hasEliteEntitlement(customerInfo)) return 'elite'
  if (hasProEntitlement(customerInfo)) return 'pro'
  return 'free'
}

/**
 * Determine the effective tier from Supabase subscription data alone.
 *
 * Priority:
 *   1. Active trial (7-day clock ticking) → 'elite'
 *   2. Onboarding trial (trial_ends_at NULL + not yet onboarded) → 'elite'
 *   3. Unused referral bonus months → 'elite'
 *   4. Otherwise → 'free'
 *
 * Note: Paid subscription status is now owned by RevenueCat (getEffectiveTierFromRC).
 * The Supabase tier column is only checked here for legacy records; new paid
 * subscriptions must appear in RevenueCat to be honoured.
 *
 * @param hasCompletedOnboarding — from profiles.has_completed_onboarding.
 *   When the subscription row exists but trial_ends_at is NULL and the user
 *   hasn't finished onboarding, they get Elite access (the 7-day clock hasn't
 *   started yet). Must match the SQL get_effective_tier() logic exactly.
 */
export function getEffectiveTierFromSupabase(
  sub: Subscription | null,
  hasCompletedOnboarding?: boolean,
): SubscriptionTier {
  if (!sub) return 'free'

  // Active trial (7-day clock is ticking)
  if (sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date()) {
    return 'elite'
  }

  // Onboarding trial: subscription exists but trial not yet started
  // User is still in onboarding → grant Elite access
  if (!sub.trialEndsAt && !hasCompletedOnboarding) {
    return 'elite'
  }

  // Referral bonus (date-based: 30 days per referral from start date)
  if (
    sub.referralBonusMonths > 0 &&
    sub.referralBonusStartedAt &&
    new Date(sub.referralBonusStartedAt).getTime()
      + sub.referralBonusMonths * 30 * 24 * 60 * 60 * 1000
      > Date.now()
  ) {
    return 'elite'
  }

  // Manual override / legacy paid record: honour the tier column directly.
  // This covers two cases:
  //   1. Developer/QA manually sets tier in Supabase for testing
  //   2. Legacy paid subscriptions where syncSubscriptionFromRC wrote tier + is_active
  //      but RevenueCat is unavailable (test key, offline, SDK error)
  // Guard: only trust the column when is_active is true AND (no expiry set OR expiry
  // is in the future). This prevents honouring stale rows from cancelled subs.
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
 * Hierarchy (highest to lowest):
 *   'elite' > 'pro' > 'free'
 *
 * Resolution order:
 *   1. RC reports active entitlement → return highest RC tier (Elite checked first)
 *   2. Supabase reports active trial or referral bonus → 'elite'
 *   3. Otherwise → 'free'
 *
 * Elite is the top tier — purchasable, earnable via trial (7 days at signup),
 * and earnable via referral bonuses (1 month per referred friend).
 * Pro is the mid-tier paid plan. Both grant elevated access over Free.
 * Use `hasElevatedAccess(tier)` to gate features available to any paid/earned tier.
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
 *
 * Uses createdAt (immutable) instead of updatedAt because the subscriptions table
 * has an auto-update trigger that overwrites updated_at on every row modification
 * (referral credits, tier changes, etc.), which would shrink the calculated duration.
 *
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
 * Returns true if the user has any form of paid / elevated access.
 * Use this for feature gates instead of comparing tier strings directly.
 */
export function hasElevatedAccess(tier: SubscriptionTier): boolean {
  return tier === 'pro' || tier === 'elite'
}
