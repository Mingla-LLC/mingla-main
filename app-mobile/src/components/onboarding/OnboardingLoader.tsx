import React, { useEffect, useState } from 'react'
import { View, ActivityIndicator, StatusBar, StyleSheet } from 'react-native'
import { useOnboardingResume } from '../../hooks/useOnboardingResume'
import OnboardingFlow from '../OnboardingFlow'
import { colors } from '../../constants/designSystem'
import { getPendingClaimIntent, type PendingClaim } from '../../services/attendanceClaimService'
import { runClaimSweep, type ClaimSweepResult } from '../../services/claimSweep'
import {
  decideOnboardingMode,
  deferredLocationSeedFromOrder,
  type OnboardingMode,
} from '../../hooks/ticketFirstLogic'
import { usePurchases } from '../../hooks/usePurchases'

interface OnboardingLoaderProps {
  userId: string
  // Uses the same ResumeProfile shape that useOnboardingResume expects.
  // Pass the full profile object — the hook only reads what it needs.
  profile: {
    id: string
    phone?: string | null
    onboarding_step?: number | null
    gender?: string | null
    birthday?: string | null
    country?: string | null
    preferred_language?: string | null
  }
  onComplete: (result?: { landing?: { route: string } }) => void
  modeOverride?: OnboardingMode | null
}

export default function OnboardingLoader({
  userId,
  profile,
  onComplete,
  modeOverride = null,
}: OnboardingLoaderProps) {
  const resumeData = useOnboardingResume(userId, profile)
  const purchases = usePurchases(userId)
  const upcomingCount = purchases.timeline.upcoming.reduce(
    (count, group) => count + group.items.length,
    0,
  )
  const deferredLocationSeed = purchases.timeline.upcoming
    .flatMap((group) => group.items)
    .filter((item) => item.kind === 'order')
    .map((item) => deferredLocationSeedFromOrder(item.raw))
    .find((seed) => seed !== null) ?? null
  const [claimDecision, setClaimDecision] = useState<{
    mode: OnboardingMode
    pendingClaim: PendingClaim | null
    result: ClaimSweepResult | null
  } | null>(null)
  const [purchaseWaitExpired, setPurchaseWaitExpired] = useState(false)

  useEffect(() => {
    setPurchaseWaitExpired(false)
    const timer = setTimeout(() => setPurchaseWaitExpired(true), 4_000)
    return () => clearTimeout(timer)
  }, [userId])

  useEffect(() => {
    if (modeOverride) {
      setClaimDecision({
        mode: modeOverride,
        pendingClaim: null,
        result: null,
      })
      return
    }
    // The purchase lookup improves the ticket-first decision, but a stalled
    // network request must never hold onboarding on a spinner indefinitely.
    if (purchases.isLoading && !purchaseWaitExpired) return
    let cancelled = false
    const timeout = new Promise<ClaimSweepResult | null>((resolve) => {
      setTimeout(() => resolve(null), 4_000)
    })
    void Promise.all([
      getPendingClaimIntent(),
      Promise.race([
        runClaimSweep(userId, 'sign_in', { showBanner: false }),
        timeout,
      ]),
    ]).then(([pendingClaim, result]) => {
      if (cancelled) return
      setClaimDecision({
        mode: decideOnboardingMode({
          pendingClaim,
          lastClaim: result,
          hasUpcomingPurchase: upcomingCount > 0,
        }),
        pendingClaim,
        result,
      })
    }).catch(() => {
      if (cancelled) return
      setClaimDecision({ mode: 'full', pendingClaim: null, result: null })
    })
    return () => { cancelled = true }
  }, [modeOverride, purchaseWaitExpired, purchases.isLoading, upcomingCount, userId])

  if (!resumeData.isReady || claimDecision === null) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    )
  }

  return (
    <OnboardingFlow
      onComplete={onComplete}
      initialStep={resumeData.initialStep}
      initialData={resumeData.initialData}
      phonePreVerified={resumeData.phonePreVerified}
      initialHasGpsPermission={resumeData.hasGpsPermission}
      resumeSubStep={resumeData.resumeSubStep}
      mode={claimDecision.mode}
      pendingClaim={claimDecision.pendingClaim}
      initialClaimResult={claimDecision.result}
      deferredLocationSeed={deferredLocationSeed}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
