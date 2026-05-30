'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { SurfaceToggle } from '@/components/marketing/surface-toggle'

export function GlassNav() {
  const pathname = usePathname()
  const surface: 'explorer' | 'organiser' = pathname.startsWith('/organisers')
    ? 'organiser'
    : 'explorer'

  const homeHref = surface === 'organiser' ? '/organisers' : '/'

  // ORCH-1010 — no top bar. The logo + toggle + CTA float over the page; there
  // is no scroll-pill / glass bar background (operator directive).
  return (
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
              src="/brand/mingla-business-logo.svg"
              alt="Mingla Business"
              className="h-14 w-14 select-none"
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
