// ORCH-1326 [links business tab reflects the live app] — the business SMART
// DOWNLOAD route (usemingla.com/business/download). Parity with app/download/
// page.tsx (ORCH-1319) but BUSINESS + no QR/landing: business owners on desktop
// go straight to the web app. iPhone → the live business App Store; everyone else
// (Android — Play still in review — + desktop/other/bot) → the business web app.
//
// SSR-safe SERVER Component: reads the request User-Agent header only, never
// `navigator`/`window`. Store/web destinations come from lib/store-links.ts
// (ORCH-1324 SSOT) — NEVER hardcoded here.

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL } from '@/lib/store-links'

// Reads request headers → must not be statically cached.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Get Mingla Business',
  description:
    'Get the Mingla Business app on iPhone, or run it in your browser.',
}

export default async function BusinessDownloadPage() {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)

  // iPhone → the live business App Store; everyone else → the business web app.
  if (platform === 'ios') redirect(BUSINESS_APP_STORE_URL)
  redirect(BUSINESS_WEB_URL)
}
