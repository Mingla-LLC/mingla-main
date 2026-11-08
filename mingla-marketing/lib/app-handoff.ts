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
import type { OneLinkAttribution } from './links-src'
import { isPhone } from './links-handoff'
import {
  resolveCtaDestinations,
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
