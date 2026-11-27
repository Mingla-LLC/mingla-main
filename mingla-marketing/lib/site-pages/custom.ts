// #4636 — staff-made pages: which address answers what (pure, unit tested).
//
// A staff-made page lives at /<a> or /<a>/<b> (lowercase letters, digits and
// single hyphens, at most two segments) and is served by the catch-all route
// app/[...slug]/page.tsx. Next.js always prefers a coded route, and the
// database refuses an address whose first segment the coded site answers
// (site_reserved_segments(), I-4636-NO-ADDRESS-COLLISION), so the catch-all
// never shadows a coded page. It also re-checks the reserved list itself.
//
//   live page        → render its published blocks
//   unpublished page → 308 to its redirect (Home by default)
//   anything else    → 404 (drafts are never served)
//
// No imports: plain node tests load this file by stripping its types.

export type CustomFormat = 'landing' | 'host-type' | 'programme' | 'story' | 'blank'

export interface CustomIndexEntry {
  key: string
  path: string
  status: 'live' | 'unpublished'
  redirect_to: string | null
  name: string
  description: string | null
  format: CustomFormat
  hide_from_search: boolean
  show_in_menu: boolean
  published_at: string | null
  share: { bucket: string; path: string; width: number; height: number; alt: string } | null
}

export type CustomRoute =
  | { kind: 'page'; entry: CustomIndexEntry }
  | { kind: 'redirect'; to: string }
  | { kind: 'not-found' }

const ADDRESS = /^\/[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)?$/

/** A staff-made address shape (what the database accepts). */
export function isCustomAddress(path: string): boolean {
  return path.length <= 80 && ADDRESS.test(path)
}

/** The address for catch-all segments (null for anything that cannot be a staff page). */
export function addressFor(segments: readonly string[] | undefined): string | null {
  if (!segments || segments.length < 1 || segments.length > 2) return null
  const path = `/${segments.join('/')}`
  return isCustomAddress(path) ? path : null
}

/** Whether the coded site answers this address's first segment. */
export function isReservedAddress(path: string, reserved: readonly string[]): boolean {
  const first = path.split('/')[1] ?? ''
  return reserved.includes(first)
}

/** A redirect that stays on the site (internal path, no protocol-relative or dot-dot). */
export function safeRedirect(to: string | null | undefined): string {
  if (typeof to === 'string' && /^\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*$/.test(to) && !to.includes('..') && to.length <= 200) return to
  return '/'
}

function isEntry(v: unknown): v is CustomIndexEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.key === 'string' && typeof e.path === 'string' && (e.status === 'live' || e.status === 'unpublished')
}

/** The index as the anonymous read returned it (malformed rows dropped). */
export function customIndexFrom(raw: unknown): CustomIndexEntry[] {
  return Array.isArray(raw) ? raw.filter(isEntry) : []
}

/** What the catch-all answers for these segments. */
export function routeCustom(segments: readonly string[] | undefined, index: readonly CustomIndexEntry[], reserved: readonly string[]): CustomRoute {
  const path = addressFor(segments)
  if (!path || isReservedAddress(path, reserved)) return { kind: 'not-found' }
  const entry = index.find((e) => e.path === path)
  if (!entry) return { kind: 'not-found' }
  if (entry.status === 'unpublished') {
    const to = safeRedirect(entry.redirect_to)
    return to === path ? { kind: 'not-found' } : { kind: 'redirect', to }
  }
  return { kind: 'page', entry }
}

/** The nav and footer surface of a format (host-type pages are Host pages). */
export function surfaceForFormat(format: CustomFormat): 'explorer' | 'host' {
  return format === 'host-type' ? 'host' : 'explorer'
}

/** The live staff pages that belong in the sitemap (not hidden from search). */
export function sitemapEntries(index: readonly CustomIndexEntry[]): CustomIndexEntry[] {
  return index.filter((e) => e.status === 'live' && !e.hide_from_search)
}

/** The live staff pages that asked to be in the menu. */
export function menuEntries(index: readonly CustomIndexEntry[]): { href: string; label: string }[] {
  return index.filter((e) => e.status === 'live' && e.show_in_menu).map((e) => ({ href: e.path, label: e.name }))
}

/** The site origin canonical URLs use. */
export const SITE_ORIGIN = 'https://usemingla.com'

/** Search and share metadata for a live staff page: its own title, description and share image; noindex when hidden. */
export function customPageMetadata(entry: CustomIndexEntry, storageRoot: string): {
  title: { absolute: string }
  description?: string
  alternates: { canonical: string }
  robots: { index: boolean; follow: boolean }
  openGraph: { type: 'website'; siteName: 'Mingla'; title: string; description?: string; url: string; images?: { url: string; width: number; height: number; alt: string }[] }
  twitter: { card: 'summary_large_image'; title: string; description?: string; images?: string[] }
} {
  const title = `${entry.name} | Mingla`
  const url = `${SITE_ORIGIN}${entry.path}`
  const description = entry.description ?? undefined
  const image = entry.share && storageRoot
    ? { url: `${storageRoot}/${entry.share.bucket}/${entry.share.path}`, width: entry.share.width, height: entry.share.height, alt: entry.share.alt }
    : null
  return {
    title: { absolute: title },
    ...(description ? { description } : {}),
    alternates: { canonical: url },
    robots: entry.hide_from_search ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { type: 'website', siteName: 'Mingla', title, ...(description ? { description } : {}), url, ...(image ? { images: [image] } : {}) },
    twitter: { card: 'summary_large_image', title, ...(description ? { description } : {}), ...(image ? { images: [image.url] } : {}) },
  }
}
