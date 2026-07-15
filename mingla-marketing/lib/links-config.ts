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
    // ORCH-1381 — the trailing "Now on iPhone — or get started on the web." was
    // FALSE once the business Play listing went live (2026-07-15, COMMS-0101), and
    // the platform story now lives in the CTA choice + its note below. Trimming it
    // here also buys the vertical room that note needs (§1 no-scroll contract).
    body: 'Put your experiences in front of people planning their next outing.',
    cta: {
      label: 'Get the app',
      href: LINKS_BUSINESS_DOWNLOAD_PATH,
      destination: 'business_download',
      intent: 'glass',
    },
  },
]

// ORCH-1382 [links-src-tracking-getapp-stack] — the socials taxonomy is now an
// EXPLICIT, type-enforced discriminator instead of modelling-by-omission.
//
// THE DEFECT THIS KILLS. The old model was `businessHref?: string`, where the
// ABSENCE of the field carried all the meaning: "no businessHref" meant "universal —
// same URL on both tabs" (YouTube, LinkedIn). That worked only by accident, and
// adding Snapchat is what breaks it. Snapchat is EXPLORER-ONLY (there is no business
// Snapchat account). Added under the old model it would have no businessHref — making
// it byte-identical in the data to YouTube/LinkedIn, and therefore rendered on BOTH
// tabs with the consumer handle. But YouTube/LinkedIn are DELIBERATELY neutral
// ("investor and education — neither explorer nor business"), while Snapchat is
// explorer-only. TWO OPPOSITE INTENTS, ONE INDISTINGUISHABLE REPRESENTATION. The bug
// would ship silently and look like data entry.
//
// WHY A DISCRIMINATED UNION AND NOT `scope` + optional `businessHref`. The union makes
// a `per_surface` social WITHOUT a businessHref a COMPILE ERROR, and makes reading
// `businessHref` off a `neutral` one a COMPILE ERROR. The invariant stops depending on
// anyone remembering it.
export type LinksSocialScope = 'per_surface' | 'neutral' | 'explorer_only'

export type LinksSocial =
  /**
   * A dedicated @minglabusiness account EXISTS — the URL swaps per tab.
   * `businessHref` is REQUIRED: omitting it is a compile error, not a silent
   * fallback to the consumer handle.
   */
  | { scope: 'per_surface'; label: string; href: string; businessHref: string }
  /**
   * Neither explorer nor business — shown on BOTH tabs with ONE URL.
   * Seth's ruling: "YouTube and LinkedIn are not explorers nor business, they're
   * neutral, used for investor and education."
   */
  | { scope: 'neutral'; label: string; href: string }
  /**
   * Explorer tab ONLY — there is no business account on this network, so the
   * Business tab must render NOTHING rather than link to the consumer handle.
   */
  | { scope: 'explorer_only'; label: string; href: string }

// The FULL Mingla social presence, in the order they sit in the bottom row. Add
// or reorder here (data-driven) — links-experience renders each with its icon and
// resolves the per-tab URL via `socialHref` below.
export const LINKS_SOCIALS: readonly LinksSocial[] = [
  {
    scope: 'per_surface',
    label: 'Instagram',
    href: 'https://www.instagram.com/usemingla',
    businessHref: 'https://www.instagram.com/minglabusiness',
  },
  {
    scope: 'per_surface',
    label: 'X',
    href: 'https://x.com/usemingla',
    businessHref: 'https://x.com/MinglaBusiness',
  },
  {
    scope: 'per_surface',
    label: 'TikTok',
    href: 'https://www.tiktok.com/@usemingla',
    businessHref: 'https://www.tiktok.com/@minglabusiness',
  },
  // NEUTRAL — investor & education. Same URL on both tabs, deliberately (Seth's
  // ruling). This is NOT the same thing as explorer_only, which is why the scope
  // is explicit now.
  { scope: 'neutral', label: 'YouTube', href: 'https://www.youtube.com/@usemingla' },
  { scope: 'neutral', label: 'LinkedIn', href: 'https://www.linkedin.com/company/usemingla' },
  {
    scope: 'per_surface',
    label: 'Facebook',
    href: 'https://www.facebook.com/usemingla',
    businessHref: 'https://www.facebook.com/minglabusiness',
  },
  {
    scope: 'per_surface',
    label: 'Threads',
    href: 'https://www.threads.com/@usemingla',
    businessHref: 'https://www.threads.com/@minglabusiness',
  },
  // ORCH-1382 (D) — EXPLORER ONLY. There is NO business Snapchat account, so the
  // Business tab renders no Snapchat icon at all. Linking the consumer handle from
  // the business tab IS the defect. Placed last so the business row simply ends one
  // icon earlier and the existing order stays stable.
  { scope: 'explorer_only', label: 'Snapchat', href: 'https://www.snapchat.com/add/usemingla' },
]

/**
 * Resolve the profile URL for the active tab. Only a `per_surface` social has a
 * business variant — the union makes reading `businessHref` off any other scope a
 * compile error, so this can no longer silently fall through.
 */
export function socialHref(social: LinksSocial, tab: LinksTabId): string {
  return tab === 'business' && social.scope === 'per_surface' ? social.businessHref : social.href
}

/**
 * The socials to RENDER for a tab.
 *
 * The Business tab filters out `explorer_only` members. This is the whole point of
 * the scope discriminator: under the old optional-field model, Snapchat and YouTube
 * were indistinguishable, so Snapchat would have rendered on the business tab
 * pointing at the consumer handle — a silent, plausible-looking defect.
 *
 * Explorer: 8 socials. Business: 7.
 */
export function socialsForTab(tab: LinksTabId): readonly LinksSocial[] {
  if (tab === 'business') {
    return LINKS_SOCIALS.filter((s) => s.scope !== 'explorer_only')
  }
  return LINKS_SOCIALS
}
