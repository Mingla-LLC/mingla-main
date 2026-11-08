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
// both store buttons for each app, and "Or use Mingla Web" for Host. Every
// store, OneLink and host-web href comes from lib/app-handoff.ts →
// lib/cta-destination.ts (#4137); the Explorer QR still encodes /download.
// The phone redirect above is unchanged. No form, no PII, no email field.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { AppStoreBadges } from '@/components/ui/app-store-badges'
import { AppleMark, PlayMark } from '@/components/ui/store-marks'
import { DownloadQr } from '@/components/marketing/download-qr'
import { LandingMedia } from '@/components/landing/landing-media'
import { AppQr, DownloadToggle } from '@/components/site/download-toggle'
import { SitePage } from '@/components/site/site-page'
import { appHandoffHrefs, hostWebLabel } from '@/lib/app-handoff'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { siteAttribution } from '@/lib/links-src'
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
  const explorer = appHandoffHrefs('explorer', siteAttribution('explorer_nav'))
  const host = appHandoffHrefs('host', siteAttribution('business_download'))

  const explorerPanel = (
    <>
      <h1>
        Get <em>Mingla.</em>
      </h1>
      <p className="lead">Scan this with your phone, or pick your store.</p>
      <div className="qr-row">
        <div className="qr">
          <DownloadQr size={172} />
        </div>
        <div className="stores">
          <AppStoreBadges size="lg" iosHref={explorer.stores.appStore} androidHref={explorer.stores.googlePlay} />
        </div>
      </div>
    </>
  )

  const hostPanel = (
    <>
      <h1>
        Get <em>Mingla Host.</em>
      </h1>
      <p className="lead">Scan this with your phone, pick your store, or run it in your browser.</p>
      <div className="qr-row">
        <div className="qr">
          <AppQr value={host.phoneHref} title="QR code that opens the Mingla Host app on your phone" size={172} />
        </div>
        <div className="stores">
          <a className="store" href={host.stores.appStore} aria-label="Download Mingla Host on the App Store">
            <AppleMark />
            <span>
              <small>Download on the</small>
              <b>App Store</b>
            </span>
          </a>
          <a className="store" href={host.stores.googlePlay} aria-label="Get Mingla Host on Google Play">
            <PlayMark />
            <span>
              <small>Get it on</small>
              <b>Google Play</b>
            </span>
          </a>
          <a className="btn soft" href={host.computerHref}>
            Or use Mingla Web <ArrowRight aria-hidden="true" />
          </a>
          <span className="sr-only">Mingla Web is at {hostWebLabel(host.computerHref)}</span>
        </div>
      </div>
    </>
  )

  return (
    <div className={`${landingSerif.variable} ${landingSans.variable} ${landingMono.variable}`}>
      <SitePage surface={initial === 'host' ? 'host' : 'explorer'}>
        <section className="sec get-app">
          <div className="wrap split split-center">
            <DownloadToggle initial={initial} explorer={explorerPanel} host={hostPanel} />
            <div className="phone" aria-hidden="true">
              <span className="notch" />
              <div className="scr">
                <LandingMedia media="v:cozy" />
              </div>
            </div>
          </div>
        </section>
      </SitePage>
    </div>
  )
}
