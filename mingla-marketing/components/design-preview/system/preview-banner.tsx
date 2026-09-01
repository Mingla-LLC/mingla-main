'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// #2902 — a permanent, non-dismissible marker that this route is a review
// prototype, plus a switch between the matched Explorer and Host surfaces.
//
// PINNED TO THE BOTTOM, deliberately. The top of both pages is where the real
// GlassNav floats over the hero — the exact region Seth is reviewing and
// screenshotting. A top banner would both fight the fixed nav's own offset and
// contaminate every hero capture. At the bottom it is always visible, always
// reachable, and never in a hero frame.

const PAIR = [
  { href: '/cutout/explorer', label: 'Explorer' },
  { href: '/cutout/host', label: 'Host' },
  { href: '/cutout/host/event-organizers-promoters', label: 'Landing page' },
]

export function PreviewBanner() {
  const pathname = usePathname()

  return (
    <div
      data-theme="dark"
      className="fixed inset-x-0 bottom-0 z-[60] flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-white/10 bg-ink/95 px-4 py-2 text-center backdrop-blur-md"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warm">
        #2902 Cutout foundation — not the live site
      </span>
      <nav aria-label="Design preview surfaces" className="flex items-center gap-2">
        {PAIR.map((p) => {
          const active = pathname === p.href
          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'rounded-full bg-warm px-3 py-1 text-[11px] font-semibold text-white focus-ring'
                  : 'rounded-full px-3 py-1 text-[11px] font-semibold text-white/60 underline-offset-2 hover:text-white hover:underline focus-ring'
              }
            >
              {p.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
