import type { Metadata } from 'next'
import { BlogIndexView, blogPageFrom } from '@/components/blog/blog-index'
import { getBlogIndex } from '@/lib/blog/data'
import { canonicalUrlForSearchRoute } from '@/lib/search/route-registry'
import { searchRouteMetadata } from '@/lib/search/metadata'

// #4137 — usemingla.com/blog. Rendered per request from the 5-minute Data
// Cache (tag `blog`, dropped on publish), as the careers pages are.
export const dynamic = 'force-dynamic'

type Props = { readonly searchParams: Promise<{ page?: string | string[] }> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const metadata = searchRouteMetadata('/blog')
  // `?page=N` is the no-JavaScript "Load more": crawlable, never indexed.
  if (blogPageFrom((await searchParams).page) > 1) {
    return { ...metadata, robots: { index: false, follow: true }, alternates: { canonical: canonicalUrlForSearchRoute('/blog') } }
  }
  return metadata
}

export default async function BlogPage({ searchParams }: Props) {
  const page = blogPageFrom((await searchParams).page)
  const index = await getBlogIndex(null, page)
  return (
    <BlogIndexView
      index={index}
      page={page}
      category={null}
      heading="Go out better."
      lede="Going out, date ideas and the playbook for hosts, from the people building Mingla."
      basePath="/blog"
    />
  )
}
