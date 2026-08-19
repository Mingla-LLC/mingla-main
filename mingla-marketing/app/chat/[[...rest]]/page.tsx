// issue #2272 — /chat/* had NO route, NO redirect and NO rewrite on the apex,
// so every one of these returned HTTP 404 in a browser (measured on production
// 2026-08-18 under iPhone, Android and desktop user-agents alike).
//
// Event chat exists only in the app. Nothing on the web renders a conversation, so
// the landing says so instead of implying otherwise.
//
// OPTIONAL catch-all `[[...rest]]`, not `[...rest]`: the Android intent filter
// declares `pathPrefix: "/chat"` with no trailing slash, so a bare `/chat` is
// claimed by the OS too and must not be the one survivor that still 404s.
//
// The whole page is in `components/marketing/app-link-landing.tsx`. This file
// deliberately holds no copy and no logic — four families, one landing.

import { AppLinkLanding, appLinkLandingMetadata } from '@/components/marketing/app-link-landing'

export const metadata = appLinkLandingMetadata('chat')

export default function ChatAppLinkPage() {
  return <AppLinkLanding kind="chat" />
}
