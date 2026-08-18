// issue #2272 — /board/* had NO route, NO redirect and NO rewrite on the apex,
// so every one of these returned HTTP 404 in a browser (measured on production
// 2026-08-18 under iPhone, Android and desktop user-agents alike).
//
// CONFIRMED, NOT ASSUMED: `/board/{code}` is a COLLABORATION-SESSION invite code
// (`boardInviteService.ts:40` mints `mingla://board/{invite_code}`;
// `deepLinkService.ts:183` parses it as `board-invite`). It is NOT a misspelling
// of `/b/{brandSlug}`, which is a brand page. A redirect to /b/ would hand a
// collaboration code to a brand lookup that can never match, so there is none.
//
// OPTIONAL catch-all `[[...rest]]`, not `[...rest]`: the Android intent filter
// declares `pathPrefix: "/board"` with no trailing slash, so a bare `/board` is
// claimed by the OS too and must not be the one survivor that still 404s.
//
// The whole page is in `components/marketing/app-link-landing.tsx`. This file
// deliberately holds no copy and no logic — four families, one landing.

import { AppLinkLanding, appLinkLandingMetadata } from '@/components/marketing/app-link-landing'

export const metadata = appLinkLandingMetadata('board')

export default function BoardAppLinkPage() {
  return <AppLinkLanding kind="board" />
}
