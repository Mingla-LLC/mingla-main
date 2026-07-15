'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SurfaceToggle } from '@/components/marketing/surface-toggle'
import { AppQrPanel } from '@/components/marketing/app-qr-panel'
import { cn } from '@/lib/cn'
import { captureMarketing } from '@/components/marketing/posthog-provider'
// ORCH-1319 — the explorer "Get the app" CTA is now a device-aware DIRECT action:
// iOS → App Store, Android → Play, desktop/other → the QR panel. No lead form.
// ORCH-1381 — the organiser surface no longer guesses: it presents an explicit
// inline CHOICE (Download the app / Use on web). The platform→destination decision
// comes from the shared lib/business-app-target.ts helper — never re-derived here.
// ORCH-1382 — every STORE / web destination in this nav is now a real <a href>
// pointing at the ATTRIBUTED OneLink (which 301s straight to market:// / the App
// Store, so no intermediate store web page renders and the install carries pid/c).
// The explorer DESKTOP branch still opens the QR PANEL — it navigates nowhere, so it
// correctly stays a <button>, and openExternal is no longer needed in this file.
// ⚠ rel="noopener" on an <a> is REQUIRED and is NOT the ORCH-1381 window.open
// pathology (that ban is scoped to .open( FEATURE STRINGS). Never strip it.
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import {
  BUSINESS_APP_CHOICE_COPY,
  resolveBusinessAppTarget,
} from '@/lib/business-app-target'
import { resolveExplorerAppTarget } from '@/lib/explorer-app-target'
import { siteAttribution } from '@/lib/links-src'
import { buttonClasses } from '@/components/ui/button'

export function GlassNav() {
  const pathname = usePathname()
  const surface: 'explorer' | 'organiser' = pathname.startsWith('/business')
    ? 'organiser'
    : 'explorer'

  const homeHref = surface === 'organiser' ? '/business' : '/'

  // ORCH-1010 — the logo + toggle + CTA float over the hero with NO background.
  // Once the page scrolls off the hero, a frosted band fades in behind the nav
  // area so the logo color + "Get the app" CTA gain contrast against the light
  // content below (operator directive — replaces the always-on scroll-pill).
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ORCH-1319 — explorer-only "Get the app" CTA. Phones go straight to their
  // store; desktop/other opens this QR panel (no more lead form / beta gate).
  const [qrOpen, setQrOpen] = useState(false)

  // ORCH-1381 — the RENDERED business choice is device-aware, so it must resolve
  // AFTER mount: `detectClientPlatform()` reads navigator, which does not exist
  // during SSR. Seeding 'other' means the server HTML and the first client render
  // agree (web-action-only — the safe treatment), then the effect swaps in the real
  // platform. Rendering the platform directly would hydration-mismatch.
  // NOTE: the click HANDLERS deliberately re-read detectClientPlatform() fresh
  // rather than trust this state, so a tap can never resolve a stale platform.
  const [businessPlatform, setBusinessPlatform] = useState<Platform>('other')
  useEffect(() => {
    setBusinessPlatform(detectClientPlatform())
  }, [])
  // ORCH-1382 — both targets resolve an ATTRIBUTED OneLink href that is rendered
  // into a real <a href>, so they must resolve during render, not on the tap.
  const businessTarget = resolveBusinessAppTarget(businessPlatform, siteAttribution('business_nav'))
  const explorerTarget = resolveExplorerAppTarget(businessPlatform, siteAttribution('explorer_nav'))

  // ORCH-1319 — device-aware "Get the app". ORCH-1382: on a PHONE this is now an
  // <a href> to the Explorer OneLink and this handler only TRACKS. Desktop/other has
  // no store app, so it still opens the QR PANEL — which navigates nowhere and is
  // therefore correctly a <button>, not a link.
  const handleGetTheAppTrack = (): void => {
    const platform = detectClientPlatform()
    if (platform === 'ios' || platform === 'android') {
      captureMarketing('get_the_app_clicked', {
        platform,
        store: platform === 'ios' ? 'app_store' : 'play',
        location: 'nav',
      })
      return
    }
    // Desktop / other → the QR panel.
    captureMarketing('get_the_app_clicked', {
      platform: 'other',
      store: 'qr_panel',
      location: 'nav',
    })
    setQrOpen(true)
  }

  // ORCH-1381 — the business surface presents an explicit inline CHOICE instead of
  // guessing: "Download the app" (iOS → the live business App Store, Android → the
  // LIVE business Play listing) and "Use on web". Desktop/other has nothing to
  // install, so only the web action renders (no dead button). No QR panel, no beta
  // funnel. Both actions run only on a real browser click (SSR-safe:
  // detectClientPlatform returns 'other' when navigator is absent).
  //
  // The `action` prop is REQUIRED: without it an Android owner who CHOOSES web is
  // indistinguishable from ORCH-1324's forced-web, and the fix is unmeasurable.
  // ORCH-1382 — these now TRACK only; the anchors below perform the navigation.
  const handleDownloadTheBusinessApp = (): void => {
    const platform = detectClientPlatform()
    const target = resolveBusinessAppTarget(platform, siteAttribution('business_nav'))
    if (target.installHref === null) return
    captureMarketing('get_the_app_clicked', {
      action: 'download',
      platform,
      store: target.installStore,
      surface: 'organiser',
      location: 'nav',
    })
  }

  const handleUseBusinessOnWeb = (): void => {
    const platform = detectClientPlatform()
    captureMarketing('get_the_app_clicked', {
      action: 'use_web',
      platform,
      store: 'business_web',
      surface: 'organiser',
      location: 'nav',
    })
  }

  return (
    <>
      {/* Frosted header band — fades in on scroll for logo/CTA contrast. */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none fixed inset-x-0 top-0 z-40 h-28 border-b transition-opacity duration-300 ease-out',
          scrolled ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          backdropFilter: 'blur(18px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
          background: 'rgba(250, 247, 242, 0.62)',
          borderColor: 'rgba(14, 14, 16, 0.06)',
          boxShadow: '0 1px 24px rgba(14,14,16,0.05)',
          maskImage: 'linear-gradient(to bottom, #000 62%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, #000 62%, transparent)',
        }}
      />

      <header
        className="fixed inset-x-0 top-4 z-50 px-4"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          {/* Logo — official Mingla Business lockup on the business surface,
              plain Mingla wordmark on the explorer surface.

              ORCH-1381 ADDENDUM D-A-2 — `shrink-0` is LOAD-BEARING, not cosmetic.
              Without it the logo is a shrinkable flex item, so it silently absorbed
              every bit of nav overcrowding by squashing itself (84px → 30px at
              `text-sm`, → ~0 and INVISIBLE under plain nowrap). That is why no
              automated width check ever caught the nav overflow: the bar could not
              fail a width check, it just destroyed the brand instead. Pinned, the
              bar's real width demand becomes measurable — which is what proved the
              logo + BOTH pinned-copy pills cannot fit at 360px (hence the
              one-action mobile nav below). */}
          <Link
            href={homeHref}
            aria-label={surface === 'organiser' ? 'Mingla Business home' : 'Mingla home'}
            className="inline-flex shrink-0 items-center gap-2 rounded-md px-0.5 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring"
          >
            {surface === 'organiser' ? (
              <img
                src="/brand/mingla-business-logo.png"
                alt="Mingla Business"
                className="h-20 w-20 select-none"
                draggable={false}
              />
            ) : (
              <img
                src="/brand/mingla-wordmark.svg"
                alt="Mingla"
                className="h-7 w-auto select-none"
                draggable={false}
              />
            )}
          </Link>

          {/* Surface toggle (already wraps itself in glass) */}
          <div className="hidden md:block">
            <SurfaceToggle />
          </div>

          {/* CTA — branches by surface.
              organiser (ORCH-1381): "Download the app" (iOS → business App Store,
                Android → business Play) + "Use on web". Desktop/other can install
                nothing, so ONLY the web action renders — never a dead install
                button. Both NAVIGATE (no dialog) so no aria-haspopup. The
                app-does-more note is deliberately omitted here: the nav is a
                shortcut with no room for it; the hero, /links and /business/download
                surfaces carry it.

              ORCH-1381 ADDENDUM D-A-2 (Seth's OQ-1 ruling = option B) — on a PHONE
                the nav shows exactly ONE action. PROVEN geometrically: with the logo
                pinned at its natural 84px (see `shrink-0` above), the 328px bar at
                360px CANNOT hold the logo + both pinned-copy pills at ANY text size —
                not even 12px text with 8px padding (measured: 334px, still 6px over).
                Both labels wrapped to 2 lines and spilled past the pill edges at 360,
                375 AND 412 — every Android width. One action + nowrap fits in exactly
                328/328 at full 16px text with the brand intact.
                This EXTENDS the nav's own stated intent (the comment above: "the nav
                is a shortcut with no room for it") from the note to the second
                action — it is consistent, not a new concession. The HERO keeps the
                full two-action choice + the note, so nothing is lost.
                The copy is CI-pinned and code-verified: we fix the container, never
                the words.
              explorer: "Get the app" is a device-aware direct store action (ORCH-1319). */}
          {surface === 'organiser' ? (
            <div className="flex items-center gap-2">
              {businessTarget.canInstall && businessTarget.installHref !== null ? (
                <>
                  {/* ORCH-1382 — a real <a> to the attributed business OneLink. It
                      uses buttonClasses(), the SAME recipe <Button> consumes, so it
                      is pixel-identical to the pill it replaces by construction. */}
                  <a
                    href={businessTarget.installHref}
                    target="_blank"
                    rel="noopener"
                    onClick={handleDownloadTheBusinessApp}
                    className={buttonClasses({
                      variant: 'primary',
                      size: 'sm',
                      className: 'whitespace-nowrap',
                    })}
                  >
                    {BUSINESS_APP_CHOICE_COPY.download}
                  </a>
                  {/* The second action is the one that does not fit next to the logo
                      on a phone. It returns at `sm` (640px), where there is room —
                      so desktop/tablet keep the full inline choice. */}
                  <a
                    href={businessTarget.webHref}
                    target="_blank"
                    rel="noopener"
                    onClick={handleUseBusinessOnWeb}
                    className={buttonClasses({
                      variant: 'glass',
                      size: 'sm',
                      className: 'hidden whitespace-nowrap sm:inline-flex',
                    })}
                  >
                    {BUSINESS_APP_CHOICE_COPY.useWeb}
                  </a>
                </>
              ) : (
                // Nothing to install (desktop/unknown) → the web action is the ONLY
                // action, so it always renders. This branch is unchanged by D-A-2.
                <a
                  href={businessTarget.webHref}
                  target="_blank"
                  rel="noopener"
                  onClick={handleUseBusinessOnWeb}
                  className={buttonClasses({
                    variant: 'glass',
                    size: 'sm',
                    className: 'whitespace-nowrap',
                  })}
                >
                  {BUSINESS_APP_CHOICE_COPY.useWeb}
                </a>
              )}
            </div>
          ) : explorerTarget.canInstall && explorerTarget.installHref !== null ? (
            // ORCH-1319/1382 — explorer PHONE: a real <a> to the attributed Explorer
            // OneLink, which 301s to the right store with no intermediate web page.
            // No aria-haspopup here: this branch navigates and can never open the QR
            // dialog, so advertising a popup would be a lie to screen readers.
            <a
              href={explorerTarget.installHref}
              target="_blank"
              rel="noopener"
              onClick={handleGetTheAppTrack}
              className={buttonClasses({ variant: 'glass', size: 'sm' })}
            >
              Get the app
            </a>
          ) : (
            // Explorer DESKTOP/other → the QR PANEL. This opens a dialog and
            // navigates nowhere, so it is correctly a <button> and keeps its
            // aria-haspopup/aria-expanded.
            <Button
              variant="glass"
              size="sm"
              onClick={handleGetTheAppTrack}
              aria-haspopup="dialog"
              aria-expanded={qrOpen}
            >
              Get the app
            </Button>
          )}
        </div>
      </header>

      {/* explorer-only — ORCH-1319 desktop QR panel (no lead form / beta gate).
          The organiser surface never mounts it. ORCH-1324 removed the organiser
          beta lead-modal mount — the business CTA now navigates device-aware. */}
      {surface === 'explorer' ? (
        <AppQrPanel open={qrOpen} onClose={() => setQrOpen(false)} />
      ) : null}
    </>
  )
}
