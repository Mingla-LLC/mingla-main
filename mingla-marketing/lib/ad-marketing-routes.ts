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
