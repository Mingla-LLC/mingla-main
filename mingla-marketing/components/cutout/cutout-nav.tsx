'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Info, MapPin, Newspaper, Store } from 'lucide-react'
import { cn } from '@/lib/cn'
import { FloatingDock, type DockItem } from '@/components/ui/floating-dock'
import { DeviceCta, type CutoutSurface } from './device-cta'

// ---------------------------------------------------------------
// #2902 — Cutout nav.
//
// Two corrections from Seth are load-bearing here:
//
//  1. THE LOGO IS ALWAYS THE PLAIN MINGLA WORDMARK. It no longer swaps to the
//     Mingla Host lockup on the Host surface. One constant mark across every
//     page, so the brand does not change identity as you move between
//     Explorer and Host.
//  2. THE MENU IS A DOCK. On desktop it sits in the header and magnifies under
//     the cursor. On mobile it is the SAME dock, pinned to the bottom of the
//     viewport — not a hamburger sheet.
//
// The single device-aware action still overhangs the bar's right edge, which
// is the header's cut-out.
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
  /** Extra bottom offset for the mobile dock (clears the preview bar). */
  mobileDockOffset?: string
}

export function CutoutNav({ surface, homeHref, mobileDockOffset }: CutoutNavProps) {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const items: DockItem[] = LINKS.map(({ href, label, Icon }) => ({
    href,
    title: label,
    active: pathname === href || pathname.startsWith(`${href}/`),
    icon: <Icon className="h-full w-full" strokeWidth={1.9} aria-hidden="true" />,
  }))

  return (
    <>
      <header
        className="fixed inset-x-0 z-50 px-3 sm:px-6"
        style={{ top: 'max(0.875rem, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto max-w-6xl">
          <div
            className={cn(
              'relative flex items-center gap-3 rounded-full py-2 pl-5 pr-2 sm:pl-7',
              'transition-all duration-300 ease-out-quart',
            )}
            style={{
              background: scrolled
                ? 'rgba(253,251,248,0.94)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(250,247,242,0.86) 100%)',
              backdropFilter: 'blur(20px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
              boxShadow: 'var(--cut-mould)',
            }}
          >
            {/* One constant mark. Never the Host lockup. */}
            <Link
              href={homeHref}
              aria-label="Mingla home"
              className="inline-flex shrink-0 items-center rounded-md py-1 focus-ring"
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

            {/* Desktop dock, centred. The mobile half of <FloatingDock> is
                hidden here and pinned to the viewport bottom below instead. */}
            <div className="ml-auto mr-auto hidden md:block">
              <FloatingDock items={items} label="Primary" mobileClassName="hidden" />
            </div>

            <div className="ml-auto md:ml-0">
              <DeviceCta
                surface={surface}
                location="nav"
                variant="ink"
                size="md"
                withArrow={false}
                className="-mr-1"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Mobile: the same dock, at the bottom of the screen. */}
      <div
        className="fixed inset-x-0 z-50 flex justify-center px-3 md:hidden"
        style={{ bottom: mobileDockOffset ?? 'max(0.875rem, env(safe-area-inset-bottom))' }}
      >
        <FloatingDock items={items} label="Primary" desktopClassName="hidden" />
      </div>
    </>
  )
}
