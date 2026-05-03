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

  return (
    <header className="fixed left-4 right-4 top-4 z-50 mx-auto max-w-6xl">
      <div className="flex items-center justify-between gap-3">
        {/* Logo capsule */}
        <Link
          href={homeHref}
          aria-label="Mingla home"
          className="glass-soft inline-flex h-10 items-center gap-2 rounded-full px-4 transition-all duration-200 ease-out-quart hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 active:brightness-100 focus-ring"
        >
          <span className="font-display text-base font-semibold tracking-[-0.02em] text-text-primary">
            Mingla
          </span>
          {surface === 'organiser' ? (
            <span className="rounded-full bg-warm/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-warm">
              Business
            </span>
          ) : null}
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
