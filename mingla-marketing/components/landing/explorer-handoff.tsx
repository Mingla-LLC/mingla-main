'use client'
import type { MouseEvent, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { DeviceLink } from '@/components/cutout/device-link'
import { captureSearchMeasurement } from '@/components/marketing/posthog-provider'
import { siteAttribution } from '@/lib/links-src'
import { resolveAppHandoff } from '@/lib/app-handoff'
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

  const onActivate = (platform: Parameters<typeof resolveAppHandoff>[1], event: MouseEvent<HTMLAnchorElement>) => {
    const handoff = resolveAppHandoff('explorer', platform, ATTRIBUTION)
    captureSearchMeasurement('explorer_install_click', {
      audience: 'explorer',
      page_family: 'explorer_pillar',
      source_kind: location === 'hero' ? 'hero' : location === 'nav' ? 'navigation' : 'product',
      destination_kind: handoff.action === 'navigate' ? 'explorer_onelink' : 'explorer_download',
      action_state: 'opened',
    })
    if (handoff.action === 'navigate') {
      event.currentTarget.setAttribute('href', handoff.href)
      return
    }
    if (!isPlainClick(event)) return
    event.preventDefault()
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
      {sheet.open ? <HandoffSheet sheet="explore" attribution={ATTRIBUTION} onClose={sheet.close} /> : null}
    </>
  )
}
