'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button'
import { HeroBookingWall } from '@/components/sections/organiser-home/hero-booking-wall'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import {
  BUSINESS_APP_CHOICE_COPY,
  resolveBusinessAppTarget,
} from '@/lib/business-app-target'
import { siteAttribution } from '@/lib/links-src'
import { captureMarketing } from '@/components/marketing/posthog-provider'

// ORCH-1399 — both hero actions are now real <a href> anchors pointing at the
// ATTRIBUTED business OneLink / web app. The OneLink 301s straight to market:// (or
// the App Store), so the store app opens with no intermediate web page and the
// install carries pid/c. openExternal is no longer needed in this file — every
// destination here is a genuine navigation, which is what an anchor is for.
// ⚠ rel="noopener" on an <a> is REQUIRED and is NOT the ORCH-1381 window.open
// pathology (that ban is scoped to .open( FEATURE STRINGS). Never strip it.

// ORCH-1010 — business hero. A full-bleed 3D "booking wall" (vibe-themed booking
// moments across restaurants, cafés, events, clubs, tables) runs as the section
// background behind a dark overlay; the headline sits on top in high contrast.
// Shows the DEMAND Mingla creates. Illustrative content, no stock art.
//
// ORCH-1381 — the hero presents an explicit inline CHOICE (Download the app / Use
// on web) instead of guessing a single destination, replacing the retired business
// beta lead modal. The hero stays video-free (I-1045-HERO-NO-VIDEO): no demo-clip
// tile / video modal is added.

const EASE = [0.16, 1, 0.3, 1] as const

export function OrganiserHero() {
  const reduced = useMinglaReducedMotion()

  // ORCH-1381 — the RENDERED choice is device-aware, so it must resolve AFTER
  // mount: detectClientPlatform() reads navigator, absent during SSR. Seeding
  // 'other' keeps the server HTML and the first client render in agreement
  // (web-action-only — the safe treatment); the effect then swaps in the real
  // platform. The click HANDLERS re-read the platform fresh, so a tap never
  // resolves a stale value.
  const [platform, setPlatform] = useState<Platform>('other')
  useEffect(() => {
    setPlatform(detectClientPlatform())
  }, [])
  // ORCH-1399 — resolves an ATTRIBUTED OneLink href rendered into a real <a href>,
  // so it must resolve during render rather than on the tap.
  const target = resolveBusinessAppTarget(platform, siteAttribution('business_hero'))

  // ORCH-1399 — these now TRACK only; the anchors below perform the navigation.
  // The `action` prop is REQUIRED: without it an Android owner who CHOOSES web is
  // indistinguishable from ORCH-1324's forced-web, and the fix is unmeasurable.
  const handleDownloadTheBusinessApp = (): void => {
    const live = resolveBusinessAppTarget(detectClientPlatform(), siteAttribution('business_hero'))
    if (live.installHref === null) return
    captureMarketing('get_the_app_clicked', {
      action: 'download',
      platform: detectClientPlatform(),
      store: live.installStore,
      surface: 'organiser',
      location: 'hero',
    })
  }

  const handleUseBusinessOnWeb = (): void => {
    captureMarketing('get_the_app_clicked', {
      action: 'use_web',
      platform: detectClientPlatform(),
      store: 'business_web',
      surface: 'organiser',
      location: 'hero',
    })
  }

  return (
    <>
      <section className="relative flex min-h-[88vh] items-center overflow-hidden px-6 pb-24 pt-32 md:px-10 md:pb-32 md:pt-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
        {/* Background — the 3D booking wall (full-bleed cover). */}
        <HeroBookingWall />

        {/* Overlay — darkens the wall so the headline reads in high contrast.
            Warm-tinted near the foot, deepest behind the text column. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(8,9,12,0.78) 0%, rgba(8,9,12,0.66) 42%, rgba(20,10,4,0.82) 100%)',
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-full md:w-3/4"
          style={{ background: 'linear-gradient(90deg, rgba(8,9,12,0.72) 0%, transparent 100%)' }}
        />
        {/* Dissolve — the dark wall melts into the next section's canvas so the
            scroll from hero → "What is Mingla?" is one continuous pull, not a cut. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%]"
          style={{ background: 'linear-gradient(to bottom, transparent 0%, var(--color-smoke) 92%)' }}
        />

        {/* Foreground — headline + single CTA, centered, high contrast on the wall. */}
        <div className="relative mx-auto w-full max-w-6xl">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <motion.h1
              initial={reduced ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.72, delay: reduced ? 0 : 0.1, ease: EASE }}
              className="font-display text-5xl leading-[1.05] tracking-[-0.02em] text-white md:text-7xl"
              style={{ textShadow: '0 2px 24px rgba(0,0,0,0.4)' }}
            >
              You deserve <br className="hidden sm:block" />to be <span className="text-warm">found.</span>
            </motion.h1>

            <motion.p
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.35, ease: EASE }}
              className="mt-8 max-w-xl text-xl font-bold leading-snug text-white md:text-2xl"
              style={{ textShadow: '0 2px 20px rgba(0,0,0,0.45)' }}
            >
              Your business has a vibe, your community is looking for it. Mingla
              helps them find you.
            </motion.p>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.5, ease: EASE }}
              className="mt-10"
            >
              {/* ORCH-1381 — two actions in a row (stacking to a column below sm).
                  Desktop/other can install nothing → ONLY the web action renders. */}
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                {target.canInstall && target.installHref !== null ? (
                  <a
                    href={target.installHref}
                    target="_blank"
                    rel="noopener"
                    onClick={handleDownloadTheBusinessApp}
                    className={buttonClasses({ variant: 'primary', size: 'lg' })}
                  >
                    {BUSINESS_APP_CHOICE_COPY.download}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                ) : null}
                <a
                  href={target.webHref}
                  target="_blank"
                  rel="noopener"
                  onClick={handleUseBusinessOnWeb}
                  className={buttonClasses({ variant: 'glass', size: 'lg' })}
                >
                  {BUSINESS_APP_CHOICE_COPY.useWeb}
                </a>
              </div>
              <p className="mt-4 text-sm text-white/70">
                {target.canInstall
                  ? BUSINESS_APP_CHOICE_COPY.moreNote
                  : BUSINESS_APP_CHOICE_COPY.desktopNote}
              </p>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  )
}
