// #4452 §2.3 / §2.10: the one cache tag for published blocks, form pages and forms.
export const SITE_PAGES_CACHE_TAG = 'site-pages'

// #4636: each page's published block list (and the 'site-settings' nav and
// footer) is cached under its own tag, so a publish refreshes that page only.
const PAGE_KEY = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

/** The cache tag of one page's published content. */
export function sitePageTag(pageKey: string): string {
  if (!PAGE_KEY.test(pageKey)) throw new Error(`#4636 not a page key: ${pageKey}`)
  return `site-page:${pageKey}`
}
