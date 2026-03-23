import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSubscription, getReferralCredits, getReferralStats, getEffectiveTierFromServer } from '../services/subscriptionService'
import {
  SubscriptionTier,
  getEffectiveTier,
  getTrialDaysRemaining,
  getTrialTotalDays,
  getReferralMonthsRemaining,
  hasElevatedAccess,
} from '../types/subscription'
import { useCustomerInfo } from './useRevenueCat'
import { useAppStore } from '../store/appStore'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { logAppsFlyerEvent } from '../services/appsFlyerService'

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptionKeys = {
  all: ['subscription'] as const,
  detail: (userId: string) => [...subscriptionKeys.all, userId] as const,
  referrals: (userId: string) => [...subscriptionKeys.all, 'referrals', userId] as const,
  referralStats: (userId: string) => [...subscriptionKeys.all, 'referral-stats', userId] as const,
  serverTier: (userId: string) => [...subscriptionKeys.all, 'server-tier', userId] as const,
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase subscription hooks
// ─────────────────────────────────────────────────────────────────────────────

export function useSubscription(userId: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.detail(userId ?? ''),
    queryFn: () => getSubscription(userId!),
    enabled: !!userId,
    staleTime: 60_000,
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
// Server tier hook (admin overrides)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the authoritative tier from the server-side get_effective_tier() RPC.
 * This includes admin subscription overrides which the client-side logic cannot see.
 * staleTime matches useSubscription (60s) — keeps tier window tight.
 */
export function useServerTier(userId: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.serverTier(userId ?? ''),
    queryFn: () => getEffectiveTierFromServer(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified tier hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The single source of truth for the current user's subscription tier.
 *
 * Hierarchy: elite > pro > free
 *
 * Sources (in priority order):
 *   1. RevenueCat CustomerInfo  — active entitlement (Elite checked first, then Pro)
 *   2. Supabase subscription    — active trial or referral bonus months → 'elite'
 *   3. Server-side RPC          — admin subscription overrides (Priority 0 on server)
 *   4. Fallback                 → 'free'
 *
 * Takes the higher of client-side and server-side tiers so neither source
 * can downgrade the user.
 */
export function useEffectiveTier(userId: string | undefined): SubscriptionTier {
  const { data: customerInfo } = useCustomerInfo()
  const { data: subscription } = useSubscription(userId)
  const { data: serverTier } = useServerTier(userId)
  const profile = useAppStore((s) => s.profile)

  // Client-side tier (RevenueCat + Supabase subscriptions table)
  const clientTier = getEffectiveTier(
    customerInfo ?? null,
    subscription ?? null,
    profile?.has_completed_onboarding ?? undefined,
  )

  // Server tier includes admin overrides — take the higher of the two
  if (serverTier && serverTier !== 'free') {
    const tierRank: Record<string, number> = { free: 0, pro: 1, elite: 2 }
    const serverRank = tierRank[serverTier] ?? 0
    const clientRank = tierRank[clientTier] ?? 0
    if (serverRank > clientRank) {
      return serverTier as SubscriptionTier
    }
  }

  return clientTier
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

/** Returns the total trial duration in days (derived from actual dates, not hardcoded). */
export function useTrialTotalDays(userId: string | undefined): number {
  const { data: subscription } = useSubscription(userId)
  return getTrialTotalDays(subscription ?? null)
}

/** Returns how many referral bonus months remain, or 0 if none. */
export function useReferralMonthsRemaining(userId: string | undefined): number {
  const { data: subscription } = useSubscription(userId)
  return getReferralMonthsRemaining(subscription ?? null)
}

// ─────────────────────────────────────────────────────────────────────────────
// Trial expiry attribution
// ─────────────────────────────────────────────────────────────────────────────

const AF_TRIAL_EXPIRED_KEY = 'af_trial_expired_logged'

/**
 * Fires `trial_expired_no_conversion` exactly once per user when:
 *   - trialEndsAt is in the past
 *   - tier is 'free' (user did not convert)
 *
 * Uses AsyncStorage to persist the "already fired" flag so the event
 * survives app restarts and never double-fires.
 */
export function useTrialExpiryTracking(userId: string | undefined): void {
  const { data: subscription } = useSubscription(userId)
  const tier = useEffectiveTier(userId)
  const firedRef = useRef(false)

  useEffect(() => {
    if (!subscription || !userId || firedRef.current) return
    if (tier !== 'free') return
    if (!subscription.trialEndsAt) return
    if (new Date(subscription.trialEndsAt) >= new Date()) return

    const storageKey = `${AF_TRIAL_EXPIRED_KEY}:${userId}`

    AsyncStorage.getItem(storageKey).then((value) => {
      if (value) {
        firedRef.current = true
        return
      }
      logAppsFlyerEvent('trial_expired_no_conversion', {
        trial_days: getTrialTotalDays(subscription),
      })
      firedRef.current = true
      AsyncStorage.setItem(storageKey, '1').catch(() => {})
    }).catch(() => {})
  }, [subscription, tier, userId])
}
