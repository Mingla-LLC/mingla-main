import type { MetadataRoute } from 'next'
import { canonicalUrlForSearchRoute, searchReadyRoutes } from '@/lib/search/route-registry'

export default function sitemap(): MetadataRoute.Sitemap {
  return searchReadyRoutes().map((route) => ({
    url: canonicalUrlForSearchRoute(route.match.pathname),
    lastModified: new Date(`${route.lastModified}T00:00:00.000Z`),
  }))
}
