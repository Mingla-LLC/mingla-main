export type SubscriptionTier = 'free' | 'pro' | 'elite'

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

export function getEffectiveTier(sub: Subscription | null): SubscriptionTier {
  if (!sub) return 'free'

  // Active paid subscription
  if (sub.tier !== 'free' && sub.isActive && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date()) {
    return sub.tier
  }

  // Active trial
  if (sub.trialEndsAt && new Date(sub.trialEndsAt) > new Date()) {
    return 'elite'
  }

  // Unused referral bonus
  if (sub.referralBonusMonths > sub.referralBonusUsedMonths) {
    return 'elite'
  }

  return 'free'
}

export function getTrialDaysRemaining(sub: Subscription | null): number {
  if (!sub?.trialEndsAt) return 0
  const diff = new Date(sub.trialEndsAt).getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function getReferralMonthsRemaining(sub: Subscription | null): number {
  if (!sub) return 0
  return Math.max(0, sub.referralBonusMonths - sub.referralBonusUsedMonths)
}
