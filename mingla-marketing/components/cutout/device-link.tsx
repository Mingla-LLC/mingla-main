'use client'
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import {
  ctaHrefFor,
  isExternalCtaHref,
  resolveCtaDestinations,
  type CtaSurface,
} from '@/lib/cta-destination'
import type { OneLinkAttribution } from '@/lib/links-src'

// ---------------------------------------------------------------
// #4137 — the headless link every marketing CTA renders.
//
// It is always exactly one <a>:
//   - `href` is the COMPUTER destination in the server HTML and the first
//     client render (identical, so no hydration mismatch), then the
//     device-correct one after mount, so long-press menus show the right URL.
//   - `data-cta-phone-href` carries the phone destination, which the inline
//     boot script (lib/device-platform-boot.ts) applies to a tap made before
//     React hydrates.
//
// Styling, words and analytics belong to the caller. `onActivate` hands the
// caller the platform re-read at click time (never stale state), plus the
// event, so a caller can take over the click (DeviceCta opens the Explorer QR
// panel on a computer, Seth OQ-1).
// ---------------------------------------------------------------

export interface DeviceLinkProps {
  surface: CtaSurface
  attribution: OneLinkAttribution
  /** A host.usemingla.com page for computers (validated in the seam). */
  hostComputerHref?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
  /**
   * Keep the navigation in the same tab even when the destination is external.
   * Defaults to a new tab for external destinations, matching DeviceCta.
   */
  sameTab?: boolean
  onActivate?: (platform: Platform, event: MouseEvent<HTMLAnchorElement>) => void
  'aria-haspopup'?: 'dialog'
  'aria-expanded'?: boolean
}

export function DeviceLink({
  surface,
  attribution,
  hostComputerHref,
  className,
  style,
  children,
  sameTab = false,
  onActivate,
  ...aria
}: DeviceLinkProps) {
  const [platform, setPlatform] = useState<Platform | null>(null)

  useEffect(() => {
    const live = detectClientPlatform()
    setPlatform(live)
    // Belt and braces: if the boot script never ran, label CSS keys off this.
    const root = document.documentElement
    if (!root.hasAttribute('data-platform')) root.setAttribute('data-platform', live)
  }, [])

  const destinations = resolveCtaDestinations(surface, attribution, { hostComputerHref })
  const href = platform === null ? destinations.computerHref : ctaHrefFor(platform, destinations)
  const newTab = !sameTab && isExternalCtaHref(href)

  return (
    <a
      href={href}
      data-cta-phone-href={destinations.phoneHref}
      data-cta-surface={surface}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noopener' : undefined}
      className={className}
      style={style}
      onClick={(event) => onActivate?.(detectClientPlatform(), event)}
      {...aria}
    >
      {children}
    </a>
  )
}
