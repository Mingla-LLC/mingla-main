// #4264 — usemingla.com/host/get: the one-tap "Download Mingla Host" link (the
// Mingla Host 1.2 launch post's button). Unlike /host/download it renders
// NOTHING: it answers with a 307 straight to where the device should go.
//
//   iPhone / iPad → the ATTRIBUTED business OneLink (301s to the App Store)
//   Android       → the same attributed OneLink (301s to market:// Play)
//   desktop / unknown / bot → the Mingla Host web app
//
// The decision is lib/business-app-target.ts (the single source of truth) and
// every URL lives in lib/store-links.ts. NEVER hardcode either here. Server-side
// only: the User-Agent request header, never `navigator` / `window`.
//
// The answer depends on the User-Agent, so it is never cached (dynamic route,
// `no-store`) and never indexed (`X-Robots-Tag`). A route handler has no
// metadata, so it is not in the search route registry and never in the sitemap.

import { resolvePlatformFromUa } from '@/lib/device-platform'
import { resolveBusinessAppTarget } from '@/lib/business-app-target'
import { siteAttribution } from '@/lib/links-src'

export const dynamic = 'force-dynamic'

export function GET(request: Request): Response {
  const platform = resolvePlatformFromUa(request.headers.get('user-agent') ?? '')
  const target = resolveBusinessAppTarget(platform, siteAttribution('business_get'))
  const destination =
    target.canInstall && target.installHref !== null ? target.installHref : target.webHref

  return new Response(null, {
    status: 307,
    headers: {
      Location: destination,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
