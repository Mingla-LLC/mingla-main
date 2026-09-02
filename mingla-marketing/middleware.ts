// META-ORCH-1222 [Careers site] — host-based rewrite (SPEC §4.C.1).
//
// career.usemingla.com (and `career.*` Vercel preview aliases) → the
// `/careers` segment, which maps to the app/careers/** routes. The rewrite fires
// only on `career.` hosts. The apex guard 404s usemingla.com/careers/* so the
// careers segment is not crawlable from the apex
// (I-PROPOSED-1222-CAREERS-SUBDOMAIN-ISOLATED).
//
// The matcher excludes _next, .well-known, and internal proxy handlers so
// association files and server-only share paths keep their separate owners.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { routeContractForPath } from './lib/search/route-registry'
import {
  CAREERS_HOST,
  SITE_HOST,
  hostnameFromHeader,
  isWwwMarketingHost,
} from './lib/site'

const CAREERS_PREFIX = '/careers'
// A file in public/ is host-agnostic: /brand/mingla-wordmark.svg is the same
// byte-for-byte file on every host. The careers rewrite prefixed it anyway, so
// on career.usemingla.com it resolved to /careers/brand/mingla-wordmark.svg,
// which does not exist -- that is why the careers logo 404'd in both the header
// and the footer. Any path whose last segment carries an extension is a file,
// never a careers route (/careers, /careers/roles/<slug>, /careers/.../apply).
const PUBLIC_FILE = /\.[^/]+$/
const INTERNAL_SHARE_PREFIX = '/api/internal-share-proxy/'
const INTERNAL_PROXY_HEADER = 'x-mingla-internal-share-route'
const EXACT_SHARE_OWNER_PATHS = new Set(['/api/content-share-analytics'])
const PUBLIC_SHARE_PATH = /^(?:\/p\/[a-f0-9]{36}|\/share\/[a-f0-9]{36}\.png|\/og\/share\/[a-f0-9]{36}\.png|\/api\/shared-card\/[a-f0-9]{36}|\/s\/[0-9A-Za-z]{16}|\/og\/s\/[0-9A-Za-z]{16}\/v[1-9][0-9]*-r2\.jpg|\/api\/content-share\/[0-9A-Za-z]{16}|\/api\/content-share-readiness\/[0-9A-Za-z]{16}\/[1-9][0-9]*)$/
const SHARE_OWNER_PREFIXES = [
  '/p/',
  '/s/',
  '/share/',
  '/og/share/',
  '/og/s/',
  '/api/shared-card/',
  '/api/content-share/',
  '/api/content-share-readiness/',
  INTERNAL_SHARE_PREFIX,
] as const

function isShareOwnerPath(pathname: string): boolean {
  return (
    EXACT_SHARE_OWNER_PATHS.has(pathname) ||
    SHARE_OWNER_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  )
}

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
  // Strip a :port for local dev. `career.usemingla.com`, `career-<hash>.vercel.app`.
  const name = hostnameFromHeader(host)
  return name === CAREERS_HOST || name?.startsWith('career.') === true
}

export function middleware(req: NextRequest) {
  // Next preserves the original public authority in x-forwarded-host when an
  // internal rewrite is evaluated again. Prefer it so the careers owner stays
  // isolated through that second pass; hostnameFromHeader still compares one
  // exact normalized host, never a suffix.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
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
    // Static files serve from public/ on every host, unprefixed.
    if (PUBLIC_FILE.test(pathname)) {
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

  // issue #2981 — exact www only. Careers and public share routes were handled
  // above by their own owners; `.well-known/**` never enters this matcher.
  if (isWwwMarketingHost(host) && !isShareOwnerPath(pathname)) {
    const url = req.nextUrl.clone()
    url.protocol = 'https:'
    url.hostname = SITE_HOST
    url.port = ''
    url.pathname = pathname
    url.search = search
    return NextResponse.redirect(url, 308)
  }

  // The lifecycle registry owns retired routes. There are no initial `gone`
  // entries, but any future one becomes an honest 410 here rather than a soft 200.
  if (routeContractForPath(pathname)?.lifecycle === 'gone') {
    return new NextResponse('Gone', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
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
    '/((?!_next/|.well-known/|api/internal-share-proxy/|api/content-share-analytics$).*)',
  ],
}
