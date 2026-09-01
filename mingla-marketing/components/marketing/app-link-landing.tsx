// issue #2272 — the honest landing served at `/orders/*`, `/chat/*`, `/board/*`
// and `/invite/*`. See `lib/app-link-landing.ts` for the full argument.
//
// SERVER COMPONENT, AND DELIBERATELY INERT:
//   - no `'use client'`, no `navigator`, no `window`
//   - no `headers()` and no user-agent branch — `/download` owns that decision
//   - no `apps.apple.com` / `play.google.com` literal — `/download` owns those
//   - no order id, no brand, no buyer input rendered; every string comes from
//     the closed literal unions in `lib/app-link-landing.ts`
//
// Consequence worth stating plainly: an iPhone, an Android phone and a desktop
// browser all get the SAME 200 here, and the device split happens on the next
// hop. That is on purpose. A phone reaching this page frequently DOES have the
// app — universal links do not fire inside an in-app browser (iOS Mail/Gmail
// open links in a SFSafariViewController), so silently throwing that person at
// the App Store would show them "OPEN" on an app they already have. Telling
// them where the thing actually lives is the only answer true for both.

import type { Metadata } from 'next'
import Link from 'next/link'

import {
  DOWNLOAD_PATH,
  appLinkLandingCopy,
  type AppLinkLandingKind,
} from '@/lib/app-link-landing'
import { publicNoindexMetadata } from '@/lib/search/metadata'

export function AppLinkLanding({ kind }: { kind: AppLinkLandingKind }) {
  const copy = appLinkLandingCopy(kind)

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
        <h1 className="mt-3 font-display text-3xl leading-tight text-white sm:text-4xl">
          {copy.title}
        </h1>
        <p className="mt-4 text-base leading-relaxed text-white/76">{copy.lede}</p>
        <p className="mt-3 text-sm leading-relaxed text-white/60">{copy.detail}</p>

        <Link
          href={DOWNLOAD_PATH}
          className="mt-8 inline-flex h-12 w-full items-center justify-center rounded-full bg-coral-500 px-6 font-medium text-white transition-colors hover:bg-coral-600 focus-ring"
        >
          {copy.cta}
        </Link>

        <p className="mt-5 text-sm text-white/55">
          Need a hand?{' '}
          <a
            className="underline underline-offset-4 hover:text-white"
            href="mailto:support@usemingla.com"
          >
            support@usemingla.com
          </a>
        </p>
      </article>
    </main>
  )
}

/**
 * Page metadata for a landing. `noindex` is not cosmetic: these URLs are
 * per-order / per-invite and must never enter a search index, and the AASA
 * claims the whole family so a crawled copy would be worthless anyway.
 */
export function appLinkLandingMetadata(kind: AppLinkLandingKind): Metadata {
  const copy = appLinkLandingCopy(kind)
  const pathByKind: Readonly<Record<AppLinkLandingKind, string>> = {
    order: '/orders',
    chat: '/chat',
    board: '/board',
    invite: '/invite',
  }
  return publicNoindexMetadata(pathByKind[kind], {
    title: copy.title,
    description: copy.lede,
  })
}
