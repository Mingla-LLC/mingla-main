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
import { detectClientPlatform, type Platform } from '@/lib/device-platform'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/store-links'
import {
  BUSINESS_APP_CHOICE_COPY,
  resolveBusinessAppTarget,
} from '@/lib/business-app-target'

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
  const businessTarget = resolveBusinessAppTarget(businessPlatform)

  // ORCH-1319 — device-aware "Get the app" action. Runs only on a real browser
  // click (detectClientPlatform is SSR-safe → 'other' when navigator is absent).
  const handleGetTheApp = (): void => {
    const platform = detectClientPlatform()
    if (platform === 'ios' || platform === 'android') {
      const store = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL
      captureMarketing('get_the_app_clicked', {
        platform,
        store: platform === 'ios' ? 'app_store' : 'play',
        location: 'nav',
      })
      // Popup-blocked (window.open → null) → same-tab navigation fallback.
      const win = window.open(store, '_blank', 'noopener,noreferrer')
      if (!win) window.location.assign(store)
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
  const openBusinessDest = (dest: string): void => {
    // Popup-blocked (window.open → null) → same-tab navigation fallback.
    const win = window.open(dest, '_blank', 'noopener,noreferrer')
    if (!win) window.location.assign(dest)
  }

  const handleDownloadTheBusinessApp = (): void => {
    const platform = detectClientPlatform()
    const target = resolveBusinessAppTarget(platform)
    if (target.installHref === null) return
    captureMarketing('get_the_app_clicked', {
      action: 'download',
      platform,
      store: target.installStore,
      surface: 'organiser',
      location: 'nav',
    })
    openBusinessDest(target.installHref)
  }

  const handleUseBusinessOnWeb = (): void => {
    const platform = detectClientPlatform()
    const target = resolveBusinessAppTarget(platform)
    captureMarketing('get_the_app_clicked', {
      action: 'use_web',
      platform,
      store: 'business_web',
      surface: 'organiser',
      location: 'nav',
    })
    openBusinessDest(target.webHref)
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
              plain Mingla wordmark on the explorer surface. */}
          <Link
            href={homeHref}
            aria-label={surface === 'organiser' ? 'Mingla Business home' : 'Mingla home'}
            className="inline-flex items-center gap-2 rounded-md px-0.5 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring"
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
              organiser (ORCH-1381): an explicit inline CHOICE — "Download the app"
                (iOS → business App Store, Android → business Play) + "Use on web".
                Desktop/other can install nothing, so ONLY the web action renders —
                never a dead install button. Both NAVIGATE (no dialog) so no
                aria-haspopup. The app-does-more note is deliberately omitted here:
                the nav is a shortcut with no room for it; the hero, /links and
                /business/download surfaces carry it.
              explorer: "Get the app" is a device-aware direct store action (ORCH-1319). */}
          {surface === 'organiser' ? (
            <div className="flex items-center gap-2">
              {businessTarget.canInstall ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleDownloadTheBusinessApp}
                >
                  {BUSINESS_APP_CHOICE_COPY.download}
                </Button>
              ) : null}
              <Button
                variant="glass"
                size="sm"
                onClick={handleUseBusinessOnWeb}
              >
                {BUSINESS_APP_CHOICE_COPY.useWeb}
              </Button>
            </div>
          ) : (
            // ORCH-1319 — explorer "Get the app" is a device-aware DIRECT action:
            // iOS → App Store, Android → Play, desktop/other → QR panel. The
            // aria-haspopup/aria-expanded stay set (the button CAN open a dialog;
            // the phone branches simply never open it).
            <Button
              variant="glass"
              size="sm"
              onClick={handleGetTheApp}
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
