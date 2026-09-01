'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Info, MapPin, Newspaper, Store } from 'lucide-react'
import { FloatingDock, type DockItem } from '@/components/ui/floating-dock'
import { DeviceCta, type CutoutSurface } from './device-cta'

// ---------------------------------------------------------------
// #2902 — Cutout nav. NO HEADER BAR.
//
// Seth's correction: the header container is gone. The three elements —
// wordmark, dock, action — now float independently over the hero, each one a
// moulded cut-out surface in its own right, each keeping its own animation.
// There is no strip behind them tying them together.
//
// Two other rules held here:
//   - The logo is ALWAYS the plain Mingla wordmark. It never swaps to the Host
//     lockup, so the brand does not change identity between surfaces.
//   - The menu carries icons AND labels, on desktop and on mobile, so nobody
//     has to hover to learn what anything is.
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
  /** Bottom offset for the mobile dock (clears the preview bar). */
  mobileDockOffset?: string
}

export function CutoutNav({ surface, homeHref, mobileDockOffset }: CutoutNavProps) {
  const pathname = usePathname()

  const items: DockItem[] = LINKS.map(({ href, label, Icon }) => ({
    href,
    title: label,
    active: pathname === href || pathname.startsWith(`${href}/`),
    icon: <Icon className="h-full w-full" strokeWidth={1.9} aria-hidden="true" />,
  }))

  return (
    <>
      {/* Floating elements — no bar. `pointer-events-none` on the rail so the
          gaps between the three surfaces do not swallow clicks on the hero. */}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 px-4 sm:px-6"
        style={{ top: 'max(0.875rem, env(safe-area-inset-top))' }}
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

          <div className="pointer-events-auto mx-auto hidden md:block">
            <FloatingDock items={items} label="Primary" />
          </div>

          <div className="pointer-events-auto ml-auto md:ml-0">
            <DeviceCta
              surface={surface}
              location="nav"
              variant="ink"
              size="md"
              withArrow={false}
            />
          </div>
        </div>
      </div>

      {/* Mobile: the same dock, same icons and labels, at the bottom. */}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3 md:hidden"
        style={{ bottom: mobileDockOffset ?? 'max(0.875rem, env(safe-area-inset-bottom))' }}
      >
        <div className="pointer-events-auto w-full max-w-md">
          <FloatingDock items={items} label="Primary" stacked />
        </div>
      </div>
    </>
  )
}
