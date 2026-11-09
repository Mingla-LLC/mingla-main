/**
 * toward #3697 Wave 4 — marketing destination allowlist for click capture.
 * Keep paths/slugs in lockstep with
 * `supabase/functions/_shared/adDestination.ts` MARKETING_ROUTES
 * (CI pins both).
 */

export const MARKETING_BRAND_SLUG = 'mingla' as const

export const MARKETING_ROUTES = [
  { slug: 'explorer', path: '/' },
  { slug: 'host', path: '/host' },
  { slug: 'download', path: '/download' },
  { slug: 'host-download', path: '/host/download' },
  { slug: 'tools', path: '/tools' },
  { slug: 'tools-events', path: '/tools/events' },
  { slug: 'tools-venues', path: '/tools/venues' },
  { slug: 'tools-trips', path: '/tools/trips' },
  { slug: 'tools-pricing', path: '/tools/pricing' },
  // #4339 round B — the seven Host landing pages and the ten city pages.
  { slug: 'host-events', path: '/host/events' },
  { slug: 'host-trips', path: '/host/trips' },
  { slug: 'host-experiences', path: '/host/experiences' },
  { slug: 'host-restaurants', path: '/host/restaurants' },
  { slug: 'host-hotels', path: '/host/hotels' },
  { slug: 'host-art', path: '/host/art' },
  { slug: 'host-play', path: '/host/play' },
  { slug: 'city-lagos', path: '/cities/lagos' },
  { slug: 'city-durham-nc', path: '/cities/durham-nc' },
  { slug: 'city-cary-nc', path: '/cities/cary-nc' },
  { slug: 'city-raleigh-nc', path: '/cities/raleigh-nc' },
  { slug: 'city-new-york-city', path: '/cities/new-york-city' },
  { slug: 'city-brussels', path: '/cities/brussels' },
  { slug: 'city-paris', path: '/cities/paris' },
  { slug: 'city-london', path: '/cities/london' },
  { slug: 'city-fort-lauderdale', path: '/cities/fort-lauderdale' },
  { slug: 'city-washington-dc', path: '/cities/washington-dc' },
] as const

/** Map a browser pathname on usemingla.com to an allowlisted marketing slug. */
export function marketingSlugFromPathname(
  pathname: string | null | undefined,
): string | null {
  if (!pathname) return null
  let path = pathname.trim()
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/+$/, '') || '/'
  const hit = MARKETING_ROUTES.find((r) => r.path === path)
  return hit?.slug ?? null
}
