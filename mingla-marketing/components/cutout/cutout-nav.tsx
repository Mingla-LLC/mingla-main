'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Info, MapPin, Menu, Newspaper, Store } from 'lucide-react'
import { SideMenu } from '@/components/ui/side-menu'
import { DeviceCta, type CutoutSurface } from './device-cta'

// ---------------------------------------------------------------
// #2902 — Cutout nav. No bar, no dock.
//
// The floating dock is gone: the side panel is now the only menu, at every
// width, so there is one navigation model rather than two doing the same job.
// What floats over the hero is three separate moulded surfaces — wordmark,
// action, menu button — with nothing tying them together.
//
// BREATHING ROOM AND CONCENTRIC CURVES. The shell's corner radius is 40px and
// it sits 12px inside the viewport. Elements pinned at 14px were only ~2px off
// the shell's edge, fouling that corner. They now sit 28px from the viewport,
// i.e. 16px inside the shell — which is 40px minus a pill's own ~24px radius,
// so the pill's curve runs concentric with the shell's instead of cutting
// across it. The horizontal inset matches for the same reason.
// ---------------------------------------------------------------

const LINKS = [
  { href: '/explorer', label: 'Explorer', Icon: Compass },
  { href: '/host', label: 'Host', Icon: Store },
  { href: '/cities', label: 'Cities', Icon: MapPin },
  { href: '/blog', label: 'Blog', Icon: Newspaper },
  { href: '/about', label: 'About', Icon: Info },
]

interface CutoutNavProps {
  surface: CutoutSurface
  homeHref: string
  /** Explorer moves its action beneath the headline, so the nav drops it. */
  showAction?: boolean
}

export function CutoutNav({ surface, homeHref, showAction = true }: CutoutNavProps) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 z-50 px-5 sm:px-7"
        style={{ top: 'max(1.75rem, calc(env(safe-area-inset-top) + 0.75rem))' }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Link
            href={homeHref}
            aria-label="Mingla home"
            className="cut-card pointer-events-auto inline-flex shrink-0 items-center rounded-full px-5 py-3 focus-ring"
          >
            <img
              src="/brand/mingla-wordmark.svg"
              alt="Mingla"
              width={110}
              height={28}
              className="h-6 w-auto select-none sm:h-7"
              draggable={false}
            />
          </Link>

          <div className="pointer-events-auto ml-auto flex items-center gap-2.5">
            {/* Hidden below `sm`: with three marks and a constant label the
                pill is ~190px, and a 390px bar cannot hold the wordmark, this
                and the menu button. The side panel carries the action there. */}
            {showAction ? (
              <DeviceCta
                surface={surface}
                location="nav"
                variant="quiet"
                size="md"
                className="hidden sm:inline-flex"
              />
            ) : null}

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="cut-btn cut-btn-light flex h-12 w-12 items-center justify-center rounded-full focus-ring"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Primary" className="flex flex-col gap-1.5">
          {LINKS.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
                className={
                  active
                    ? 'cut-btn cut-btn-brand flex min-h-14 items-center gap-3.5 rounded-2xl px-5 font-display text-base text-white focus-ring'
                    : 'flex min-h-14 items-center gap-3.5 rounded-2xl px-5 font-display text-base text-[var(--cut-ink)] transition-colors hover:bg-[var(--cut-card-sunken)] focus-ring'
                }
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                {label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto pt-8">
          <DeviceCta
            surface={surface}
            location="side_menu"
            variant="primary"
            size="lg"
            className="w-full"
          />
        </div>
      </SideMenu>
    </>
  )
}
