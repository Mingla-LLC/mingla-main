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

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { AppStoreBadges } from '@/components/ui/app-store-badges'
import { DownloadQr } from '@/components/marketing/download-qr'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'
import { publicNoindexMetadata } from '@/lib/search/metadata'

// It reads request headers → must not be statically cached.
export const dynamic = 'force-dynamic'

export const metadata = publicNoindexMetadata('/download', {
  title: 'Get Mingla',
  description:
    'Download Mingla on the App Store or Google Play — scan the QR with your phone or pick your store.',
})

export default async function DownloadPage() {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)

  // Phones go straight to their store (redirect() emits a 307 temporary redirect).
  if (platform === 'ios') redirect(APP_STORE_URL)
  if (platform === 'android') redirect(PLAY_STORE_URL)

  // Desktop / other → the QR + badges page. No form, no PII, no email field.
  return (
    <main
      id="main"
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#08090b] px-5 py-10 text-text-primary"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_12%,rgba(235,120,37,0.18),transparent_32%),radial-gradient(ellipse_at_84%_18%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,#08090b_0%,#0d0d10_58%,#07080a_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />
      </div>

      <article className="relative w-full max-w-md rounded-[28px] border border-white/12 bg-[#0d0d10]/94 p-7 text-center shadow-[0_40px_120px_rgba(0,0,0,0.52),inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          Mingla
        </p>
        <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-5xl">
          Get Mingla
        </h1>
        <p className="mt-3 text-base leading-relaxed text-white/76">
          Scan this with your phone, or pick your store.
        </p>

        {/* Device-smart QR on a solid white card (contrast for scanners). */}
        <div className="mt-8 flex justify-center">
          <div className="rounded-[22px] bg-white p-5 shadow-[0_1px_2px_rgba(14,14,16,0.1)]">
            <DownloadQr size={220} />
          </div>
        </div>

        <div className="mt-8 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-white/12" />
          <span className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/50">
            or
          </span>
          <span className="h-px flex-1 bg-white/12" />
        </div>

        <div className="mt-8 flex justify-center">
          <AppStoreBadges size="lg" />
        </div>
      </article>
    </main>
  )
}
