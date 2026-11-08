'use client'
import type { MouseEvent, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { DeviceLink } from '@/components/cutout/device-link'
import { captureSearchMeasurement, isMarketingAdsOn } from '@/components/marketing/posthog-provider'
import { readLandingCampaign } from '@/lib/landing-campaign'
import { pageMeasurement } from '@/lib/page-measurement'
import { siteAttribution } from '@/lib/links-src'
import { resolveAppHandoff, withLandingCampaignHref } from '@/lib/app-handoff'
import { useState } from 'react'
import { HandoffSheet, isPlainClick, useHandoffSheet } from './handoff-sheet'

// #4339 §3 — the Explorer hand-off: every "Use Mingla", "Get Mingla" and
// "Save" button on a redesigned page.
//
//   phone    → straight to the Explorer store through the attributed Explorer
//              OneLink (AppsFlyer does the per-store redirect).
//   computer → the "Mingla lives on your phone" sheet: a photo, the QR and
//              both Explorer store buttons. There is no web option.
//
// One <a> (DeviceLink, #4137). Its server href is the computer destination
// (/download, which shows the same QR without JavaScript) and its phone href
// rides in `data-cta-phone-href` for a tap before hydration. Every URL comes
// from lib/app-handoff.ts → lib/cta-destination.ts; nothing here holds one.
//
// The OneLink campaign is the governed `explorer_nav` (the only Explorer site
// campaign in lib/links-src.ts, owned by #4318); the PostHog `location` says
// which button it was.

const ATTRIBUTION = siteAttribution('explorer_nav')

interface ExplorerHandoffButtonProps {
  /** Analytics label for where the button sits (`hero`, `nav`, `band`). */
  location: string
  className: string
  withArrow?: boolean
  /** The label. Defaults to "Use Mingla". */
  children?: ReactNode
}

export function ExplorerHandoffButton({ location, className, withArrow = false, children }: ExplorerHandoffButtonProps) {
  const sheet = useHandoffSheet()

  const [opened, setOpened] = useState<{ icp?: ReturnType<typeof pageMeasurement>['icp']; sourceKind: string }>({ sourceKind: 'product' })

  const onActivate = (platform: Parameters<typeof resolveAppHandoff>[1], event: MouseEvent<HTMLAnchorElement>) => {
    const handoff = resolveAppHandoff('explorer', platform, ATTRIBUTION)
    // #4339 round B: the click is attributed to the page it happened on
    // (page family, and the ICP on a Host landing page).
    const page = pageMeasurement(window.location.pathname)
    const sourceKind = location === 'hero' ? 'hero' : location === 'nav' ? 'navigation' : 'product'
    captureSearchMeasurement('explorer_install_click', {
      audience: 'explorer',
      page_family: page.page_family,
      ...(page.icp ? { icp: page.icp } : {}),
      source_kind: sourceKind,
      destination_kind: handoff.action === 'navigate' ? 'explorer_onelink' : 'explorer_download',
      action_state: 'opened',
    })
    if (handoff.action === 'navigate') {
      // The landing campaign rides into the OneLink (af_sub1–3) while ads are on.
      event.currentTarget.setAttribute('href', withLandingCampaignHref(handoff.href, readLandingCampaign(isMarketingAdsOn())))
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
        surface="explorer"
        attribution={ATTRIBUTION}
        className={className}
        sameTab
        {...sheet.trigger}
        onActivate={onActivate}
      >
        {children ?? 'Use Mingla'}
        {withArrow ? <ArrowRight aria-hidden="true" /> : null}
      </DeviceLink>
      {sheet.open ? (
        <HandoffSheet sheet="explore" attribution={ATTRIBUTION} onClose={sheet.close} icp={opened.icp} sourceKind={opened.sourceKind} />
      ) : null}
    </>
  )
}
