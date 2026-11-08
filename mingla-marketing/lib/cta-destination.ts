// #4137 — the ONE device seam for every marketing call to action.
//
// I-4137-MARKETING-CTA-DEVICE-SEAM: every marketing CTA resolves through this
// module. Phones (iPhone, iPad incl. iPadOS-as-Mac, Android, in-app browsers)
// get the attributed OneLink for their app. Computers get the computer
// destination: /download for Explorer (DeviceCta then opens the QR panel on top
// of it once hydrated, Seth OQ-1), host.usemingla.com (or one of its create
// pages) for Host. The server HTML carries the computer href in `href` plus the
// phone href in `data-cta-phone-href`, so the pre-hydration boot script
// (`lib/device-platform-boot.ts`) can correct a tap before React loads.
// Enforced by scripts/issue-4137-cta-destinations.implementor.happy.test.mjs.
//
// This module composes the existing resolvers. It adds NO URL constants: the
// OneLinks and the host web origin stay owned by lib/store-links.ts.
//
// React-free and pure, so Server Components, Client Components and the plain
// node test can all import it.

import type { Platform } from './device-platform'
import { buildOneLinkHref, type OneLinkAttribution } from './links-src'
import { resolveExplorerAppTarget } from './explorer-app-target'
import { resolveBusinessAppTarget } from './business-app-target'
import {
  APP_STORE_URL,
  BUSINESS_APP_STORE_URL,
  BUSINESS_PLAY_STORE_URL,
  BUSINESS_WEB_URL,
  EXPLORER_ONELINK_URL,
  PLAY_STORE_URL,
} from './store-links'
import { DOWNLOAD_PATH } from './app-link-landing'

export type CtaSurface = 'explorer' | 'host'

export interface CtaDestinations {
  /** Desktop, bots, no-JavaScript, and every render before hydration. */
  computerHref: string
  /** ios | android — the attributed OneLink for the surface's app. */
  phoneHref: string
}

export interface CtaDestinationOptions {
  /**
   * A deeper host web page for computers (the city "Host an event" create
   * links). Must live on the host web app; anything else throws, so a typo can
   * never send a host off-site.
   */
  hostComputerHref?: string
}

function assertHostWebHref(href: string): string {
  if (href === BUSINESS_WEB_URL || href.startsWith(`${BUSINESS_WEB_URL}/`)) return href
  throw new Error(`#4137 cta-destination: hostComputerHref must be on ${BUSINESS_WEB_URL}, got ${href}`)
}

export function resolveCtaDestinations(
  surface: CtaSurface,
  attribution: OneLinkAttribution,
  opts: CtaDestinationOptions = {},
): CtaDestinations {
  if (surface === 'explorer') {
    // The OneLink is device-independent (AppsFlyer does the per-store 301), so
    // resolving against 'ios' yields the one phone href for both phones.
    const phoneHref = resolveExplorerAppTarget('ios', attribution).installHref
    if (phoneHref === null) throw new Error('#4137 cta-destination: explorer phone href missing')
    return { computerHref: DOWNLOAD_PATH, phoneHref }
  }
  const phoneHref = resolveBusinessAppTarget('ios', attribution).installHref
  if (phoneHref === null) throw new Error('#4137 cta-destination: host phone href missing')
  const computerHref =
    opts.hostComputerHref !== undefined
      ? assertHostWebHref(opts.hostComputerHref)
      : resolveBusinessAppTarget('other', attribution).webHref
  return { computerHref, phoneHref }
}

/** ios | android → the phone href; everything else → the computer href. */
export function ctaHrefFor(platform: Platform, destinations: CtaDestinations): string {
  return platform === 'ios' || platform === 'android' ? destinations.phoneHref : destinations.computerHref
}

/** True when an href leaves usemingla.com (OneLink or host web). */
export function isExternalCtaHref(href: string): boolean {
  return /^https?:\/\//.test(href)
}

// ---------------------------------------------------------------------------
// #4318 — /links listings and desktop store buttons. Same seam, same rule: the
// URL constants stay in lib/store-links.ts and every surface asks here.

export type ListingKind = 'event' | 'trip' | 'experience'

// The public listing pages on the host web app (mingla-business routes
// app/{e,t,exp}/[brandSlug]/[slug].tsx, verified app links on both phones).
const LISTING_WEB_PATH: Readonly<Record<ListingKind, string>> = {
  event: 'e',
  trip: 't',
  experience: 'exp',
}

/**
 * One listing. Phones get the Explorer OneLink deep-linked to that listing
 * (store first if the app is missing, then the listing). Computers, bots and
 * no-JavaScript get the listing's public page on the host web app; /links
 * itself opens its detail sheet on a computer once hydrated.
 */
export function resolveListingDestinations(
  kind: ListingKind,
  brandSlug: string,
  itemSlug: string,
  attribution: OneLinkAttribution,
): CtaDestinations {
  if (brandSlug.trim() === '' || itemSlug.trim() === '') {
    throw new Error('#4318 cta-destination: a listing needs both its brand slug and its own slug')
  }
  const phoneHref = buildOneLinkHref(EXPLORER_ONELINK_URL, attribution, {
    value: kind,
    sub1: brandSlug,
    sub2: itemSlug,
  })
  const computerHref = `${BUSINESS_WEB_URL}/${LISTING_WEB_PATH[kind]}/${encodeURIComponent(brandSlug)}/${encodeURIComponent(itemSlug)}`
  return { computerHref, phoneHref }
}

export interface StoreListingHrefs {
  appStore: string
  googlePlay: string
}

/** The two store listings of one app, for the computer sheets' store buttons. */
export function resolveStoreListingHrefs(surface: CtaSurface): StoreListingHrefs {
  return surface === 'explorer'
    ? { appStore: APP_STORE_URL, googlePlay: PLAY_STORE_URL }
    : { appStore: BUSINESS_APP_STORE_URL, googlePlay: BUSINESS_PLAY_STORE_URL }
}
