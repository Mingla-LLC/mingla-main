// ORCH-1326 / ORCH-1381 [business-getapp-android-choice] — the business get-app
// page (usemingla.com/host/download). This is the landing surface for the
// partner-invite email's secondary CTA, whose href is byte-frozen to this route.
//
// ORCH-1381 — this route NO LONGER REDIRECTS. It renders an explicit inline
// choice: "Download the app" (iOS → the business App Store, Android → the LIVE
// business Play listing) alongside "Use on web", plus a note on what the app adds.
// iOS is deliberately no longer auto-redirected: every business get-app surface
// presents both actions, and auto-jumping iOS would deny the choice to exactly the
// owners arriving here from the invite email on an iPhone.
//
// Desktop/other/bot has nothing to install → the web action ONLY (no dead install
// button, and no QR — business owners on desktop go straight to the web app).
//
// SSR-safe SERVER Component: reads the request User-Agent header only, never
// `navigator`/`window`, and renders plain <a> anchors (no client JS, no <form>).
// The platform→destination decision comes from lib/business-app-target.ts — the
// single source of truth — and store URLs from lib/store-links.ts. NEVER hardcode
// either here.
//
// ORCH-1399 — the install action now points at the ATTRIBUTED business OneLink
// (which 301s straight to market:// / the App Store, so no intermediate store web
// page renders and the install carries pid/c).
//
// ⚠ THIS ROUTE SELF-ATTRIBUTES, SERVER-SIDE, WITH NO QUERY PARAM — AND MUST.
// It is the landing surface for the partner-invite email's CTA, whose href is
// BYTE-FROZEN to exactly `https://usemingla.com/host/download` with NO query
// string (pinned by orch-1329-invite-email.tester.test.ts). So attribution CANNOT
// ride in on the URL: it is composed here, from this surface's own identity, via
// siteAttribution('business_download'). NEVER append a query param to the invite
// email href to carry attribution — that breaks the byte-frozen pin and is the
// single easiest way to fail this ORCH's CI.

import { headers } from 'next/headers'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import {
  BUSINESS_APP_CHOICE_COPY,
  resolveBusinessAppTarget,
} from '@/lib/business-app-target'
import { siteAttribution } from '@/lib/links-src'
import { publicNoindexMetadata } from '@/lib/search/metadata'

// Reads request headers → must not be statically cached.
export const dynamic = 'force-dynamic'

export const metadata = publicNoindexMetadata('/host/download', {
  title: 'Get Mingla Host',
  description:
    'Get the Mingla Host app on iPhone or Android — or run your dashboard in the browser.',
})

export default async function BusinessDownloadPage() {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)
  // Attribution is derived from THIS SURFACE, not from the request URL — see the
  // byte-frozen invite-email note in the header.
  const target = resolveBusinessAppTarget(platform, siteAttribution('business_download'))

  return (
    <main
      id="main"
      className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-[#08090b] px-5 py-12 text-white"
      style={{
        minHeight: '100dvh',
        paddingTop: 'max(3rem, env(safe-area-inset-top))',
        paddingBottom: 'max(3rem, env(safe-area-inset-bottom))',
      }}
    >
      {/* Brand night-canvas atmosphere (matches /links and /download). */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_10%,rgba(235,120,37,0.18),transparent_34%),radial-gradient(ellipse_at_84%_16%,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,#08090b_0%,#0d0d10_60%,#07080a_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black to-transparent" />
      </div>

      <div className="relative z-10 w-full max-w-[420px] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/mingla-business-logo.png"
          alt="Mingla Host"
          className="mx-auto h-24 w-24 select-none"
          draggable={false}
        />

        <h1 className="mt-4 font-display text-3xl leading-tight text-white">
          Run your business on Mingla
        </h1>

        {/* The two actions. `canInstall === false` (desktop/unknown/bot) renders
            the web action ONLY — never a dead or disabled install button. */}
        <div className="mt-8 flex flex-col gap-3">
          {target.canInstall && target.installHref !== null ? (
            <a
              href={target.installHref}
              className="inline-flex h-14 w-full items-center justify-center rounded-full bg-warm px-7 text-base font-display font-medium tracking-[-0.005em] text-white transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring"
            >
              {BUSINESS_APP_CHOICE_COPY.download}
            </a>
          ) : null}

          <a
            href={target.webHref}
            className="glass-soft inline-flex h-14 w-full items-center justify-center rounded-full px-7 text-base font-display font-medium tracking-[-0.005em] text-white transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring"
          >
            {BUSINESS_APP_CHOICE_COPY.useWeb}
          </a>
        </div>

        <p className="mt-6 text-[13px] leading-relaxed text-white/60">
          {target.canInstall
            ? BUSINESS_APP_CHOICE_COPY.moreNote
            : BUSINESS_APP_CHOICE_COPY.desktopNote}
        </p>
      </div>
    </main>
  )
}
