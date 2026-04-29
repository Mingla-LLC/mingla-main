import { NextRequest, NextResponse } from 'next/server';

// Subdomain → zone routing. Each subdomain serves a different "site" from one
// codebase. Internal rewrites land at /sites/[zone]/... which map to the
// app/sites/[zone]/ directory. Users only ever see clean URLs.
//
// IMPORTANT: the folder is `sites/`, NOT `_sites/`. Underscore-prefixed
// folders in app/ are PRIVATE and not routable in Next.js — pages inside
// won't compile as routes. Don't rename it.
const HOST_TO_ZONE: Record<string, 'umbrella' | 'explore' | 'business'> = {
  // Production
  'usemingla.com': 'umbrella',
  'www.usemingla.com': 'umbrella',
  'explore.usemingla.com': 'explore',
  'business.usemingla.com': 'business',

  // Vercel preview deploys (override at deploy time if naming differs)
  'mingla-marketing.vercel.app': 'umbrella',
  'explore-mingla-marketing.vercel.app': 'explore',
  'business-mingla-marketing.vercel.app': 'business',

  // Local dev (Chrome resolves *.localhost automatically; Safari users need
  // entries in /etc/hosts — see README).
  'localhost:3000': 'umbrella',
  'explore.localhost:3000': 'explore',
  'business.localhost:3000': 'business',
};

export function middleware(req: NextRequest): NextResponse {
  const host = req.headers.get('host') ?? '';
  const zone = HOST_TO_ZONE[host] ?? 'umbrella';

  const url = req.nextUrl.clone();

  // Already rewritten — skip to prevent rewrite loops
  if (url.pathname.startsWith('/sites/')) {
    return NextResponse.next();
  }

  url.pathname = `/sites/${zone}${url.pathname === '/' ? '' : url.pathname}`;

  const response = NextResponse.rewrite(url);
  // Surface the zone to client code via a header (handy for debugging)
  response.headers.set('x-mingla-zone', zone);
  return response;
}

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and any path with a file extension.
    '/((?!_next/|api/|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)',
  ],
};
