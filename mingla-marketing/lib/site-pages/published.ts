// #4636 — the published block lists, staff-made pages and site-wide nav and
// footer, for server components. One anonymous call PER PAGE
// (site_public_page), cached under that page's own tag `site-page:<key>`
// (revalidated by POST /api/blog/revalidate {"tag":"pages","page":"<key>"});
// the staff-made page index (small) under the shared 'site-pages' tag. A
// failed call returns null: the page renders as coded and a console.error
// with no payload is logged (I-4452-NO-BLOCKS-NO-CHANGE).
//
// Inside /site-preview/<token> the previewed page (and a nav / footer draft)
// comes from the token for that request (previewSlot), never from the cache.
import { unstable_cache } from 'next/cache'
import { previewSlot, rpc, siteBlocksOn } from './content'
import { customIndexFrom, type CustomIndexEntry } from './custom'
import { SITE_SETTINGS_KEY } from './converted'
import { usableSettings, type FooterSettings, type NavSettings } from './settings'
import { SITE_PAGES_CACHE_TAG, sitePageTag } from './tags'
import type { MediaMap } from '@/lib/site-blocks/media'

export interface PublishedPage {
  pageKey: string
  /** The block list, or null when the page has none published (render as coded). */
  sections: unknown[] | null
  media: MediaMap
  /** True inside a preview (the draft of this page). */
  preview: boolean
}

const PAGE_KEY = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

function shapedPage(key: string, raw: unknown, preview: boolean): PublishedPage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const sections = Array.isArray(r.sections) ? (r.sections as unknown[]) : null
  const media = r.media && typeof r.media === 'object' ? (r.media as MediaMap) : {}
  return { pageKey: key, sections, media, preview }
}

/** One page's live content, cached per page under its own tag. */
function livePage(key: string): Promise<unknown> {
  return unstable_cache(async () => rpc('site_public_page', { p_page_key: key }), ['site-public-page-v1', key], {
    tags: [sitePageTag(key)],
    revalidate: false,
  })()
}

const liveCustomIndex = unstable_cache(async (): Promise<unknown> => rpc('site_public_custom_index', {}), ['site-public-custom-index-v1'], {
  tags: [SITE_PAGES_CACHE_TAG],
  revalidate: false,
})

/** A page's published (or, in its preview, draft) block list; null when it has none. */
export async function publishedPage(key: string): Promise<PublishedPage | null> {
  if (!PAGE_KEY.test(key)) return null
  const preview = previewSlot().value
  if (preview) {
    if (preview.pageKey !== key) return null
    const content = preview.pages[key] as unknown as Record<string, unknown> | undefined
    return shapedPage(key, { sections: content?.sections, media: preview.media }, true)
  }
  if (!siteBlocksOn()) return null
  try {
    return shapedPage(key, await livePage(key), false)
  } catch {
    console.error('[site-pages] page content unavailable; the page renders as coded')
    return null
  }
}

/** The live and redirected staff-made pages ([] when unavailable). */
export async function customIndex(): Promise<CustomIndexEntry[]> {
  if (!siteBlocksOn()) return []
  try {
    return customIndexFrom(await liveCustomIndex())
  } catch {
    console.error('[site-pages] staff page index unavailable')
    return []
  }
}

/** The published nav and footer (a draft inside its preview); nulls mean "as coded". */
export async function siteChrome(): Promise<{ nav: NavSettings | null; footer: FooterSettings | null }> {
  const report = (m: string) => console.error(`[site-pages] ${m}`)
  const preview = previewSlot().value
  if (preview?.pageKey === SITE_SETTINGS_KEY) return usableSettings(preview.pages[SITE_SETTINGS_KEY], report)
  if (!siteBlocksOn()) return { nav: null, footer: null }
  try {
    const raw = (await livePage(SITE_SETTINGS_KEY)) as Record<string, unknown> | null
    return usableSettings(raw ? { nav: raw.nav ?? undefined, footer: raw.footer ?? undefined } : null, report)
  } catch {
    console.error('[site-pages] nav and footer unavailable; the coded ones stay')
    return { nav: null, footer: null }
  }
}
