'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { captureSearchMeasurement } from '@/components/marketing/posthog-provider'
import { AppQrPanel } from '@/components/marketing/app-qr-panel'
import { AppleMark, PlayMark } from '@/components/ui/store-marks'
import { siteAttribution, type SiteCampaign } from '@/lib/links-src'
import { detectClientPlatform } from '@/lib/device-platform'
import { DeviceLink } from './device-link'

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
//   explorer + desktop  → opens the QR panel (nothing to install here). The
//                         anchor's href is /download, so no-JS visitors and a
//                         click before hydration still reach the QR page.
//                         Seth kept the pop-up on #4137 (OQ-1).
//   host     + phone    → the attributed Business OneLink
//   host     + desktop  → the business web app
//
// The destinations come from the ONE seam, lib/cta-destination.ts, rendered by
// DeviceLink (#4137, I-4137-MARKETING-CTA-DEVICE-SEAM).
//
// #4137 F-7 — WHY BOTH LABELS AND ALL THREE MARKS RENDER. The server has no
// navigator, so it used to render the computer wording and arrow, and a phone
// corrected them only after hydration: one wrong paint, and a tap in that window
// went to the computer destination. Now the markup carries the phone label AND
// the computer label (`data-cta-when`) and the Apple, Play and arrow marks
// (`data-cta-mark`), and app/globals.css shows the right ones from
// <html data-platform>, which the inline boot script in <head>
// (lib/device-platform-boot.ts) sets before first paint. That script also
// re-points a pre-hydration tap at `data-cta-phone-href`. No timing involved.
//
// The click handler re-reads the platform rather than trusting state, so a tap
// can never resolve against a stale value.
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

function sourceKindForLocation(location: string): 'navigation' | 'hero' | 'footer' | 'city_card' | 'product' {
  if (location.includes('nav') || location.includes('menu')) return 'navigation'
  if (location.includes('hero')) return 'hero'
  if (location.includes('footer') || location.includes('final')) return 'footer'
  if (location.includes('city')) return 'city_card'
  return 'product'
}

interface DeviceCtaProps {
  surface: CutoutSurface
  /** Analytics label for WHERE this instance sits (`hero`, `nav`, `faq`, …). */
  location: string
  /** `inline` (#4137): an underlined text link inside prose, no pill and no store marks. */
  variant?: 'primary' | 'ink' | 'quiet' | 'inline'
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
  /** Dismisses containing navigation only when this CTA leaves the page. */
  onExternalActivate?: () => void
  /** Optional closed destination callback for a containing consent-gated event. */
  onActivate?: (destinationType: 'explorer_download' | 'explorer_qr' | 'host_download' | 'host_web') => void
  /** City hubs emit their stricter closed analytics contract through onActivate. */
  captureDefaultAnalytics?: boolean
}

const SIZES = {
  // #4137 §4.8: 44px minimum touch target.
  md: 'h-[2.625rem] px-5 text-[0.9375rem]',
  lg: 'h-[3.25rem] px-7 text-base',
} as const

/**
 * AIgocy's buttons are MOULDED: an inset top highlight, an inset dark bottom
 * band, and a six-step drop stack. The first pass gave them one flat shadow and
 * that is a large part of why the page read as bland. The recipes now live in
 * `cutout.css` as `.cut-btn-{dark,light,brand}`.
 */
function classesFor(variant: Exclude<NonNullable<DeviceCtaProps['variant']>, 'inline'>, size: 'md' | 'lg') {
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
  onExternalActivate,
  onActivate,
  captureDefaultAnalytics = true,
}: DeviceCtaProps) {
  const [qrOpen, setQrOpen] = useState(false)
  // The QR pop-up exists only on a computer, and only once React is running.
  const [qrReady, setQrReady] = useState(false)
  useEffect(() => {
    if (surface === 'explorer' && detectClientPlatform() === 'other') setQrReady(true)
  }, [surface])

  const inline = variant === 'inline'
  const classes = inline ? cn('cut-cta-inline focus-ring', className) : cn(classesFor(variant, size), className)
  const arrow = withArrow ? (
    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
  ) : null

  // Only HOST has a web app. Explorer on desktop opens a QR panel to install
  // the app, so "Use Mingla Web" there promised something that does not exist.
  const computerText = desktopLabel ?? (surface === 'host' ? 'Use Mingla Web' : 'Use Mingla')
  const phoneText = phoneLabel ?? 'Use Mingla'
  const text =
    label ?? (
      <>
        <span data-cta-when="phone">{phoneText}</span>
        <span data-cta-when="computer">{computerText}</span>
      </>
    )

  // One mark per device, chosen by CSS: Apple or Play tells a phone the tap ends
  // in its store; a computer gets an arrow (this goes somewhere).
  const marks = (
    <>
      <span data-cta-mark="ios" aria-hidden="true"><AppleMark className="h-4 w-4 shrink-0" /></span>
      <span data-cta-mark="android" aria-hidden="true"><PlayMark className="h-4 w-4 shrink-0" /></span>
      <span data-cta-mark="other" aria-hidden="true">
        <ArrowRight className="h-[15px] w-[15px] shrink-0" strokeWidth={2.5} aria-hidden="true" />
      </span>
    </>
  )

  const attribution = siteAttribution(campaignFor(surface, location))
  const explorerOnComputer = surface === 'explorer' && qrReady

  return (
    <>
      <DeviceLink
        surface={surface}
        attribution={attribution}
        className={classes}
        aria-haspopup={explorerOnComputer ? 'dialog' : undefined}
        aria-expanded={explorerOnComputer ? qrOpen : undefined}
        onActivate={(live, event) => {
          const onPhone = live === 'ios' || live === 'android'
          if (surface === 'host') {
            onExternalActivate?.()
            onActivate?.(onPhone ? 'host_download' : 'host_web')
            if (captureDefaultAnalytics) {
              captureSearchMeasurement('host_start_click', {
                audience: 'host',
                page_family: 'host_pillar',
                source_kind: sourceKindForLocation(location),
                destination_kind: onPhone ? 'host_onelink' : 'host_web',
                action_state: 'opened',
              })
            }
            return
          }
          if (onPhone) {
            onExternalActivate?.()
            onActivate?.('explorer_download')
            if (captureDefaultAnalytics) {
              captureSearchMeasurement('explorer_install_click', {
                audience: 'explorer',
                page_family: 'explorer_pillar',
                source_kind: sourceKindForLocation(location),
                destination_kind: 'explorer_onelink',
                action_state: 'opened',
              })
            }
            return
          }
          // Explorer on a computer: nothing to install here, so the QR panel
          // opens over the page (Seth, #4137 OQ-1). Without React this anchor
          // simply follows its /download href, which shows the same QR.
          event.preventDefault()
          onActivate?.('explorer_qr')
          setQrOpen(true)
          onDialogOpenChange?.(true)
        }}
      >
        {text}
        {inline ? null : marks}
        {inline ? null : arrow}
      </DeviceLink>
      {surface === 'explorer' ? (
        <AppQrPanel
          open={qrOpen}
          onClose={() => {
            setQrOpen(false)
            onDialogOpenChange?.(false)
          }}
        />
      ) : null}
    </>
  )
}
