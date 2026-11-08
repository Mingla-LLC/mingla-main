'use client'
import type { MouseEvent, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { DeviceLink } from '@/components/cutout/device-link'
import { captureSearchMeasurement } from '@/components/marketing/posthog-provider'
import { siteAttribution } from '@/lib/links-src'
import { resolveAppHandoff } from '@/lib/app-handoff'
import { HandoffSheet, isPlainClick, useHandoffSheet } from './handoff-sheet'

// #4339 §3 — "Use Mingla Web", the Host hand-off, on every redesigned page.
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

  const onActivate = (platform: Parameters<typeof resolveAppHandoff>[1], event: MouseEvent<HTMLAnchorElement>) => {
    const handoff = resolveAppHandoff('host', platform, ATTRIBUTION)
    captureSearchMeasurement('host_start_click', {
      audience: 'host',
      page_family: 'host_pillar',
      source_kind: location === 'hero' ? 'hero' : location === 'nav' ? 'navigation' : 'product',
      destination_kind: handoff.action === 'navigate' ? 'host_onelink' : 'host_web',
      action_state: 'opened',
    })
    if (handoff.action === 'navigate') {
      const own = resolveAppHandoff('host', platform, attribution)
      if (own.action === 'navigate') event.currentTarget.setAttribute('href', own.href)
      return
    }
    if (!isPlainClick(event)) return
    event.preventDefault()
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
            <span data-cta-when="computer">Use Mingla Web</span>
          </>
        )}
        {withArrow ? <ArrowRight aria-hidden="true" /> : null}
      </DeviceLink>
      {sheet.open ? <HandoffSheet sheet="host" attribution={attribution} onClose={sheet.close} /> : null}
    </>
  )
}
