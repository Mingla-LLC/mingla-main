'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { AppQrPanel } from '@/components/marketing/app-qr-panel'
import { AppleMark, PlayMark } from '@/components/ui/store-marks'
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import { resolveExplorerAppTarget } from '@/lib/explorer-app-target'
import { resolveBusinessAppTarget } from '@/lib/business-app-target'
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
  /** Optional label used only on iOS and Android. `label` still overrides both. */
  phoneLabel?: ReactNode
  /** Optional label used only on desktop/unknown. `label` still overrides both. */
  desktopLabel?: ReactNode
  className?: string
  withArrow?: boolean
  /** Lets a containing modal pause its own focus trap while the QR dialog owns focus. */
  onDialogOpenChange?: (open: boolean) => void
}

const SIZES = {
  md: 'h-[2.625rem] px-5 text-[0.9375rem]',
  lg: 'h-[3.25rem] px-7 text-base',
} as const

/**
 * AIgocy's buttons are MOULDED: an inset top highlight, an inset dark bottom
 * band, and a six-step drop stack. The first pass gave them one flat shadow and
 * that is a large part of why the page read as bland. The recipes now live in
 * `cutout.css` as `.cut-btn-{dark,light,brand}`.
 */
function classesFor(variant: NonNullable<DeviceCtaProps['variant']>, size: 'md' | 'lg') {
  const tint =
    variant === 'primary' ? 'cut-btn-brand' : variant === 'ink' ? 'cut-btn-dark' : 'cut-btn-light'
  return cn('cut-btn font-display tracking-[-0.005em] focus-ring', tint, SIZES[size])
}

export function DeviceCta({
  surface,
  location,
  variant = 'primary',
  size = 'lg',
  label,
  phoneLabel,
  desktopLabel,
  className,
  withArrow = false,
  onDialogOpenChange,
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
  /**
   * One label, one icon set, everywhere. The DESTINATION stays device-aware —
   * that is the whole point of this component — but the button no longer
   * changes its words depending on what you are holding. Showing all three
   * platforms tells every visitor that Mingla exists on all of them, which
   * "Download the app" and "Use on web" each only said half of.
   */
  /**
   * ONE mark, not three. The stacked discs made the pill ~190px, which a
   * 390px header cannot hold alongside the wordmark and the menu button.
   *
   * On a phone the store mark is INFORMATION -- Apple or Play tells you the tap
   * ends in your store. On desktop there is no store, and the monitor glyph
   * that used to sit here just said "this is a screen", which the reader is
   * already looking at. An arrow says the one useful thing instead: this goes
   * somewhere. Slightly smaller than before, so the pill reads as type with a
   * mark rather than type with a badge.
   */
  /**
   * On a phone the label stays "Use Mingla" and the store mark says where the
   * tap lands. On desktop there is no app to install, so the label says so
   * outright rather than promising one.
   *
   * Like the mark, this resolves AFTER mount -- the server has no navigator,
   * so it renders the web wording and a phone corrects it on hydration. That
   * is the same trade the icon already makes, and the alternative is a
   * hydration mismatch.
   */
  const onPhone = platform === 'ios' || platform === 'android'
  // Only HOST has a web app. Explorer on desktop opens a QR panel to install
  // the app, so "Use Mingla Web" there promised something that does not exist.
  const defaultText = !onPhone && surface === 'host' ? 'Use Mingla Web' : 'Use Mingla'
  const text = label ?? (onPhone ? phoneLabel : desktopLabel) ?? defaultText

  const marks =
    platform === 'ios' ? (
      <AppleMark className="h-4 w-4 shrink-0" />
    ) : platform === 'android' ? (
      <PlayMark className="h-4 w-4 shrink-0" />
    ) : (
      <ArrowRight className="h-[15px] w-[15px] shrink-0" strokeWidth={2.5} aria-hidden="true" />
    )

  if (surface === 'host') {
    const attribution = siteAttribution(campaignFor('host', location))
    const target = resolveBusinessAppTarget(platform, attribution)
    const canInstall = target.canInstall && target.installHref !== null
    const href = canInstall ? (target.installHref as string) : target.webHref
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
        {marks}
        {arrow}
      </a>
    )
  }

  const target = resolveExplorerAppTarget(
    platform,
    siteAttribution(campaignFor('explorer', location)),
  )
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
        {marks}
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
          onDialogOpenChange?.(true)
        }}
        className={classes}
      >
        {text}
        {marks}
        {arrow}
      </button>
      <AppQrPanel
        open={qrOpen}
        onClose={() => {
          setQrOpen(false)
          onDialogOpenChange?.(false)
        }}
      />
    </>
  )
}
