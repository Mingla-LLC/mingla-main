// issue #2272 — /orders/* had NO route, NO redirect and NO rewrite on the apex,
// so every one of these returned HTTP 404 in a browser (measured on production
// 2026-08-18 under iPhone, Android and desktop user-agents alike).
//
// This is the path every confirmation email delivered before #2240 still carries
// (`/orders/{id}/chat`). Those cannot be recalled, so the browser case is served
// here rather than left to rot.
//
// OPTIONAL catch-all `[[...rest]]`, not `[...rest]`: the Android intent filter
// declares `pathPrefix: "/orders"` with no trailing slash, so a bare `/orders` is
// claimed by the OS too and must not be the one survivor that still 404s.
//
// The whole page is in `components/marketing/app-link-landing.tsx`. This file
// deliberately holds no copy and no logic — four families, one landing.

import { AppLinkLanding, appLinkLandingMetadata } from '@/components/marketing/app-link-landing'

export const metadata = appLinkLandingMetadata('order')

export default function OrdersAppLinkPage() {
  return <AppLinkLanding kind="order" />
}
