import React, { useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import RevenueCatUI from 'react-native-purchases-ui'
import type { CustomerInfo, PurchasesStoreTransaction } from 'react-native-purchases'
import { useQueryClient } from '@tanstack/react-query'
import { revenueCatKeys } from '../hooks/useRevenueCat'
import { subscriptionKeys } from '../hooks/useSubscription'
import { syncSubscriptionFromRC, presentCustomerCenter } from '../services/revenueCatService'
import { colors } from '../constants/colors'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PaywallScreenProps {
  userId: string
  onClose: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full-screen paywall powered by the RevenueCat Paywalls SDK.
 *
 * The paywall layout, copy, and product display are configured in the
 * RevenueCat dashboard — no code changes needed when you update them there.
 *
 * Lifecycle:
 *   - Purchase completed → sync to Supabase → invalidate caches → call onClose
 *   - Restore completed  → sync to Supabase → invalidate caches → call onClose
 *   - Dismissed          → call onClose
 */
export default function PaywallScreen({ userId, onClose }: PaywallScreenProps) {
  const queryClient = useQueryClient()

  // Called by RC Paywall UI after a successful purchase
  const handlePurchaseCompleted = useCallback(
    async ({
      customerInfo,
    }: {
      customerInfo: CustomerInfo
      storeTransaction: PurchasesStoreTransaction
    }) => {
      // Sync RC state to Supabase (best-effort, non-blocking)
      await syncSubscriptionFromRC(userId, customerInfo)

      // Push fresh CustomerInfo into React Query cache immediately
      queryClient.setQueryData(revenueCatKeys.customerInfo(), customerInfo)

      // Invalidate Supabase subscription so the unified tier hook re-reads the DB
      queryClient.invalidateQueries({
        queryKey: subscriptionKeys.detail(userId),
      })

      onClose()
    },
    [userId, queryClient, onClose],
  )

  // Called by RC Paywall UI after a successful restore
  const handleRestoreCompleted = useCallback(
    async ({ customerInfo }: { customerInfo: CustomerInfo }) => {
      await syncSubscriptionFromRC(userId, customerInfo)
      queryClient.setQueryData(revenueCatKeys.customerInfo(), customerInfo)
      queryClient.invalidateQueries({
        queryKey: subscriptionKeys.detail(userId),
      })

      Alert.alert(
        'Purchases restored',
        'Your previous purchases have been restored successfully.',
        [{ text: 'Done', onPress: onClose }],
      )
    },
    [userId, queryClient, onClose],
  )

  // Called when the user cancels or dismisses the paywall
  const handleDismiss = useCallback(() => {
    onClose()
  }, [onClose])

  // Called on any purchase error
  const handlePurchaseError = useCallback(
    ({ error }: { error: Error }) => {
      // userCancelled errors are silent — the user chose to back out
      if ((error as unknown as { userCancelled?: boolean }).userCancelled) return
      Alert.alert('Purchase failed', error.message)
    },
    [],
  )

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Close button overlaid at the top-right */}
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onClose}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityLabel="Close paywall"
        accessibilityRole="button"
      >
        <Ionicons name="close" size={24} color={colors.gray700} />
      </TouchableOpacity>

      {/* RevenueCat Paywall UI — fills remaining space */}
      <RevenueCatUI.Paywall
        style={styles.paywall}
        onPurchaseCompleted={handlePurchaseCompleted}
        onRestoreCompleted={handleRestoreCompleted}
        onDismiss={handleDismiss}
        onPurchaseError={handlePurchaseError}
      />

      {/* Manage subscription link (Customer Center) */}
      <TouchableOpacity
        style={styles.manageButton}
        onPress={presentCustomerCenter}
        accessibilityRole="button"
      >
        <Text style={styles.manageText}>Manage subscription</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paywall: {
    flex: 1,
  },
  manageButton: {
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray200,
  },
  manageText: {
    fontSize: 13,
    color: colors.gray500,
    textDecorationLine: 'underline',
  },
})
