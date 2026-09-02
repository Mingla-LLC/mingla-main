'use client'
// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 1 (marketing web).
//
// Custom Mingla-branded cookie/consent banner (§4.E). NOT a third-party CMP and
// NOT a new design system — built from the existing marketing tokens/components
// (Button, glass-strong surface, framer-motion, reduced-motion).
//
// THE REAL GATE (I-PROPOSED-2771-NO-WEB-ANALYTICS-BEFORE-GRANT):
//   • Neither PostHog nor Google Analytics mounts before a valid grant.
//   • Accept persists first, then starts one shared boot. Reject only persists.
//
// Source of truth for re-show = localStorage key `mingla_consent_v1`:
//   absent  → show banner, analytics remain uninitialized
//   granted → initialize once, do not show
//   denied  → remain uninitialized, do not show

import { useEffect, useState } from 'react'
import { SITE_ORIGIN } from '@/lib/site'
import { AnimatePresence, motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { shouldRenderConsentBanner } from '@/lib/consent-banner-visibility'
import {
  captureMarketingConsentGrantOnce,
  persistMarketingConsent,
  posthogOptIn,
  readMarketingConsent,
  type MarketingConsentValue,
} from '@/components/marketing/posthog-provider'

// Storage ownership is canonical in posthog-provider.tsx. This compatibility
// export preserves the established key contract: mingla_consent_v1.
export const CONSENT_STORAGE_KEY = 'mingla_consent_v1'

const EASE_OUT_QUART = [0.16, 1, 0.3, 1] as const

export function ConsentBanner(): React.ReactElement | null {
  const reduced = useMinglaReducedMotion()
  // Issue #905 — route-aware suppression. Call unconditionally alongside the
  // other hooks (Rules of Hooks); the predicate is AND-ed into `visible` below
  // so no hook is ever conditionally skipped.
  const pathname = usePathname()
  // null = undecided (mount); once resolved we either show the banner or not.
  const [decision, setDecision] = useState<MarketingConsentValue | 'pending'>('pending')

  // On mount: re-apply any prior decision; otherwise show the banner.
  useEffect(() => {
    const stored = readMarketingConsent()
    if (stored) {
      setDecision(stored)
    } else {
      setDecision('pending')
    }
  }, [])

  const choose = (value: MarketingConsentValue): void => {
    persistMarketingConsent(value)
    setDecision(value)
    // Consent-rate measurement is grant-only and runs after the one-flight boot.
    // Reject has no analytics-side effect; deny rate remains derived downstream.
    if (value === 'granted') {
      void posthogOptIn().then(() => captureMarketingConsentGrantOnce())
    }
  }

  // Show only while a fresh visitor has not yet decided AND the route allows the
  // banner (Issue #905 — suppressed on the `/links` no-scroll viewport, where the
  // fixed banner would obstruct the CTAs/socials with no scroll escape).
  const visible = decision === 'pending' && shouldRenderConsentBanner(pathname)

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="mingla-consent"
          data-theme="light"
          role="dialog"
          aria-modal="false"
          aria-label="Cookie consent"
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: reduced ? 0 : 0.32, ease: EASE_OUT_QUART }}
          className="glass-strong fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-2xl rounded-[var(--radius-2xl)] p-5 shadow-[var(--elev-3)] ring-1 ring-[var(--glass-border)] sm:inset-x-6 sm:bottom-6 sm:p-6"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
            <div className="flex flex-col gap-1.5">
              <h2 className="font-display text-base font-semibold text-text-primary">
                We use cookies to make Mingla better
              </h2>
              <p className="text-[13px] leading-relaxed text-text-secondary">
                We&apos;d like to use analytics cookies to understand how the
                site is used so we can improve it. Nothing is set until you
                choose.{' '}
                {/* Absolute, not "/privacy-policy". This banner is mounted by
                    the ROOT layout, so it also renders on career.usemingla.com,
                    where every path is rewritten under /careers -- the relative
                    link resolved to /careers/privacy-policy and 404'd. A
                    consent banner whose privacy link is broken is worse than
                    no link, and the policy lives on the apex from any host. */}
                <a
                  href={`${SITE_ORIGIN}/privacy-policy`}
                  className="rounded-sm font-medium text-warm underline-offset-2 hover:underline focus-ring"
                >
                  Privacy policy
                </a>
                .
              </p>
            </div>
            <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => choose('denied')}
                className="min-w-[44px]"
              >
                Reject
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => choose('granted')}
                className="min-w-[44px]"
              >
                Accept all
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
