// #4339 — the site-wide app hand-off, lifted from the #4318 /links banners.
//
//   button            phone (iPhone, iPad, Android)        computer
//   Host  ("Use Mingla Web")  Host OneLink (store)        "Host on Mingla" sheet:
//                                                          Host QR + both stores,
//                                                          or continue on host web
//   Explorer ("Use Mingla")   Explorer OneLink (store)    "Mingla lives on your
//                                                          phone" sheet: QR + stores
//
// It is the same decision as `resolveLinksHandoff` for a banner target
// (lib/links-handoff.ts, #4318), without the /links page's `?src=` bio
// attribution: site pages pass their own governed `siteAttribution(...)`.
// #4318's files are read, never edited; `isPhone` is reused from there.
//
// Every OneLink, store and host-web URL comes from lib/cta-destination.ts
// (#4137, I-4137-MARKETING-CTA-DEVICE-SEAM). This module holds NO URL.
//
// React-free and pure, so Server Components, Client Components and the node
// tests share one decision table.

import type { Platform } from './device-platform'
import { siteAttribution, type OneLinkAttribution } from './links-src'
import { isPhone, pinBlogHref, type LinksTarget } from './links-handoff'
import { pinWebHref } from './links-week'
import {
  resolveCtaDestinations,
  resolveListingDestinations,
  resolveStoreListingHrefs,
  type CtaDestinations,
  type CtaSurface,
  type StoreListingHrefs,
} from './cta-destination'

export type AppHandoffSheet = 'host' | 'explore'

export type AppHandoff =
  | { action: 'navigate'; href: string }
  | { action: 'sheet'; sheet: AppHandoffSheet }

export interface AppHandoffHrefs extends CtaDestinations {
  /** The two store listings of the app, for the computer sheet's buttons. */
  stores: StoreListingHrefs
}

/** Every href a hand-off button and its computer sheet need, from the one seam. */
export function appHandoffHrefs(app: CtaSurface, attribution: OneLinkAttribution): AppHandoffHrefs {
  return { ...resolveCtaDestinations(app, attribution), stores: resolveStoreListingHrefs(app) }
}

/** What a tap on a hand-off button does on this device. */
export function resolveAppHandoff(app: CtaSurface, platform: Platform, attribution: OneLinkAttribution): AppHandoff {
  if (isPhone(platform)) return { action: 'navigate', href: resolveCtaDestinations(app, attribution).phoneHref }
  return { action: 'sheet', sheet: app === 'host' ? 'host' : 'explore' }
}

/** The host web origin as a person reads it ("host.usemingla.com"). */
export function hostWebLabel(href: string): string {
  try {
    return new URL(href).host
  } catch {
    throw new Error(`#4339 app-handoff: host web href is not a URL: ${href}`)
  }
}

/**
 * A page on the host web app for every device (#4339 phase 2b: "Set up my
 * creator profile" → host.usemingla.com/creator/setup, §8). The origin is the
 * seam's host web destination and the result passes the seam's own host-web
 * check (`hostComputerHref`), so a typo can never send a person off-site and
 * no host URL is written here.
 */
export function hostWebPageHref(path: `/${string}`, attribution: OneLinkAttribution): string {
  const origin = resolveCtaDestinations('host', attribution).computerHref.replace(/\/+$/, '')
  return resolveCtaDestinations('host', attribution, { hostComputerHref: `${origin}${path}` }).computerHref
}

// ---------------------------------------------------------------------------
// #4339 phase 4a — the city page's "This weekend" taps: admin strips, live
// listings and the quiet week's places. The SAME targets and decision as the
// #4318 /links page (`LinksTarget`, `pinWebHref`, `pinBlogHref`,
// `resolveListingDestinations`), with the site's own governed attribution
// instead of the /links bio `?src=`:
//
//   target              phone (iPhone, iPad, Android)          computer
//   listing, event      Explorer OneLink deep-linked to it      its public page on host web
//   listing, trip/exp.  Explorer OneLink deep-linked to it      detail sheet (QR + stores)
//   place               Explorer OneLink (store)                detail sheet (QR + stores)
//   strip, web          the web address (new tab)               the web address (new tab)
//   strip, blog         /blog/<slug>                            /blog/<slug>
//   strip, explorer     Explorer OneLink (store)                "Mingla lives on your phone" sheet
//   strip, host         Host OneLink (store)                    "Host on Mingla" sheet
//
// Every OneLink, store and host-web URL still comes from lib/cta-destination.ts.

/** The Explorer and Host attribution of the city page's taps (governed site campaigns). */
export const CITY_EXPLORER_ATTRIBUTION: OneLinkAttribution = siteAttribution('explorer_nav')
export const CITY_HOST_ATTRIBUTION: OneLinkAttribution = siteAttribution('business_hero')

/** The two hrefs of a city-page target's anchor (computer = server href and no-JS destination). */
export function siteTargetHrefs(target: LinksTarget): CtaDestinations {
  switch (target.type) {
    case 'banner':
      return resolveCtaDestinations(target.app, target.app === 'explorer' ? CITY_EXPLORER_ATTRIBUTION : CITY_HOST_ATTRIBUTION)
    case 'place':
      return resolveCtaDestinations('explorer', CITY_EXPLORER_ATTRIBUTION)
    case 'listing': {
      const { kind, brandSlug, itemSlug } = target.listing
      return resolveListingDestinations(kind, brandSlug, itemSlug, CITY_EXPLORER_ATTRIBUTION)
    }
    case 'pin': {
      const { pin } = target
      switch (pin.opens) {
        case 'web': {
          const href = pinWebHref(pin.url)
          if (href === null) throw new Error(`#4339 city strip ${pin.id} has no valid web address`)
          return { computerHref: href, phoneHref: href }
        }
        case 'blog': {
          const href = pinBlogHref(pin)
          return { computerHref: href, phoneHref: href }
        }
        case 'explorer':
          return resolveCtaDestinations('explorer', CITY_EXPLORER_ATTRIBUTION)
        case 'host':
          return resolveCtaDestinations('host', CITY_HOST_ATTRIBUTION)
        default: {
          const never: never = pin.opens
          throw new Error(`#4339 city strip: unknown target ${String(never)}`)
        }
      }
    }
    default: {
      const never: never = target
      throw new Error(`#4339 city target: unknown ${JSON.stringify(never)}`)
    }
  }
}

export type SiteTargetHandoff =
  | { action: 'navigate'; href: string; newTab: boolean }
  | { action: 'sheet'; sheet: AppHandoffSheet | 'item' }

/** What a tap on a city-page target does on this device. */
export function resolveSiteTargetHandoff(target: LinksTarget, platform: Platform): SiteTargetHandoff {
  const hrefs = siteTargetHrefs(target)
  if (target.type === 'pin' && (target.pin.opens === 'web' || target.pin.opens === 'blog')) {
    return { action: 'navigate', href: hrefs.computerHref, newTab: target.pin.opens === 'web' }
  }
  if (isPhone(platform)) return { action: 'navigate', href: hrefs.phoneHref, newTab: false }
  if (target.type === 'banner') return { action: 'sheet', sheet: target.app === 'host' ? 'host' : 'explore' }
  if (target.type === 'pin') return { action: 'sheet', sheet: target.pin.opens === 'host' ? 'host' : 'explore' }
  if (target.type === 'listing' && target.listing.kind === 'event') {
    return { action: 'navigate', href: hrefs.computerHref, newTab: true }
  }
  return { action: 'sheet', sheet: 'item' }
}
