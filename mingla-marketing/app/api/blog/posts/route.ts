import { blogCategoryForSlug } from '@/content/blog/categories'
import { blogCardCoverSrc, getBlogIndexSlice } from '@/lib/blog/data'

// #4137 — "Load more stories": the next 12 public cards, covers resolved.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const rawCategory = params.get('category')
  const category = rawCategory ? blogCategoryForSlug(rawCategory) : null
  if (rawCategory && !category) return Response.json({ error: 'blog_category_unknown' }, { status: 400 })
  const offset = Number(params.get('offset') ?? '0')
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) return Response.json({ error: 'offset_invalid' }, { status: 400 })
  try {
    // On /blog the featured story is never in this list (the RPC excludes it).
    const index = await getBlogIndexSlice(category?.slug ?? null, offset)
    return Response.json(
      { items: index.posts.map((card) => ({ card, coverSrc: blogCardCoverSrc(card) })), total: index.total },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' } },
    )
  } catch (error) {
    console.error('[blog] load more failed', error)
    return Response.json({ error: 'blog_unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
