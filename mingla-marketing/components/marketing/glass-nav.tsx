'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SurfaceToggle } from '@/components/marketing/surface-toggle'
import { BetaAccessModal } from '@/components/marketing/beta-access-modal'
import { cn } from '@/lib/cn'

export function GlassNav() {
  const pathname = usePathname()
  const surface: 'explorer' | 'organiser' = pathname.startsWith('/organisers')
    ? 'organiser'
    : 'explorer'

  const homeHref = surface === 'organiser' ? '/organisers' : '/'

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

  // ORCH-1045 — organiser-only "Get Beta Access" CTA opens the 3-step lead modal.
  const [betaOpen, setBetaOpen] = useState(false)

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

          {/* CTA — branches by surface (ORCH-1045).
              explorer: NG-1 keeps the dead "Get the app" button intentionally —
              do not wire (operator-locked, out of scope).
              organiser: "Get Beta Access" opens the 3-step lead modal. */}
          {surface === 'organiser' ? (
            <Button
              variant="glass"
              size="sm"
              onClick={() => setBetaOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={betaOpen}
            >
              Get Beta Access
            </Button>
          ) : (
            <Button variant="glass" size="sm">
              Get the app
            </Button>
          )}
        </div>
      </header>

      {/* organiser-only — explorer never mounts the modal (I-1045-ORGANISER-ONLY-CTA) */}
      {surface === 'organiser' ? (
        <BetaAccessModal
          open={betaOpen}
          onClose={() => setBetaOpen(false)}
          source="organiser_marketing_nav"
        />
      ) : null}
    </>
  )
}
