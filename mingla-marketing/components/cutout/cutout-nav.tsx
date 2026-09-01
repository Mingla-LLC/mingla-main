'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Compass, Info, MapPin, Menu, Newspaper, Store } from 'lucide-react'
import { FloatingDock, type DockItem } from '@/components/ui/floating-dock'
import { SideMenu } from '@/components/ui/side-menu'
import { DeviceCta, type CutoutSurface } from './device-cta'

// ---------------------------------------------------------------
// #2902 — Cutout nav. No header bar; the elements float.
//
//   desktop → the floating dock, icons and labels, magnifying on hover
//   mobile  → a side menu, opened from a floating button. The bottom dock is
//             gone per Seth.
//
// The action pill is the SAME tint as the wordmark's pill, so the two floating
// surfaces read as a pair rather than as a light thing and a dark thing.
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
  /** Explorer moves its action beneath the deck, so the nav drops it. */
  showAction?: boolean
}

export function CutoutNav({ surface, homeHref, showAction = true }: CutoutNavProps) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  const items: DockItem[] = LINKS.map(({ href, label, Icon }) => ({
    href,
    title: label,
    active: pathname === href || pathname.startsWith(`${href}/`),
    icon: <Icon className="h-full w-full" strokeWidth={1.9} aria-hidden="true" />,
  }))

  return (
    <>
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

          <div className="pointer-events-auto ml-auto flex items-center gap-2 md:ml-0">
            {showAction ? (
              <DeviceCta
                surface={surface}
                location="nav"
                variant="quiet"
                size="md"
                withArrow={false}
              />
            ) : null}

            {/* Mobile opens the side menu; the bottom dock is gone. */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
              className="cut-btn cut-btn-light flex h-12 w-12 items-center justify-center rounded-full focus-ring md:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Primary mobile" className="flex flex-col gap-1.5">
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
