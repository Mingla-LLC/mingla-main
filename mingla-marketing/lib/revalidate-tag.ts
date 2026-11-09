// #4137 / #4318 — which marketing cache tag a POST /api/blog/revalidate drops.
// Pure, so the rule is unit tested (lib/__tests__/issue-4318-links.implementor.test.mjs).
//
//   no body, or {"tag":"blog"} → 'blog'   (the #4137 admin-blog call, unchanged)
//   {"tag":"links"}            → 'links'  (#4318 admin strips)
//   anything else              → null     (400, nothing is revalidated)

export type RevalidateTarget = 'blog' | 'links'

export function revalidateTargetFor(rawBody: string): RevalidateTarget | null {
  const raw = rawBody.trim()
  if (raw === '') return 'blog'
  try {
    const body: unknown = JSON.parse(raw)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const tag = (body as Record<string, unknown>).tag
    if (tag === undefined) return 'blog'
    return tag === 'blog' || tag === 'links' ? tag : null
  } catch {
    return null
  }
}
