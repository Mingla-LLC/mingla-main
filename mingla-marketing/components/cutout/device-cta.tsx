'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { AppQrPanel } from '@/components/marketing/app-qr-panel'
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import { resolveExplorerAppTarget } from '@/lib/explorer-app-target'
import {
  BUSINESS_APP_CHOICE_COPY,
  resolveBusinessAppTarget,
} from '@/lib/business-app-target'
import { siteAttribution, type SiteCampaign } from '@/lib/links-src'

// ---------------------------------------------------------------
// #2902 — the ONE call-to-action component for the Cutout system.
//
// Seth's requirement: every page carries a device-aware action in the header
// AND in every section. That is a lot of call sites, and a copy-pasted ternary
// across all of them is precisely the bug class `business-app-target.ts` and
// `explorer-app-target.ts` were written to kill — when the business Play
// listing went live, four hand-rolled surfaces silently stayed stale and every
// Android owner was denied the app.
//
// So this component owns the decision once and every section consumes it:
//
//   explorer + phone    → the attributed Explorer OneLink (301s to the store)
//   explorer + desktop  → opens the QR panel (nothing to install here)
//   host     + phone    → the attributed Business OneLink
//   host     + desktop  → the business web app
//
// SSR SAFETY. `detectClientPlatform()` reads `navigator`, which does not exist
// on the server. Seeding 'other' means the server HTML and the first client
// render agree (the web-only treatment — always safe), then an effect swaps in
// the real platform. Rendering the platform directly would hydration-mismatch.
//
// The click handlers deliberately RE-READ the platform rather than trust state,
// so a tap can never resolve against a stale value.
// ---------------------------------------------------------------

export type CutoutSurface = 'explorer' | 'host'

/**
 * `siteAttribution` takes a CLOSED union (`explorer_nav | business_nav |
 * business_hero | business_download`), not free text — adding a campaign is a
 * deliberate edit to `lib/links-src.ts`, which is why this file cannot invent
 * one per section. The compiler caught exactly that.
 *
 * So the two labels are separated on purpose:
 *   - the OneLink CAMPAIGN is coarse and governed (install attribution);
 *   - the PostHog `location` is fine-grained and free (which section was
 *     clicked).
 *
 * If production later wants per-section install attribution, widening
 * `SiteCampaign` is a one-line decision in that file — not something a landing
 * page should do implicitly.
 */
function campaignFor(surface: CutoutSurface, location: string): SiteCampaign {
  if (surface === 'explorer') return 'explorer_nav'
  return location === 'nav' || location === 'nav_mobile' ? 'business_nav' : 'business_hero'
}

interface DeviceCtaProps {
  surface: CutoutSurface
  /** Analytics label for WHERE this instance sits (`hero`, `nav`, `faq`, …). */
  location: string
  variant?: 'primary' | 'ink' | 'quiet'
  size?: 'md' | 'lg'
  /** Override the label. Defaults are surface-correct and device-correct. */
  label?: ReactNode
  className?: string
  withArrow?: boolean
}

const SIZES = {
  md: 'h-11 px-5 text-[0.9375rem]',
  lg: 'h-14 px-7 text-base',
} as const

function classesFor(variant: NonNullable<DeviceCtaProps['variant']>, size: 'md' | 'lg') {
  const base = cn(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-full',
    'font-display font-medium tracking-[-0.005em] whitespace-nowrap',
    'transition-all duration-200 ease-out-quart cursor-pointer focus-ring',
    SIZES[size],
  )
  switch (variant) {
    case 'primary':
      return cn(
        base,
        'bg-[var(--cut-accent)] text-white shadow-[var(--cut-shadow-tile)]',
        'hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100',
      )
    case 'ink':
      return cn(
        base,
        'bg-[var(--cut-ink)] text-[var(--cut-shell)] shadow-[var(--cut-shadow-tile)]',
        'hover:-translate-y-0.5 hover:brightness-125 active:translate-y-0',
      )
    case 'quiet':
      return cn(
        base,
        'bg-[var(--cut-card)] text-[var(--cut-ink)] shadow-[var(--cut-shadow-card)]',
        'hover:-translate-y-0.5 hover:shadow-[var(--cut-shadow-card-hover)] active:translate-y-0',
      )
  }
}

export function DeviceCta({
  surface,
  location,
  variant = 'primary',
  size = 'lg',
  label,
  className,
  withArrow = true,
}: DeviceCtaProps) {
  const [platform, setPlatform] = useState<Platform>('other')
  const [qrOpen, setQrOpen] = useState(false)

  useEffect(() => {
    setPlatform(detectClientPlatform())
  }, [])

  const classes = cn(classesFor(variant, size), className)
  const arrow = withArrow ? (
    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
  ) : null

  if (surface === 'host') {
    const attribution = siteAttribution(campaignFor('host', location))
    const target = resolveBusinessAppTarget(platform, attribution)
    const canInstall = target.canInstall && target.installHref !== null
    const href = canInstall ? (target.installHref as string) : target.webHref
    const text =
      label ?? (canInstall ? BUSINESS_APP_CHOICE_COPY.download : BUSINESS_APP_CHOICE_COPY.useWeb)

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener"
        onClick={() => {
          const live = detectClientPlatform()
          const t = resolveBusinessAppTarget(live, attribution)
          captureMarketing('get_the_app_clicked', {
            action: t.canInstall ? 'download' : 'use_web',
            platform: live,
            store: t.canInstall ? t.installStore : 'business_web',
            surface: 'organiser',
            location,
          })
        }}
        className={classes}
      >
        {text}
        {arrow}
      </a>
    )
  }

  const target = resolveExplorerAppTarget(
    platform,
    siteAttribution(campaignFor('explorer', location)),
  )
  const text = label ?? 'Get the app'

  // Phone: a real anchor to the attributed OneLink. It navigates, so it must be
  // an <a> — and it carries no aria-haspopup, because it can never open a dialog.
  if (target.canInstall && target.installHref !== null) {
    return (
      <a
        href={target.installHref}
        target="_blank"
        rel="noopener"
        onClick={() => {
          const live = detectClientPlatform()
          captureMarketing('get_the_app_clicked', {
            platform: live,
            store: live === 'ios' ? 'app_store' : 'play',
            location,
          })
        }}
        className={classes}
      >
        {text}
        {arrow}
      </a>
    )
  }

  // Desktop: there is nothing to install, so this opens the QR panel. It
  // navigates nowhere, which is why it is correctly a <button> and keeps its
  // dialog semantics.
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={qrOpen}
        onClick={() => {
          captureMarketing('get_the_app_clicked', {
            platform: 'other',
            store: 'qr_panel',
            location,
          })
          setQrOpen(true)
        }}
        className={classes}
      >
        {text}
        {arrow}
      </button>
      <AppQrPanel open={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  )
}
