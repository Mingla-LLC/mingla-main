import { supabase } from './supabase'
import { Subscription, ReferralCredit } from '../types/subscription'

// DB row shapes (snake_case, matching Supabase column names)
interface SubscriptionRow {
  id: string
  user_id: string
  tier: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  current_period_start: string | null
  current_period_end: string | null
  trial_ends_at: string | null
  referral_bonus_months: number
  referral_bonus_used_months: number
  is_active: boolean
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

interface ReferralCreditRow {
  id: string
  referrer_id: string
  referred_id: string
  status: string
  credited_at: string | null
  created_at: string
}

function mapSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.user_id,
    tier: row.tier,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
    referralBonusMonths: row.referral_bonus_months,
    referralBonusUsedMonths: row.referral_bonus_used_months,
    isActive: row.is_active,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapReferralCredit(row: ReferralCreditRow): ReferralCredit {
  return {
    id: row.id,
    referrerId: row.referrer_id,
    referredId: row.referred_id,
    status: row.status,
    creditedAt: row.credited_at,
    createdAt: row.created_at,
  }
}

export async function getSubscription(userId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('[subscriptionService] getSubscription error:', error)
    return null
  }

  return data ? mapSubscription(data) : null
}

export async function getReferralCredits(userId: string): Promise<ReferralCredit[]> {
  const { data, error } = await supabase
    .from('referral_credits')
    .select('*')
    .eq('referrer_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[subscriptionService] getReferralCredits error:', error)
    return []
  }

  return (data ?? []).map(mapReferralCredit)
}

export async function getReferralStats(userId: string): Promise<{ total: number; credited: number; pending: number }> {
  const { data, error } = await supabase
    .from('referral_credits')
    .select('status')
    .eq('referrer_id', userId)

  if (error) {
    console.error('[subscriptionService] getReferralStats error:', error)
    return { total: 0, credited: 0, pending: 0 }
  }

  const rows = data ?? []
  return {
    total: rows.length,
    credited: rows.filter(r => r.status === 'credited').length,
    pending: rows.filter(r => r.status === 'pending').length,
  }
}
