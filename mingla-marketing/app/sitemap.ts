import type { MetadataRoute } from 'next'
import {
  BLOG_CATEGORY_ROUTE_CONTRACTS,
  blogPostCanonicalUrl,
  blogPostRouteContract,
  canonicalUrlForSearchRoute,
  searchReadyRoutes,
  sitemapLastModified,
} from '@/lib/search/route-registry'
import { blogCategoriesWithPosts, listBlogSitemapEntries } from '@/lib/blog/data'

// #4137 — registry routes first (exact, in registry order), then one entry
// per PUBLIC blog post from the database. With no database configured (CI)
// there are none. Every blog route renders per request, so the sitemap does
// too: a post published a minute ago is listed on the next request.
//
// #4339 round B — `lastmod` comes from sitemapLastModified (the redesign date,
// SITE_REDESIGN_LAST_MODIFIED, for every rebuilt page), and a blog category
// with no public post leaves the sitemap (its page is noindex until a post
// lands; see app/blog/category/[category]/page.tsx).
export const dynamic = 'force-dynamic'

const CATEGORY_PATHS: ReadonlySet<string> = new Set(BLOG_CATEGORY_ROUTE_CONTRACTS.map((route) => route.match.pathname))

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const filled = await blogCategoriesWithPosts()
  const listed = (pathname: string) => !CATEGORY_PATHS.has(pathname) || filled.has(pathname.slice('/blog/category/'.length))
  const routes = searchReadyRoutes().map((route) => ({
    pathname: route.match.pathname,
    url: canonicalUrlForSearchRoute(route.match.pathname),
    lastModified: new Date(`${sitemapLastModified(route)}T00:00:00.000Z`),
  }))
    .filter((entry) => listed(entry.pathname))
    .map(({ url, lastModified }) => ({ url, lastModified }))
  const posts = (await listBlogSitemapEntries())
    .map((entry) => blogPostRouteContract({ slug: entry.slug, title: entry.slug, description: entry.slug, lastModified: entry.last_modified }))
    .map((contract) => ({
      url: blogPostCanonicalUrl(contract.match.pathname.slice('/blog/'.length)),
      lastModified: new Date(`${contract.lastModified}T00:00:00.000Z`),
    }))
  return [...routes, ...posts]
}
