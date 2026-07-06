// ORCH-1317 [Mingla link-in-bio page] — the DATA MODEL for usemingla.com/links.
//
// This module is intentionally React-FREE so it can be imported by the guard
// test (lib/links-config.tester.test.ts) with a plain tsc+node run, and so new
// tabs / socials are added here as data — no component rewrite (extensibility, §5).
//
// STORE-LINK CONTRACT (§2 / HARD GUARD): this file NEVER hardcodes a store URL.
// The Explorer CTA points at the device-smart `/download` route, and the explicit
// store choices are rendered by <AppStoreBadges/>, which pulls the LIVE listings
// from lib/store-links.ts (the single source of truth). Keep it that way.

import { BUSINESS_PATH } from './subdomain'

export type LinksTabId = 'explorer' | 'business'

export interface LinksTabCta {
  /** Button label. */
  label: string
  /** Where the CTA points. Internal routes (leading "/") use next/link. */
  href: string
  /** Analytics destination name fired in `links_page_cta_clicked`. */
  destination: string
  /** Visual weight — 'primary' is the warm fill, 'glass' is the frosted pill. */
  intent: 'primary' | 'glass'
}

export interface LinksTab {
  id: LinksTabId
  /** Short label shown in the tablist. */
  label: string
  /** Small kicker above the heading. */
  eyebrow: string
  /** Panel heading. */
  heading: string
  /** One-line supporting copy. */
  body: string
  cta: LinksTabCta
  /** Explorer renders the explicit App Store / Play badges below its CTA. */
  showStoreBadges: boolean
}

// The `/download` route is the device-smart redirect (iPhone→App Store,
// Android→Play, desktop→QR). It is NOT a store URL, so referencing it here does
// not violate the no-hardcoded-store-URL guard.
export const LINKS_DOWNLOAD_PATH = '/download'

// Business landing lives on this same apex site (app/business) — derive the path
// from the shared surface constant instead of hardcoding, so usemingla.com/links
// and usemingla.com/business can never drift.
export const LINKS_BUSINESS_PATH = BUSINESS_PATH

export const LINKS_TABS: readonly LinksTab[] = [
  {
    id: 'explorer',
    label: 'Explorer',
    eyebrow: 'The app',
    heading: 'Plans worth leaving the house for.',
    body: 'Date nights, things to do, and the gems your city is hiding — all in one app.',
    cta: {
      label: 'Get Mingla',
      href: LINKS_DOWNLOAD_PATH,
      destination: 'download',
      intent: 'primary',
    },
    showStoreBadges: true,
  },
  {
    id: 'business',
    label: 'For Business',
    eyebrow: 'For venues & organizers',
    heading: 'Run a venue, event, or trip?',
    body: 'Put your experiences in front of people planning their next outing. Get started on the web.',
    cta: {
      label: 'Get started on the web',
      href: LINKS_BUSINESS_PATH,
      destination: 'business',
      intent: 'glass',
    },
    showStoreBadges: false,
  },
]

export interface LinksSocial {
  /** Human network name (also the analytics `network` value). */
  label: string
  /** Public profile URL — opened in a new tab with rel="noopener". */
  href: string
}

export const LINKS_SOCIALS: readonly LinksSocial[] = [
  { label: 'Instagram', href: 'https://www.instagram.com/usemingla' },
  { label: 'X', href: 'https://x.com/usemingla' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/usemingla' },
  { label: 'Facebook', href: 'https://www.facebook.com/usemingla' },
]
