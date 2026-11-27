import { timingSafeEqual } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { BLOG_CACHE_TAG } from '@/lib/blog/data'
import { LINKS_CACHE_TAG } from '@/lib/links-data'
import { revalidatePageKeyFor, revalidateTargetFor } from '@/lib/revalidate-tag'
import { SITE_PAGES_CACHE_TAG, sitePageTag } from '@/lib/site-pages/tags'

// #4137 — the admin-blog edge function calls this after publish, unpublish
// and feature changes so /blog shows the change on the next request. Without
// the shared secret it does nothing (401).
//
// #4318 — the one marketing revalidate owner also drops the /links cache, so a
// saved admin strip shows at once: POST with the same secret header and the
// JSON body {"tag":"links"}. No body (or {"tag":"blog"}) keeps the blog
// behaviour byte for byte; any other tag is refused (400) before anything runs.
const NO_STORE = { 'Cache-Control': 'no-store' }
// #4452: {"tag":"pages"} drops the site-pages cache (blocks, form pages, forms).
// #4636: {"tag":"pages","page":"<key>"} also drops that page's own cache
// (`site-page:<key>`: its published block list, or the nav and footer for
// 'site-settings'); a malformed page key is refused (400) before anything runs.
const TAGS = { blog: BLOG_CACHE_TAG, links: LINKS_CACHE_TAG, pages: SITE_PAGES_CACHE_TAG } as const

function secretMatches(given: string | null): boolean {
  const expected = process.env.MARKETING_REVALIDATE_SECRET ?? ''
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('x-mingla-revalidate-secret'))) {
    return Response.json({ revalidated: false }, { status: 401, headers: NO_STORE })
  }
  const body = await request.text()
  const target = revalidateTargetFor(body)
  if (target === null) return Response.json({ revalidated: false, error: 'unknown_tag' }, { status: 400, headers: NO_STORE })
  const page = target === 'pages' ? revalidatePageKeyFor(body) : undefined
  if (page === null) return Response.json({ revalidated: false, error: 'unknown_page' }, { status: 400, headers: NO_STORE })
  const tag = TAGS[target]
  revalidateTag(tag)
  if (page) revalidateTag(sitePageTag(page))
  return Response.json(page ? { revalidated: true, tag, page } : { revalidated: true, tag }, { headers: NO_STORE })
}
