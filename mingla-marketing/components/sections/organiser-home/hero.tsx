'use client'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { buttonClasses } from '@/components/ui/button'
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

// ORCH-1381 — the hero presents an explicit inline CHOICE (Download the app / Use
// on web) instead of guessing a single destination, replacing the retired business
// beta lead modal. #2083 replaces the old illustrative booking wall with an
// operator-approved, silent environmental loop. It remains decorative: all copy,
// controls, destinations and analytics stay in semantic HTML above it.

const EASE = [0.16, 1, 0.3, 1] as const

const HERO_MEDIA = {
  video: '/marketing/host-hero/world-hosts-create-preview.mp4',
  poster: '/marketing/host-hero/world-hosts-create-poster.jpg',
}

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
    <section
      data-host-hero="world-hosts-create"
      className="relative flex min-h-[100svh] overflow-hidden bg-parchment px-6 pb-24 pt-32 md:px-10 md:pb-32 md:pt-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]"
    >
      <video
        aria-hidden="true"
        tabIndex={-1}
        autoPlay={!reduced}
        muted
        loop
        playsInline
        preload="metadata"
        poster={HERO_MEDIA.poster}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom"
      >
        <source src={HERO_MEDIA.video} type="video/mp4" />
      </video>

      {/* The video carries atmosphere, never contrast responsibility. The fixed
          parchment veil keeps live copy readable through every generated frame. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(250,248,244,0.34) 0%, rgba(250,248,244,0.16) 48%, rgba(250,248,244,0.02) 78%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-b from-transparent to-parchment/70"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl justify-center">
        <div className="flex max-w-4xl flex-col items-center text-center">
            <motion.p
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: reduced ? 0 : 0.04, ease: EASE }}
              className="text-xs font-bold uppercase tracking-[0.22em] text-warm-ink"
            >
              Mingla Host
            </motion.p>
            <motion.h1
              initial={reduced ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.72, delay: reduced ? 0 : 0.1, ease: EASE }}
              className="mt-5 max-w-[15ch] font-display text-[clamp(2.75rem,7vw,5.75rem)] leading-[1.02] tracking-[-0.035em] text-ink"
            >
              Your place deserves to be found.
            </motion.h1>

            <motion.p
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.35, ease: EASE }}
              className="mt-6 max-w-2xl text-base font-semibold leading-relaxed text-ink/68 sm:text-lg md:text-xl"
            >
              Create what makes your place, event, trip or experience worth showing
              up for. Mingla helps the right people discover it, book it and arrive.
            </motion.p>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.5, ease: EASE }}
              className="mt-8"
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
                  className={buttonClasses({ variant: 'secondary', size: 'lg' })}
                >
                  {BUSINESS_APP_CHOICE_COPY.useWeb}
                </a>
              </div>
              <p className="mx-auto mt-4 max-w-xl rounded-2xl bg-parchment/65 px-4 py-2 text-sm leading-relaxed text-ink/70 backdrop-blur-sm">
                {target.canInstall
                  ? BUSINESS_APP_CHOICE_COPY.moreNote
                  : BUSINESS_APP_CHOICE_COPY.desktopNote}
              </p>
            </motion.div>
        </div>
      </div>
    </section>
  )
}
