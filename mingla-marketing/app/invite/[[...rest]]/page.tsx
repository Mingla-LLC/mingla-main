// issue #2272 — /invite/* had NO route, NO redirect and NO rewrite on the apex,
// so every one of these returned HTTP 404 in a browser (measured on production
// 2026-08-18 under iPhone, Android and desktop user-agents alike).
//
// `/invite/{referralCode}` is a referral code (`oneLinkShare.ts:177`), minted on
// the AppsFlyer branded domain go.usemingla.com — never on this apex. The apex
// only ever receives one because the live AASA claims `/invite/*`.
//
// OPTIONAL catch-all `[[...rest]]`, not `[...rest]`: the Android intent filter
// declares `pathPrefix: "/invite"` with no trailing slash, so a bare `/invite` is
// claimed by the OS too and must not be the one survivor that still 404s.
//
// The whole page is in `components/marketing/app-link-landing.tsx`. This file
// deliberately holds no copy and no logic — four families, one landing.

import { AppLinkLanding, appLinkLandingMetadata } from '@/components/marketing/app-link-landing'

export const metadata = appLinkLandingMetadata('invite')

export default function InviteAppLinkPage() {
  return <AppLinkLanding kind="invite" />
}
