'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SurfaceToggle } from '@/components/marketing/surface-toggle'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

export function GlassNav() {
  const pathname = usePathname()
  const reduced = useMinglaReducedMotion()
  const surface: 'explorer' | 'organiser' = pathname.startsWith('/organisers')
    ? 'organiser'
    : 'explorer'

  const homeHref = surface === 'organiser' ? '/organisers' : '/'

  // ORCH-1010 — scroll-pill polish: once content scrolls under the floating
  // header, wrap the bar in a glass-soft rounded container so it reads as a
  // floating pill (Linear/Vercel pattern) instead of bare logo + CTA on the
  // page. Reduced-motion → no scroll-driven fade transition (state still flips,
  // but transition is suppressed by the global reduced-motion media query).
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className="fixed inset-x-0 top-4 z-50 px-4"
      style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
    >
      <div
        className={cn(
          'mx-auto flex max-w-6xl items-center justify-between gap-3 rounded-full transition-all duration-200 ease-out-quart',
          scrolled ? 'glass-soft px-2' : 'px-0',
        )}
        style={scrolled && !reduced ? { boxShadow: 'var(--elev-1)' } : undefined}
      >
        {/* Logo — official Mingla Business lockup on the business surface,
            plain Mingla wordmark on the explorer surface. */}
        <Link
          href={homeHref}
          aria-label={surface === 'organiser' ? 'Mingla Business home' : 'Mingla home'}
          className="inline-flex h-10 items-center gap-2 rounded-md px-0.5 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring"
        >
          {surface === 'organiser' ? (
            <img
              src="/brand/mingla-business-logo.svg"
              alt="Mingla Business"
              className="h-10 w-10 select-none"
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

        {/* CTA — same label across surfaces (organiser has its own app too) */}
        <Button variant="glass" size="sm">
          Get the app
        </Button>
      </div>
    </header>
  )
}
