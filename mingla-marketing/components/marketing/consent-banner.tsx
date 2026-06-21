'use client'
// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 1 (marketing web).
//
// Custom Mingla-branded cookie/consent banner (§4.E). NOT a third-party CMP and
// NOT a new design system — built from the existing marketing tokens/components
// (Button, glass-strong surface, framer-motion, reduced-motion).
//
// THE REAL GATE (I-PROPOSED-1187-CONSENT-GATE-BEFORE-COOKIES):
//   • PostHog inits with opt_out_capturing_by_default:true (posthog-provider.tsx)
//     → stores nothing / captures nothing until Accept calls opt_in.
//   • GA4 Consent Mode v2: the default-DENIED snippet runs in app/layout.tsx
//     BEFORE <GoogleAnalytics> loads. Accept here fires gtag('consent','update',
//     {all granted}); Reject leaves defaults denied (cookieless consent mode).
//
// Source of truth for re-show = localStorage key `mingla_consent_v1`:
//   absent  → show banner, analytics stay denied/opted-out
//   granted → opt in PostHog + GA consent granted, do not show
//   denied  → opt out PostHog + GA stays denied, do not show

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { posthogOptIn, posthogOptOut } from '@/components/marketing/posthog-provider'

export const CONSENT_STORAGE_KEY = 'mingla_consent_v1'
type ConsentValue = 'granted' | 'denied'

interface StoredConsent {
  value: ConsentValue
  ts: number
}

// Minimal typing for gtag without pulling a global types package.
type Gtag = (...args: unknown[]) => void
function getGtag(): Gtag | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { gtag?: Gtag }).gtag
}

function readStoredConsent(): ConsentValue | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredConsent>
    return parsed.value === 'granted' || parsed.value === 'denied'
      ? parsed.value
      : null
  } catch {
    return null
  }
}

function writeStoredConsent(value: ConsentValue): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ value, ts: Date.now() } satisfies StoredConsent),
    )
  } catch {
    // Storage may be unavailable (private mode quota) — degrade to a session
    // decision; the banner simply re-shows next load. No crash.
  }
}

/** Apply a stored/just-made decision to PostHog + GA4 Consent Mode v2. */
function applyConsent(value: ConsentValue): void {
  if (value === 'granted') {
    posthogOptIn()
    getGtag()?.('consent', 'update', {
      ad_storage: 'granted',
      analytics_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    })
  } else {
    posthogOptOut()
    // Leave GA defaults denied (cookieless consent mode). Explicit re-assert.
    getGtag()?.('consent', 'update', {
      ad_storage: 'denied',
      analytics_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
  }
}

const EASE_OUT_QUART = [0.16, 1, 0.3, 1] as const

export function ConsentBanner(): React.ReactElement | null {
  const reduced = useMinglaReducedMotion()
  // null = undecided (mount); once resolved we either show the banner or not.
  const [decision, setDecision] = useState<ConsentValue | 'pending'>('pending')

  // On mount: re-apply any prior decision; otherwise show the banner.
  useEffect(() => {
    const stored = readStoredConsent()
    if (stored) {
      applyConsent(stored)
      setDecision(stored)
    } else {
      setDecision('pending')
    }
  }, [])

  const choose = (value: ConsentValue): void => {
    writeStoredConsent(value)
    applyConsent(value)
    setDecision(value)
  }

  // Show only while a fresh visitor has not yet decided.
  const visible = decision === 'pending'

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
                <Link
                  href="/privacy-policy"
                  className="rounded-sm font-medium text-warm underline-offset-2 hover:underline focus-ring"
                >
                  Privacy policy
                </Link>
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
