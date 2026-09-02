// issue #2981 — one canonical marketing identity.
//
// This is deliberately not environment-overridable. Preview and deployment hosts
// may render the site, but public metadata, sitemaps, schema, QR codes, and host
// normalization all resolve to the same production authority.

export const SITE_ORIGIN = 'https://usemingla.com' as const
export const SITE_HOST = 'usemingla.com' as const
export const WWW_SITE_HOST = 'www.usemingla.com' as const
export const CAREERS_HOST = 'career.usemingla.com' as const
export const BUYER_HOST = 'host.usemingla.com' as const

function normalizePathname(pathname: string): string {
  if (pathname === '' || pathname === '/') return '/'
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`
  return withLeadingSlash.replace(/\/+$/, '')
}

export function canonicalMarketingUrl(pathname = '/'): string {
  const normalized = normalizePathname(pathname)
  return normalized === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${normalized}`
}

export function hostnameFromHeader(host: string | null): string | null {
  if (!host) return null
  const firstAuthority = host.split(',', 1)[0]?.trim()
  return firstAuthority?.split(':')[0]?.toLowerCase() || null
}

export function isCanonicalMarketingHost(host: string | null): boolean {
  return hostnameFromHeader(host) === SITE_HOST
}

export function isWwwMarketingHost(host: string | null): boolean {
  return hostnameFromHeader(host) === WWW_SITE_HOST
}

/** The §4.2 smart-download route the QR encodes (one QR serves iOS + Android). */
export const DOWNLOAD_URL = `${SITE_ORIGIN}/download`
