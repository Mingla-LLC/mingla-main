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
  logoutRevenueCat,
} from '../services/revenueCatService'
import { logAppsFlyerEvent } from '../services/appsFlyerService'

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
    })
    return cleanup
  }, [queryClient])
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

      // ── AppsFlyer: subscription revenue event ──
      logAppsFlyerEvent('af_subscribe', {
        af_revenue: pkg.product?.price ?? 0,
        af_currency: pkg.product?.currencyCode ?? 'USD',
        af_content_type: 'mingla_plus',
        af_content_id: pkg.identifier,
        af_quantity: 1,
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
export function useRevenueCatLogout(): UseMutationResult<CustomerInfo, Error, void> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => logoutRevenueCat(),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: revenueCatKeys.customerInfo() })
    },
    onError: (error) => {
      console.error('[RevenueCat] Logout failed:', error);
    },
  })
}
