// META-ORCH-1222 [Careers site] — host-based rewrite (SPEC §4.C.1).
//
// career.usemingla.com (and `career.*` Vercel preview aliases) → the
// `/careers` segment, which maps to the app/careers/** routes. usemingla.com /
// www.usemingla.com are PROVABLY untouched (the rewrite fires only on the
// `career.` host). The apex guard 404s usemingla.com/careers/* so the careers
// segment is not crawlable from the apex (I-PROPOSED-1222-CAREERS-SUBDOMAIN-ISOLATED).
//
// The matcher excludes _next, .well-known, and static assets so
// apple-app-site-association / assetlinks.json keep serving on the apex.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const CAREERS_PREFIX = '/careers'
const INTERNAL_PROXY_HEADER = 'x-mingla-internal-share-route'
const PUBLIC_SHARE_PATH = /^(?:\/p\/[a-f0-9]{36}|\/share\/[a-f0-9]{36}\.png|\/og\/share\/[a-f0-9]{36}\.png|\/api\/shared-card\/[a-f0-9]{36}|\/s\/[0-9A-Za-z]{16}|\/og\/s\/[0-9A-Za-z]{16}\/v[1-9][0-9]*-r2\.jpg|\/api\/content-share\/[0-9A-Za-z]{16}|\/api\/content-share-readiness\/[0-9A-Za-z]{16}\/[1-9][0-9]*)$/

function internalSharePath(pathname: string): string | null {
  let content = pathname.match(/^\/s\/([0-9A-Za-z]{16})$/)
  if (content) return `/api/internal-share-proxy/content-page/${content[1]}`
  content = pathname.match(/^\/og\/s\/([0-9A-Za-z]{16})\/v([1-9][0-9]*)-r2\.jpg$/)
  if (content) return `/api/internal-share-proxy/content-image/${content[1]}/${content[2]}`
  content = pathname.match(/^\/api\/content-share\/([0-9A-Za-z]{16})$/)
  if (content) return `/api/internal-share-proxy/content-data/${content[1]}`
  content = pathname.match(/^\/api\/content-share-readiness\/([0-9A-Za-z]{16})\/([1-9][0-9]*)$/)
  if (content) return `/api/internal-share-proxy/content-readiness/${content[1]}/${content[2]}`
  let match = pathname.match(/^\/p\/([a-f0-9]{36})$/)
  if (match) return `/api/internal-share-proxy/page/${match[1]}`
  match = pathname.match(/^\/share\/([a-f0-9]{36})\.png$/)
  if (match) return `/api/internal-share-proxy/snippet/${match[1]}`
  match = pathname.match(/^\/og\/share\/([a-f0-9]{36})\.png$/)
  if (match) return `/api/internal-share-proxy/og/${match[1]}`
  match = pathname.match(/^\/api\/shared-card\/([a-f0-9]{36})$/)
  return match ? `/api/internal-share-proxy/data/${match[1]}` : null
}

function isCareersHost(host: string | null): boolean {
  if (!host) return false
  // Strip a :port for local dev. `career.usemingla.com`, `career-<hash>.vercel.app`.
  const name = host.split(':')[0].toLowerCase()
  return name === 'career.usemingla.com' || name.startsWith('career.')
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host')
  const { pathname, search } = req.nextUrl

  // Incoming callers cannot mint the internal marker. Only exact public share
  // routes receive it in the same atomic rewrite to the server-only handlers.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.delete(INTERNAL_PROXY_HEADER)
  if (isCareersHost(host)) {
    // Already under the internal prefix → pass through (avoid double-rewrite).
    if (pathname === CAREERS_PREFIX || pathname.startsWith(`${CAREERS_PREFIX}/`)) {
      return NextResponse.next({ request: { headers: requestHeaders } })
    }
    const url = req.nextUrl.clone()
    url.pathname = `${CAREERS_PREFIX}${pathname === '/' ? '' : pathname}`
    url.search = search
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  }

  if (PUBLIC_SHARE_PATH.test(pathname)) {
    requestHeaders.set(INTERNAL_PROXY_HEADER, process.env.SHARED_CARD_PROXY_SECRET || '')
    const internalPath = internalSharePath(pathname)
    if (!internalPath) return NextResponse.next({ request: { headers: requestHeaders } })
    const url = req.nextUrl.clone()
    url.pathname = internalPath
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  }

  // Apex guard: a NON-careers host MUST NOT reach the careers segment.
  if (pathname === CAREERS_PREFIX || pathname.startsWith(`${CAREERS_PREFIX}/`)) {
    const notFound = req.nextUrl.clone()
    notFound.pathname = '/careers-not-found'
    return NextResponse.rewrite(notFound, { request: { headers: requestHeaders } }) // resolves to the app 404 (no such route)
  }

  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: [
    '/p/:path*',
    '/s/:path*',
    '/og/s/:path*',
    '/api/content-share/:path*',
    '/api/content-share-readiness/:path*',
    '/share/:path*',
    '/og/share/:path*',
    '/api/shared-card/:path*',
    '/((?!_next/|.well-known/|api/internal-share-proxy/|.*\\..*).*)',
  ],
}
