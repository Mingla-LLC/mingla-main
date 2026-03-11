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
  hasProEntitlement,
  loginRevenueCat,
  logoutRevenueCat,
} from '../services/revenueCatService'

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────

export const revenueCatKeys = {
  all: ['revenuecat'] as const,
  customerInfo: () => [...revenueCatKeys.all, 'customer-info'] as const,
  offerings: () => [...revenueCatKeys.all, 'offerings'] as const,
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer info
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches and caches the RevenueCat CustomerInfo object.
 * Re-fetches whenever the query is invalidated (e.g. after a purchase or restore).
 *
 * staleTime: 5 minutes — CustomerInfo is kept current via the real-time listener
 * below, so aggressive re-fetching is unnecessary.
 */
export function useCustomerInfo(): UseQueryResult<CustomerInfo, Error> {
  return useQuery({
    queryKey: revenueCatKeys.customerInfo(),
    queryFn: getCustomerInfo,
    staleTime: 5 * 60 * 1000,
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

/**
 * Returns true if the current user has an active "Mingla Pro" entitlement.
 * Returns false while loading or if the SDK hasn't fetched yet.
 */
export function useIsProEntitled(): boolean {
  const { data: customerInfo } = useCustomerInfo()
  if (!customerInfo) return false
  return hasProEntitlement(customerInfo)
}

// ─────────────────────────────────────────────────────────────────────────────
// Offerings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the current RevenueCat offering (the set of packages available for
 * purchase as configured in the RC dashboard).
 *
 * staleTime: 30 minutes — offerings change rarely; no need to refetch often.
 */
export function useOfferings(): UseQueryResult<PurchasesOffering | null, Error> {
  return useQuery({
    queryKey: revenueCatKeys.offerings(),
    queryFn: getCurrentOffering,
    staleTime: 30 * 60 * 1000,
    retry: 2,
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
    onSuccess: ({ customerInfo }) => {
      // Push the fresh CustomerInfo into the cache immediately
      queryClient.setQueryData(revenueCatKeys.customerInfo(), customerInfo)
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
  })
}
