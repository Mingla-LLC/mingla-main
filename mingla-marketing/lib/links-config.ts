// ORCH-1317 [Mingla link-in-bio page] — the DATA MODEL for usemingla.com/links.
//
// This module is intentionally React-FREE so it can be imported by the guard
// test (lib/links-config.tester.test.ts) with a plain tsc+node run, and so new
// tabs / socials are added here as data — no component rewrite (extensibility, §5).
//
// STORE-LINK CONTRACT (§2 / HARD GUARD): this file NEVER hardcodes a store URL.
// The Explorer CTA points at the device-smart `/download` route, which resolves the
// correct store per device from lib/store-links.ts (the single source of truth). No
// store URL is ever pasted here — the smart CTA is the only download path. Keep it so.

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
}

// The `/download` route is the device-smart redirect (iPhone→App Store,
// Android→Play, desktop→QR). It is NOT a store URL, so referencing it here does
// not violate the no-hardcoded-store-URL guard.
export const LINKS_DOWNLOAD_PATH = '/download'

// Business landing lives on this same apex site (app/business) — derive the path
// from the shared surface constant instead of hardcoding, so usemingla.com/links
// and usemingla.com/business can never drift.
export const LINKS_BUSINESS_PATH = BUSINESS_PATH

// ORCH-1326 — the business DEVICE-SMART route (iPhone → business App Store,
// else → business.usemingla.com). Mirrors LINKS_DOWNLOAD_PATH for the business
// surface; it is NOT a store URL, so it does not violate the SSOT guard.
export const LINKS_BUSINESS_DOWNLOAD_PATH = '/business/download'

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
  },
  {
    id: 'business',
    label: 'For Business',
    eyebrow: 'For venues & organizers',
    heading: 'Run a venue, event, or trip?',
    body: 'Put your experiences in front of people planning their next outing. Now on iPhone — or get started on the web.',
    cta: {
      label: 'Get the app',
      href: LINKS_BUSINESS_DOWNLOAD_PATH,
      destination: 'business_download',
      intent: 'glass',
    },
  },
]

export interface LinksSocial {
  /** Human network name (also the analytics `network` value). */
  label: string
  /** Universal @usemingla profile — shown on the Explorer tab (and the default). */
  href: string
  /**
   * @minglabusiness profile — swapped in on the Business tab. Mingla runs a
   * dedicated business account on Instagram, X, TikTok, Facebook & Threads
   * (DEC-198 / [[reference-mingla-social-links]]). LinkedIn & YouTube stay
   * universal on BOTH tabs, so they intentionally omit this.
   */
  businessHref?: string
}

// The FULL Mingla social presence, in the order they sit in the bottom row. Add
// or reorder here (data-driven) — links-experience renders each with its icon and
// resolves the per-tab URL via `socialHref` below.
export const LINKS_SOCIALS: readonly LinksSocial[] = [
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/usemingla',
    businessHref: 'https://www.instagram.com/minglabusiness',
  },
  { label: 'X', href: 'https://x.com/usemingla', businessHref: 'https://x.com/MinglaBusiness' },
  {
    label: 'TikTok',
    href: 'https://www.tiktok.com/@usemingla',
    businessHref: 'https://www.tiktok.com/@minglabusiness',
  },
  // YouTube & LinkedIn stay universal on both tabs (no business variant).
  { label: 'YouTube', href: 'https://www.youtube.com/@usemingla' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/company/usemingla' },
  {
    label: 'Facebook',
    href: 'https://www.facebook.com/usemingla',
    businessHref: 'https://www.facebook.com/minglabusiness',
  },
  {
    label: 'Threads',
    href: 'https://www.threads.com/@usemingla',
    businessHref: 'https://www.threads.com/@minglabusiness',
  },
]

// Resolve the profile URL for the active tab: the Business tab uses the
// @minglabusiness handle where one exists; everything else (Explorer, and the
// universal-only YouTube/LinkedIn) falls back to the @usemingla `href`.
export function socialHref(social: LinksSocial, tab: LinksTabId): string {
  return tab === 'business' && social.businessHref ? social.businessHref : social.href
}
