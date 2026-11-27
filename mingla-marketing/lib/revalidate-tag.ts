// #4137 / #4318 — which marketing cache tag a POST /api/blog/revalidate drops.
// Pure, so the rule is unit tested (lib/__tests__/issue-4318-links.implementor.test.mjs).
//
//   no body, or {"tag":"blog"} → 'blog'   (the #4137 admin-blog call, unchanged)
//   {"tag":"links"}            → 'links'  (#4318 admin strips)
//   anything else              → null     (400, nothing is revalidated)

//   {"tag":"pages"}            → 'pages'  (#4452 Website pages and forms: the site-pages tag)

export type RevalidateTarget = 'blog' | 'links' | 'pages'

export function revalidateTargetFor(rawBody: string): RevalidateTarget | null {
  const raw = rawBody.trim()
  if (raw === '') return 'blog'
  try {
    const body: unknown = JSON.parse(raw)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const tag = (body as Record<string, unknown>).tag
    if (tag === undefined) return 'blog'
    return tag === 'blog' || tag === 'links' || tag === 'pages' ? tag : null
  } catch {
    return null
  }
}

//   {"tag":"pages","page":"<key>"} → 'pages' plus that page's own tag
//                                    (#4636: `site-page:<key>`, its published block
//                                    list or the 'site-settings' nav and footer).
//                                    A malformed key is refused (null → 400).

const PAGE_KEY = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/

/**
 * #4636: the page key a pages revalidate names: undefined when the body names
 * none (the whole-site #4452 call, unchanged), null when it is not a page key.
 */
export function revalidatePageKeyFor(rawBody: string): string | null | undefined {
  try {
    const body: unknown = JSON.parse(rawBody.trim() || '{}')
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
    const page = (body as Record<string, unknown>).page
    if (page === undefined) return undefined
    return typeof page === 'string' && PAGE_KEY.test(page) ? page : null
  } catch {
    return undefined
  }
}
