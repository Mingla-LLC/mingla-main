'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DeviceCta, type CutoutSurface } from './device-cta'

// ---------------------------------------------------------------
// #2902 — the Cutout nav.
//
// AIgocy's signature header move: a floating translucent PILL, with the primary
// action rendered as a dark pill that OVERHANGS the bar's right edge instead of
// sitting inside it. That overhang is the same cut-out grammar as the icon
// tiles further down the page, applied to navigation — which is what makes the
// header feel part of the system rather than bolted on top of it.
//
// The action is the shared <DeviceCta>, so the header CTA resolves by device
// through exactly the same code path as every in-section CTA. There is no
// second decision here to drift.
// ---------------------------------------------------------------

const LINKS = [
  { href: '/explorer', label: 'Explorer' },
  { href: '/host', label: 'Host' },
  { href: '/cities', label: 'Cities' },
  { href: '/blog', label: 'Blog' },
  { href: '/about', label: 'About' },
]

interface CutoutNavProps {
  surface: CutoutSurface
  /** Where the wordmark links back to. */
  homeHref: string
}

export function CutoutNav({ surface, homeHref }: CutoutNavProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close the mobile sheet on navigation, or the menu survives the route change.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header
      className="fixed inset-x-0 z-50 px-3 sm:px-6"
      style={{ top: 'max(0.875rem, env(safe-area-inset-top))' }}
    >
      <div className="mx-auto max-w-6xl">
        {/* The bar. `pr-1.5` leaves exactly the gap the overhanging CTA sits in. */}
        <div
          className={cn(
            'relative flex items-center gap-2 rounded-full py-2 pl-5 pr-2 sm:pl-7',
            'transition-all duration-300 ease-out-quart',
          )}
          // At rest the bar was rgba(250,248,244,0.58) on a #faf8f4 shell —
          // invisible — and its backdrop-filter smeared the warm eyebrow behind
          // it into an orange blur. Both were only visible on a built page.
          // The pill now sits ABOVE the shell in tone (white, not parchment) and
          // blurs only once there is content behind it worth blurring.
          // Moulded like every other surface: inset top light, inset bottom
          // band, soft drop. AIgocy's nav is a floating physical pill, not a
          // translucent strip.
          style={{
            background: scrolled
              ? 'rgba(253,251,248,0.94)'
              : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(250,247,242,0.86) 100%)',
            backdropFilter: 'blur(20px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
            boxShadow: 'var(--cut-mould)',
          }}
        >
          <Link
            href={homeHref}
            aria-label={surface === 'host' ? 'Mingla Host home' : 'Mingla home'}
            className="inline-flex shrink-0 items-center rounded-md py-1 focus-ring"
          >
            {surface === 'host' ? (
              <img
                src="/brand/mingla-business-logo.png"
                alt="Mingla Host"
                width={148}
                height={148}
                className="h-12 w-12 scale-[1.5] select-none sm:h-14 sm:w-14"
                draggable={false}
              />
            ) : (
              <img
                src="/brand/mingla-wordmark.svg"
                alt="Mingla"
                width={110}
                height={28}
                className="h-6 w-auto select-none sm:h-7"
                draggable={false}
              />
            )}
          </Link>

          {/* The menu is a TABBED control, not a row of links: one sunken
              track with the active item raised out of it as a moulded pill.
              Same cut-out grammar as the cards. */}
          <nav
            aria-label="Primary"
            className="ml-5 hidden items-center gap-1 rounded-full p-1 lg:flex"
            style={{ background: 'var(--cut-card-sunken)' }}
          >
            {LINKS.map((l) => {
              const active = pathname === l.href || pathname.startsWith(`${l.href}/`)
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-full px-4 py-2 text-[0.9375rem] font-medium transition-all duration-300 focus-ring',
                    active
                      ? 'cut-btn cut-btn-light text-[var(--cut-ink)]'
                      : 'text-[var(--cut-body)] hover:text-[var(--cut-ink)]',
                  )}
                >
                  {l.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* The overhang. -mr-1 pulls the pill past the bar's padding box and
                its own shadow lifts it off the bar — the header's cut-out. */}
            <DeviceCta
              surface={surface}
              location="nav"
              variant="ink"
              size="md"
              withArrow={false}
              className="-mr-1 hidden sm:inline-flex"
            />
            <button
              type="button"
              aria-expanded={open}
              aria-controls="cutout-mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--cut-ink)] text-[var(--cut-shell)] shadow-[var(--cut-shadow-tile)] focus-ring lg:hidden"
            >
              {open ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile sheet — a card in the same grammar, not a full-screen takeover. */}
        {open ? (
          <div
            id="cutout-mobile-nav"
            className="cut-card mt-2 overflow-hidden p-2 lg:hidden"
          >
            <nav aria-label="Primary mobile" className="flex flex-col">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-2xl px-4 py-3.5 text-base font-medium text-[var(--cut-ink)] transition-colors hover:bg-[var(--cut-card-sunken)] focus-ring"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
            <div className="p-2 pt-3 sm:hidden">
              <DeviceCta
                surface={surface}
                location="nav_mobile"
                variant="primary"
                size="md"
                className="w-full"
              />
            </div>
          </div>
        ) : null}
      </div>
    </header>
  )
}
