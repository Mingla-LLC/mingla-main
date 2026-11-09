'use client'
import type { MouseEvent, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { DeviceLink } from '@/components/cutout/device-link'
import { captureSearchMeasurement, isMarketingAdsOn } from '@/components/marketing/marketing-capture'
import { readLandingCampaign } from '@/lib/landing-campaign'
import { pageMeasurement } from '@/lib/page-measurement'
import { siteAttribution } from '@/lib/links-src'
import { resolveAppHandoff, withLandingCampaignHref } from '@/lib/app-handoff'
import { lazy, Suspense, useState } from 'react'
import { isPlainClick, useHandoffSheet } from './handoff-trigger'

// #4339 speed fix: the sheet opens only on a computer, after a tap, so it (and
// its QR code) loads then, not with the page (first-load JS). React.lazy, not
// next/dynamic: the sheet never renders on the server, and next/dynamic would
// add its loader runtime to every page.
const HandoffSheet = lazy(() => import('./handoff-sheet').then((module) => ({ default: module.HandoffSheet })))

// #4339 §3 — "Use Mingla Host", the Host hand-off, on every redesigned page.
// (Seth: anything that goes to Host says "Host"; "Use Mingla Web" is retired.)
//
//   phone    → straight to the Mingla Host store through the attributed Host
//              OneLink; the label reads "Get Mingla Host".
//   computer → the "Host on Mingla" sheet (handoff-sheet.tsx): the Host app QR
//              and both store buttons, or "Continue on host.usemingla.com".
//
// One <a> (DeviceLink, #4137): the server HTML carries the computer href plus
// the phone href in `data-cta-phone-href`, and app/globals.css shows the right
// label from <html data-platform> before first paint, so a phone never sees
// the computer label or reaches the computer destination. Every URL comes from
// lib/app-handoff.ts → lib/cta-destination.ts; nothing here holds one.

const ATTRIBUTION = siteAttribution('business_hero')
const NAV_ATTRIBUTION = siteAttribution('business_nav')

interface HostHandoffButtonProps {
  /** Analytics label for where the button sits (`hero`, `nav`, `features`, `band`). */
  location: string
  className: string
  withArrow?: boolean
  /** Replaces the device labels (a list row that names its own subject). */
  children?: ReactNode
}

export function HostHandoffButton({ location, className, withArrow = false, children }: HostHandoffButtonProps) {
  const sheet = useHandoffSheet()
  const attribution = location === 'nav' ? NAV_ATTRIBUTION : ATTRIBUTION

  const [opened, setOpened] = useState<{ icp?: ReturnType<typeof pageMeasurement>['icp']; sourceKind: string }>({ sourceKind: 'product' })

  const onActivate = (platform: Parameters<typeof resolveAppHandoff>[1], event: MouseEvent<HTMLAnchorElement>) => {
    const handoff = resolveAppHandoff('host', platform, ATTRIBUTION)
    // #4339 round B: the click is attributed to the page it happened on
    // (page family, and the ICP on a Host landing page).
    const page = pageMeasurement(window.location.pathname)
    const sourceKind = location === 'hero' ? 'hero' : location === 'nav' ? 'navigation' : 'product'
    captureSearchMeasurement('host_start_click', {
      audience: 'host',
      page_family: page.page_family,
      ...(page.icp ? { icp: page.icp } : {}),
      source_kind: sourceKind,
      destination_kind: handoff.action === 'navigate' ? 'host_onelink' : 'host_web',
      action_state: 'opened',
    })
    if (handoff.action === 'navigate') {
      const own = resolveAppHandoff('host', platform, attribution)
      // The landing campaign rides into the OneLink (af_sub1–3) while ads are on.
      if (own.action === 'navigate') {
        event.currentTarget.setAttribute('href', withLandingCampaignHref(own.href, readLandingCampaign(isMarketingAdsOn())))
      }
      return
    }
    if (!isPlainClick(event)) return
    event.preventDefault()
    setOpened({ icp: page.icp, sourceKind })
    sheet.show(event)
  }

  return (
    <>
      <DeviceLink
        surface="host"
        attribution={attribution}
        className={className}
        {...sheet.trigger}
        onActivate={onActivate}
      >
        {children ?? (
          <>
            <span data-cta-when="phone">Get Mingla Host</span>
            <span data-cta-when="computer">Use Mingla Host</span>
          </>
        )}
        {withArrow ? <ArrowRight aria-hidden="true" /> : null}
      </DeviceLink>
      {sheet.open ? (
        <Suspense fallback={null}>
          <HandoffSheet sheet="host" attribution={attribution} onClose={sheet.close} icp={opened.icp} sourceKind={opened.sourceKind} />
        </Suspense>
      ) : null}
    </>
  )
}
