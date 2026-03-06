import { useQuery } from '@tanstack/react-query'
import { getSubscription, getReferralCredits, getReferralStats } from '../services/subscriptionService'
import { Subscription, SubscriptionTier, getEffectiveTier } from '../types/subscription'

export const subscriptionKeys = {
  all: ['subscription'] as const,
  detail: (userId: string) => [...subscriptionKeys.all, userId] as const,
  referrals: (userId: string) => [...subscriptionKeys.all, 'referrals', userId] as const,
  referralStats: (userId: string) => [...subscriptionKeys.all, 'referral-stats', userId] as const,
}

export function useSubscription(userId: string | undefined) {
  return useQuery({
    queryKey: subscriptionKeys.detail(userId ?? ''),
    queryFn: () => getSubscription(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useEffectiveTier(userId: string | undefined): SubscriptionTier {
  const { data: subscription } = useSubscription(userId)
  return getEffectiveTier(subscription ?? null)
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
