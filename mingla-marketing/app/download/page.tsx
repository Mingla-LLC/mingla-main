// ORCH-1319 — the SMART DOWNLOAD route (usemingla.com/download).
//
// This is the URL the download QR encodes, so ONE QR routes both platforms:
//   - iPhone scanning it → this route with an iOS UA → 307 → App Store.
//   - Android phone      → 307 → Google Play.
//   - desktop / bot / curl / unknown UA → 200 HTML with the QR + both store
//     badges (SEO-safe; the redirect only fires for real iOS/Android UAs).
//
// SSR-safe: this is a SERVER Component — it reads the request User-Agent header
// only, and NEVER touches `navigator` / `window`. The QR (client component) is
// embedded and takes only a static string prop.
//
// Future (ORCH-1313 P2): the iOS/Android branches can 302 to the AppsFlyer OneLink
// for install attribution instead of the raw store URLs — this route is that seam.
//
// #4339 phase 2b — the desktop page is the approved "Get the app" design: the
// Mingla / Mingla Host toggle (components/site/download-toggle.tsx), a QR and
// both store buttons for each app, and "Or use Mingla Host on web" for Host. Every
// store, OneLink and host-web href comes from lib/app-handoff.ts →
// lib/cta-destination.ts (#4137); the Explorer QR still encodes /download.
// The phone redirect above is unchanged. No form, no PII, no email field.
// #4636: the section is the registry block `getApp` (components/site-blocks/
// sections/get-app-block.tsx, the hrefs move with it).

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { SitePage } from '@/components/site/site-page'
import { GetAppBlock } from '@/components/site-blocks/sections/get-app-block'
import { GET_APP } from '@/content/site-blocks/core'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'
import { publicNoindexMetadata } from '@/lib/search/metadata'
import { landingMono, landingSans, landingSerif } from '@/app/site-fonts'

// It reads request headers → must not be statically cached.
export const dynamic = 'force-dynamic'

export const metadata = publicNoindexMetadata('/download', {
  title: 'Get Mingla',
  description:
    'Download Mingla on the App Store or Google Play — scan the QR with your phone or pick your store.',
})

type Props = { readonly searchParams: Promise<{ app?: string | string[] }> }

export default async function DownloadPage({ searchParams }: Props) {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)

  // Phones go straight to their store (redirect() emits a 307 temporary redirect).
  if (platform === 'ios') redirect(APP_STORE_URL)
  if (platform === 'android') redirect(PLAY_STORE_URL)

  // Desktop / other → the QR + store buttons page.
  const initial = (await searchParams).app === 'host' ? 'host' : 'explorer'

  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface={initial === 'host' ? 'host' : 'explorer'}>
        <GetAppBlock content={GET_APP} initial={initial} blockId="get-app" />
      </SitePage>
    </div>
  )
}
