import { useEffect } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query'
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
  MakePurchaseResult,
} from 'react-native-purchases'
import {
  getCustomerInfo,
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
  addCustomerInfoListener,
  loginRevenueCat,
  logoutRevenueCatIfIdentified,
} from '../services/revenueCatService'
import { getAppsFlyerUid, logAppsFlyerEvent } from '../services/appsFlyerService'
import { explorerAnalyticsOptedOut } from '../services/analyticsOptOut'
import { mixpanelService } from '../services/mixpanelService'

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────

export const revenueCatKeys = {
  all: ['revenuecat'] as const,
  customerInfo: () => [...revenueCatKeys.all, 'customer-info'] as const,
  offerings: () => [...revenueCatKeys.all, 'offerings'] as const,
}

function isRevenueCatOfferingsConfigError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()

  return (
    message.includes('there is an issue with your configuration') ||
    message.includes('error fetching offerings') ||
    message.includes('no app store products registered') ||
    message.includes('why-are-offerings-empty') ||
    message.includes('offeringsmanager.error')
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer info
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches and caches the RevenueCat CustomerInfo object.
 * Re-fetches whenever the query is invalidated (e.g. after a purchase or restore).
 *
 * staleTime: 60s — keeps tier window tight. CustomerInfo is also kept current
 * via the real-time listener below.
 */
export function useCustomerInfo(): UseQueryResult<CustomerInfo, Error> {
  return useQuery({
    queryKey: revenueCatKeys.customerInfo(),
    queryFn: getCustomerInfo,
    staleTime: 60_000,
    retry: 2,
  })
}

/**
 * Registers the RevenueCat real-time listener and pushes updates directly into
 * the React Query cache. Mount this once at the root of the authenticated app
 * (e.g. AppContent in index.tsx).
 *
 * When a subscription renews or a purchase completes on another device, RC
 * fires this listener and the UI updates without requiring a manual refresh.
 */
export function useCustomerInfoListener(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const cleanup = addCustomerInfoListener((info) => {
      queryClient.setQueryData(revenueCatKeys.customerInfo(), info)
      // #4238 W6-3: each RevenueCat identity (anonymous, then the signed-in
      // user) gets the AppsFlyer id once, so RevenueCat's server integration
      // can attribute subscription revenue, renewals and refunds.
      void linkAppsFlyerIdToRevenueCat(info.originalAppUserId)
    })
    return cleanup
  }, [queryClient])
}

// ─────────────────────────────────────────────────────────────────────────────
// #4238 W6-3 (I-4238-SUB-REVENUE-SERVER-ONLY) — AppsFlyer id → RevenueCat
// ─────────────────────────────────────────────────────────────────────────────

const _appsFlyerLinkedFor = new Set<string>()
const _appsFlyerClearedFor = new Set<string>()

type PurchasesAppsFlyerLink = { setAppsflyerID: (id: string | null) => Promise<void> }
function purchasesSdk(): PurchasesAppsFlyerLink {
  // Lazy: this hook file only type-imports the native SDK at module scope,
  // so render suites that never configure RevenueCat never load it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('react-native-purchases') as { default: PurchasesAppsFlyerLink }).default
}

/**
 * Hand RevenueCat the AppsFlyer id via Purchases.setAppsflyerID (Step 0 Z13:
 * it rejects until Purchases.configure ran, so it is called from the customer
 * info listener, which only fires on a configured SDK). Once per RevenueCat
 * user id; retried on the next update when AppsFlyer was not ready. Never
 * throws.
 */
export async function linkAppsFlyerIdToRevenueCat(rcUserId: string | null | undefined): Promise<boolean> {
  const key = typeof rcUserId === 'string' ? rcUserId : ''
  if (key.length === 0) return false
  // #4238 P2-3 (I-4238-AF-RESPECTS-OPT-OUT): with "share usage data" off,
  // RevenueCat never holds the AppsFlyer id (its server integration would
  // otherwise send subscription revenue for this person). A link made before
  // the switch is cleared once; switching back on links again.
  if (explorerAnalyticsOptedOut()) {
    if (_appsFlyerClearedFor.has(key)) return false
    try {
      await purchasesSdk().setAppsflyerID(null)
      _appsFlyerClearedFor.add(key)
      _appsFlyerLinkedFor.delete(key)
    } catch (e) {
      console.warn('[RevenueCat] clearing the AppsFlyer id failed:', e)
    }
    return false
  }
  _appsFlyerClearedFor.delete(key)
  if (_appsFlyerLinkedFor.has(key)) return false
  const uid = await getAppsFlyerUid()
  if (!uid) return false
  try {
    await purchasesSdk().setAppsflyerID(uid)
    _appsFlyerLinkedFor.add(key)
    return true
  } catch (e) {
    console.warn('[RevenueCat] setAppsflyerID failed:', e)
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entitlement check
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Offerings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the current RevenueCat offering (the set of packages available for
 * purchase as configured in the RC dashboard).
 *
 * staleTime: 30 minutes — offerings change rarely; no need to refetch often.
 */
export function useOfferings(enabled: boolean = true): UseQueryResult<PurchasesOffering | null, Error> {
  return useQuery({
    queryKey: revenueCatKeys.offerings(),
    queryFn: async () => {
      try {
        return await getCurrentOffering()
      } catch (error) {
        if (isRevenueCatOfferingsConfigError(error)) {
          console.warn('[RevenueCat] Offerings unavailable; returning null instead of failing query.')
          return null
        }

        throw error
      }
    },
    staleTime: 30 * 60 * 1000,
    retry: false,
    enabled,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mutation hook for purchasing a package.
 * On success, the CustomerInfo cache is updated immediately via setQueryData so
 * the UI reflects the new entitlement without an extra network round-trip.
 *
 * Usage:
 *   const { mutateAsync: purchase, isPending } = usePurchasePackage()
 *   await purchase(selectedPackage)
 */
export function usePurchasePackage(): UseMutationResult<
  MakePurchaseResult,
  Error,
  PurchasesPackage
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (pkg: PurchasesPackage) => purchasePackage(pkg),
    onSuccess: ({ customerInfo }, pkg) => {
      // Push the fresh CustomerInfo into the cache immediately
      queryClient.setQueryData(revenueCatKeys.customerInfo(), customerInfo)

      // ── Analytics: subscription funnel event ──
      // #4238 W6-3 (I-4238-SUB-REVENUE-SERVER-ONLY): no af_revenue here. The
      // client price is unvalidated and misses renewals and refunds; revenue
      // reaches AppsFlyer only from RevenueCat's server integration.
      logAppsFlyerEvent('af_subscribe', {
        af_content_type: 'mingla_plus',
        af_content_id: pkg.identifier,
        af_quantity: 1,
      })
      mixpanelService.trackSubscriptionPurchased({
        plan: pkg.identifier,
        tier: 'mingla_plus',
        revenue: pkg.product?.price ?? 0,
        currency: pkg.product?.currencyCode ?? 'USD',
      })
    },
    onError: (error) => {
      // User cancellation is handled by consuming components — only log here
      const isCancelled = error != null && typeof error === 'object' && 'userCancelled' in error && (error as any).userCancelled;
      if (!isCancelled) {
        console.error('[RevenueCat] Purchase failed:', error);
      }
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore purchases
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mutation hook for restoring previous purchases (App Store / Play Store).
 * After a successful restore, the CustomerInfo cache is refreshed.
 *
 * Usage:
 *   const { mutateAsync: restore, isPending } = useRestorePurchases()
 *   await restore()
 */
export function useRestorePurchases(): UseMutationResult<CustomerInfo, Error, void> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => restorePurchases(),
    onSuccess: (customerInfo) => {
      queryClient.setQueryData(revenueCatKeys.customerInfo(), customerInfo)
    },
    onError: (error) => {
      console.error('[RevenueCat] Restore failed:', error);
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Login / logout (call alongside Supabase auth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mutation hook for logging a user into RevenueCat after Supabase sign-in.
 * Merges any anonymous purchases into the identified account.
 *
 * Usage:
 *   const { mutateAsync: rcLogin } = useRevenueCatLogin()
 *   await rcLogin(user.id)
 */
export function useRevenueCatLogin(): UseMutationResult<CustomerInfo, Error, string> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) => loginRevenueCat(userId),
    onSuccess: (customerInfo) => {
      queryClient.setQueryData(revenueCatKeys.customerInfo(), customerInfo)
    },
    onError: (error) => {
      console.error('[RevenueCat] Login failed:', error);
    },
  })
}

/**
 * Mutation hook for logging out of RevenueCat on Supabase sign-out.
 * Clears the cached CustomerInfo so stale entitlements aren't shown.
 *
 * Usage:
 *   const { mutateAsync: rcLogout } = useRevenueCatLogout()
 *   await rcLogout()
 */
export function useRevenueCatLogout(): UseMutationResult<CustomerInfo | null, Error, void> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => logoutRevenueCatIfIdentified(),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: revenueCatKeys.customerInfo() })
    },
    onError: (error) => {
      console.error('[RevenueCat] Logout failed:', error);
    },
  })
}
