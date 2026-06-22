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

function isCareersHost(host: string | null): boolean {
  if (!host) return false
  // Strip a :port for local dev. `career.usemingla.com`, `career-<hash>.vercel.app`.
  const name = host.split(':')[0].toLowerCase()
  return name === 'career.usemingla.com' || name.startsWith('career.')
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host')
  const { pathname, search } = req.nextUrl

  if (isCareersHost(host)) {
    // Already under the internal prefix → pass through (avoid double-rewrite).
    if (pathname === CAREERS_PREFIX || pathname.startsWith(`${CAREERS_PREFIX}/`)) {
      return NextResponse.next()
    }
    const url = req.nextUrl.clone()
    url.pathname = `${CAREERS_PREFIX}${pathname === '/' ? '' : pathname}`
    url.search = search
    return NextResponse.rewrite(url)
  }

  // Apex guard: a NON-careers host MUST NOT reach the careers segment.
  if (pathname === CAREERS_PREFIX || pathname.startsWith(`${CAREERS_PREFIX}/`)) {
    const notFound = req.nextUrl.clone()
    notFound.pathname = '/careers-not-found'
    return NextResponse.rewrite(notFound) // resolves to the app 404 (no such route)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/|.well-known/|.*\\..*).*)'],
}
