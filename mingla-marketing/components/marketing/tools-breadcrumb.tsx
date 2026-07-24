'use client'
// #1148 [Growth tools breadcrumb] — the step-by-step trail back up the funnel.
//
// Mounted in app/tools/layout.tsx so it covers EVERY /tools page (hub, each tool,
// and the token-gated report pages) automatically. Derives the trail from the
// pathname, always rooted at the business page:
//
//   Mingla Business › Free tools › <this tool> [› Your report]
//
// Each ancestor is a link (all the way back to /business); the current page is
// plain text with aria-current. Client component — it reads usePathname().

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Human labels for the /tools path segments. Anything unmapped falls back to the
// raw segment (so a new tool still renders a sensible crumb before it's added).
const SEGMENT_LABELS: Record<string, string> = {
  tools: 'Free tools',
  venues: 'Venue Grader',
  events: 'Event Predictor',
  trips: 'Quote Any Trip',
  pricing: 'Undercharging Audit',
  report: 'Your report',
}

interface Crumb {
  label: string
  href: string
}

export function ToolsBreadcrumb() {
  const pathname = usePathname() || '/tools'
  // Only build crumbs for /tools/* paths; the layout only wraps those anyway.
  const segments = pathname.split('/').filter(Boolean)
  const toolsIndex = segments.indexOf('tools')
  const relevant = toolsIndex === -1 ? segments : segments.slice(toolsIndex)

  const crumbs: Crumb[] = [{ label: 'Mingla Business', href: '/business' }]
  let acc = ''
  for (const seg of relevant) {
    acc += `/${seg}`
    crumbs.push({ label: SEGMENT_LABELS[seg] ?? seg, href: acc })
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="mx-auto mt-4 max-w-6xl px-6 md:px-10 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]"
    >
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1
          return (
            <li key={crumb.href} className="flex items-center gap-1.5">
              {isLast ? (
                <span aria-current="page" className="font-semibold text-white/70">
                  {crumb.label}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="rounded-sm text-white/50 transition hover:text-white/85 focus-ring"
                >
                  {crumb.label}
                </Link>
              )}
              {!isLast ? (
                <span aria-hidden="true" className="text-white/25">
                  ›
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
