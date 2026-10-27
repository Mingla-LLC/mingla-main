import type { MetadataRoute } from 'next'
import {
  blogPostCanonicalUrl,
  blogPostRouteContract,
  canonicalUrlForSearchRoute,
  searchReadyRoutes,
} from '@/lib/search/route-registry'
import { listBlogSitemapEntries } from '@/lib/blog/data'

// #4137 — registry routes first (exact, in registry order), then one entry
// per PUBLIC blog post from the database. With no database configured (CI)
// there are none. Every blog route renders per request, so the sitemap does
// too: a post published a minute ago is listed on the next request.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = searchReadyRoutes().map((route) => ({
    url: canonicalUrlForSearchRoute(route.match.pathname),
    lastModified: new Date(`${route.lastModified}T00:00:00.000Z`),
  }))
  const posts = (await listBlogSitemapEntries())
    .map((entry) => blogPostRouteContract({ slug: entry.slug, title: entry.slug, description: entry.slug, lastModified: entry.last_modified }))
    .map((contract) => ({
      url: blogPostCanonicalUrl(contract.match.pathname.slice('/blog/'.length)),
      lastModified: new Date(`${contract.lastModified}T00:00:00.000Z`),
    }))
  return [...routes, ...posts]
}
