// #4636 — the 14 pages whose sections are registry blocks (build 2 of the
// approved plan). Each renders its PUBLISHED block list when one exists and
// otherwise exactly today's coded page (I-4452-NO-BLOCKS-NO-CHANGE). The
// database keeps the same list in site_converted_page_keys() (#4636 migration);
// lib/__tests__/issue-4636-db-parity.implementor.test.mjs keeps them equal.
//
// No imports: plain node tests load this file by stripping its types.

export type ConvertedSurface = 'explorer' | 'host'
export type ConvertedNavKey = 'home' | 'host' | 'going-out'

export interface ConvertedPage {
  key: string
  path: string
  /** The nav and footer surface of the coded page. */
  surface: ConvertedSurface
  /** The nav item the coded page marks as current. */
  current?: ConvertedNavKey
  /**
   * The route's layout already renders <main id="main"> (the explorer and
   * host layouts), so the block page adds none, as the coded page does.
   */
  layoutMain: boolean
  /** The host-type pages pass their ICP slug to the landing root (analytics). */
  icp?: string
}

const ICPS = ['events', 'trips', 'experiences', 'restaurants', 'hotels', 'art', 'play'] as const

export const CONVERTED_PAGES: readonly ConvertedPage[] = [
  { key: 'home', path: '/', surface: 'explorer', current: 'home', layoutMain: true },
  { key: 'host', path: '/host', surface: 'host', current: 'host', layoutMain: true },
  { key: 'creators', path: '/creators', surface: 'explorer', layoutMain: false },
  { key: 'locals', path: '/locals', surface: 'explorer', layoutMain: false },
  { key: 'about', path: '/about', surface: 'explorer', layoutMain: false },
  { key: 'going-out', path: '/going-out', surface: 'explorer', current: 'going-out', layoutMain: false },
  { key: 'download', path: '/download', surface: 'explorer', layoutMain: false },
  ...ICPS.map((icp): ConvertedPage => ({ key: icp, path: `/host/${icp}`, surface: 'host', current: 'host', layoutMain: true, icp })),
]

export const CONVERTED_PAGE_KEYS: readonly string[] = CONVERTED_PAGES.map((p) => p.key)

export function convertedPage(key: string): ConvertedPage | null {
  return CONVERTED_PAGES.find((p) => p.key === key) ?? null
}

/** The reserved page key that carries the site-wide nav and footer. */
export const SITE_SETTINGS_KEY = 'site-settings'

/** A staff-made page's key (site_custom_pages.page_key). */
export function isCustomPageKey(key: string): boolean {
  return /^p-[0-9a-f]{12}$/.test(key)
}
