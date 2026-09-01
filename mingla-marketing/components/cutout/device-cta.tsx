'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { AppQrPanel } from '@/components/marketing/app-qr-panel'
import { AppleMark, PlayMark, WebMark } from '@/components/ui/store-marks'
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
  className?: string
  withArrow?: boolean
}

const SIZES = {
  md: 'h-12 px-6 text-[0.9375rem]',
  lg: 'h-[3.75rem] px-8 text-base',
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
  className,
  withArrow = false,
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
   * Label first, then the platforms as an overlapping stack of discs — the
   * avatar-group idiom. Three loose glyphs ahead of the words read as clutter;
   * one clustered object reads as a single "available on" mark, and it lets
   * the words lead, which is what a button should do.
   *
   * The discs are a TRANSLUCENT tint of the button's own surface with the glyph
   * in currentColor. The first attempt filled each disc with currentColor and
   * punched the glyph out; at 26px, three overlapping, that rendered as a heavy
   * black blob on the light variants.
   */
  const disc =
    variant === 'quiet' ? 'rgba(20,18,15,0.10)' : 'rgba(255,255,255,0.26)'
  const ringTint =
    variant === 'primary' ? '#e5701c' : variant === 'ink' ? '#211f1c' : '#f6f3ee'
  const marks = (
    <span className="ml-1.5 flex shrink-0 items-center" aria-hidden="true">
      {[AppleMark, PlayMark, WebMark].map((Mark, i) => (
        <span
          key={i}
          className="flex items-center justify-center rounded-full"
          style={{
            width: 24,
            height: 24,
            marginLeft: i === 0 ? 0 : -8,
            zIndex: 3 - i,
            background: disc,
            boxShadow: `0 0 0 1.5px ${ringTint}`,
          }}
        >
          <Mark className={i === 0 ? 'h-[12px] w-[12px]' : 'h-[11px] w-[11px]'} />
        </span>
      ))}
    </span>
  )

  if (surface === 'host') {
    const attribution = siteAttribution(campaignFor('host', location))
    const target = resolveBusinessAppTarget(platform, attribution)
    const canInstall = target.canInstall && target.installHref !== null
    const href = canInstall ? (target.installHref as string) : target.webHref
    const text = label ?? 'Use Mingla'

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
  const text = label ?? 'Use Mingla'

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
        }}
        className={classes}
      >
        {text}
        {marks}
        {arrow}
      </button>
      <AppQrPanel open={qrOpen} onClose={() => setQrOpen(false)} />
    </>
  )
}
