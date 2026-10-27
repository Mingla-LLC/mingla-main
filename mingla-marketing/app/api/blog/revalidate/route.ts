import { timingSafeEqual } from 'node:crypto'
import { revalidateTag } from 'next/cache'
import { BLOG_CACHE_TAG } from '@/lib/blog/data'

// #4137 — the admin-blog edge function calls this after publish, unpublish
// and feature changes so /blog shows the change on the next request. Without
// the shared secret it does nothing (401).
const NO_STORE = { 'Cache-Control': 'no-store' }

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
  revalidateTag(BLOG_CACHE_TAG)
  return Response.json({ revalidated: true }, { headers: NO_STORE })
}
