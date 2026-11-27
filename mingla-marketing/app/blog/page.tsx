import type { Metadata } from 'next'
import { blogPageFrom } from '@/components/blog/blog-index'
import { BlogStoriesBlock } from '@/components/site-blocks/sections/blog-stories-block'
import { getBlogIndex } from '@/lib/blog/data'
import { canonicalUrlForSearchRoute } from '@/lib/search/route-registry'
import { searchRouteMetadata } from '@/lib/search/metadata'
import { SitePage } from '@/components/site/site-page'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// #4339 phase 2b — the redesigned index: the site nav, the canonical footer and
// the design's look (components/blog/blog-index.tsx); app/blog/layout.tsx
// renders this page without the old frame.
// #4137 — usemingla.com/blog. Rendered per request from the 5-minute Data
// Cache (tag `blog`, dropped on publish), as the careers pages are.
// #4636: the index is the registry live block `blogStories`.
export const dynamic = 'force-dynamic'

type Props = { readonly searchParams: Promise<{ page?: string | string[] }> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const metadata = searchRouteMetadata('/blog')
  // `?page=N` is the no-JavaScript "Load more": crawlable, never indexed.
  if (blogPageFrom((await searchParams).page) > 1) {
    return {
      ...metadata,
      robots: { index: false, follow: true },
      alternates: { canonical: canonicalUrlForSearchRoute('/blog') },
    }
  }
  return metadata
}

export default async function BlogPage({ searchParams }: Props) {
  const page = blogPageFrom((await searchParams).page)
  const index = await getBlogIndex(null, page)
  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface="explorer">
        <BlogStoriesBlock content={{ title: 'Go out *better.*', lede: 'Going out, date ideas and the playbook for hosts, from the people building Mingla.' }} index={index} page={page} blockId="blog-heading" />
      </SitePage>
    </div>
  )
}
