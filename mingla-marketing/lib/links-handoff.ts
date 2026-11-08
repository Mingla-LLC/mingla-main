// #4318 — where every tap on usemingla.com/links goes, per device.
//
// Pure, so the page and the node test share one decision table:
//
//   target            phone (iPhone, iPad, Android)          computer
//   Explore banner    Explorer OneLink (store)               "Mingla lives on your phone" sheet
//   Host banner       Host OneLink (store)                   "Host in <city>" sheet
//   listing strip     Explorer OneLink deep-linked to it     detail sheet (QR + stores)
//   strip, web        the web address (new tab)              detail sheet ("Open …")
//   strip, blog       /blog/<slug>                           detail sheet ("Read on the Mingla blog")
//   strip, explorer   Explorer OneLink (store)               detail sheet (QR + stores)
//   strip, host       Host OneLink (store)                   detail sheet (QR + stores + host web)
//   place (quiet week) Explorer OneLink (store)              detail sheet (QR + stores)
//
// Places use the plain Explorer OneLink: the app's OneLink resolver only
// deep-links a place through an opaque 36-hex share id
// (app-mobile/src/services/oneLinkResolver.ts:115-120, isOpaqueShareId at :78),
// never a Google place id, so there is no place deep link to send.
//
// Every OneLink and host-web URL comes from the #4137 device seam
// (lib/cta-destination.ts), with the sanitised `?src=` as the bio pid. Nothing
// here holds a store or host URL (I-4137-MARKETING-CTA-DEVICE-SEAM).

import type { Platform } from './device-platform'
import { linksAttribution } from './links-src'
import {
  resolveCtaDestinations,
  resolveListingDestinations,
  type CtaDestinations,
} from './cta-destination'
import { pinWebHref, type LinksListing, type LinksPin, type LinksPlace } from './links-week'

export type LinksTarget =
  | { type: 'banner'; app: 'explorer' | 'host' }
  | { type: 'listing'; listing: LinksListing }
  | { type: 'pin'; pin: LinksPin }
  | { type: 'place'; place: LinksPlace }

export type LinksSheetKind = 'explore' | 'host' | 'item'

export type LinksHandoff =
  | { action: 'navigate'; href: string; newTab: boolean }
  | { action: 'sheet'; sheet: LinksSheetKind }

export function isPhone(platform: Platform): boolean {
  return platform === 'ios' || platform === 'android'
}

/** The blog post a blog strip opens (same origin, every device). */
export function pinBlogHref(pin: LinksPin): string {
  return `/blog/${encodeURIComponent(pin.blogSlug ?? '')}`
}

/**
 * The two hrefs of a target's anchor: `computerHref` is the server-rendered
 * href (and the no-JavaScript destination), `phoneHref` is what a phone opens
 * (the boot script swaps it in for a tap made before hydration).
 */
export function linksTargetHrefs(target: LinksTarget, src: string): CtaDestinations {
  const explorer = () => resolveCtaDestinations('explorer', linksAttribution(src, 'explorer_bio'))
  const host = () => resolveCtaDestinations('host', linksAttribution(src, 'business_bio'))
  switch (target.type) {
    case 'banner':
      return target.app === 'explorer' ? explorer() : host()
    case 'place':
      return explorer()
    case 'listing': {
      const { kind, brandSlug, itemSlug } = target.listing
      return resolveListingDestinations(kind, brandSlug, itemSlug, linksAttribution(src, 'explorer_bio'))
    }
    case 'pin': {
      const { pin } = target
      switch (pin.opens) {
        case 'web': {
          const href = pinWebHref(pin.url)
          if (href === null) throw new Error(`#4318 links: strip ${pin.id} has no valid web address`)
          return { computerHref: href, phoneHref: href }
        }
        case 'blog': {
          const href = pinBlogHref(pin)
          return { computerHref: href, phoneHref: href }
        }
        case 'explorer':
          return explorer()
        case 'host':
          return host()
        default: {
          const never: never = pin.opens
          throw new Error(`#4318 links: unknown strip target ${String(never)}`)
        }
      }
    }
    default: {
      const never: never = target
      throw new Error(`#4318 links: unknown target ${JSON.stringify(never)}`)
    }
  }
}

/** What a tap on a target does on this device. */
export function resolveLinksHandoff(target: LinksTarget, platform: Platform, src: string): LinksHandoff {
  if (!isPhone(platform)) {
    if (target.type === 'banner') return { action: 'sheet', sheet: target.app === 'explorer' ? 'explore' : 'host' }
    return { action: 'sheet', sheet: 'item' }
  }
  const { phoneHref } = linksTargetHrefs(target, src)
  const newTab = target.type === 'pin' && target.pin.opens === 'web'
  return { action: 'navigate', href: phoneHref, newTab }
}

/** The app a target installs, for the QR code and store buttons; null for web and blog strips. */
export function targetApp(target: LinksTarget): 'explorer' | 'host' | null {
  if (target.type === 'banner') return target.app
  if (target.type === 'listing' || target.type === 'place') return 'explorer'
  if (target.pin.opens === 'explorer') return 'explorer'
  if (target.pin.opens === 'host') return 'host'
  return null
}
