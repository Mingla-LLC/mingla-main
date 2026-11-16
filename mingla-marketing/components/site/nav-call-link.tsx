'use client'

// #4452 §2.11 — "Book a 20-min call" in the top bar, routed by audience.
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { callHrefFor, type CallAudience } from '@/lib/cta-destination'
import { captureMarketing } from '@/components/marketing/marketing-capture'

export function NavCallLink({ audience, origin }: { audience?: CallAudience | null; origin?: string }) {
  const pathname = usePathname() ?? '/'
  const call = callHrefFor(pathname, audience)
  const href = origin ? `${origin}${call.href}` : call.href
  return (
    <Link
      className="btn nav-call"
      href={href}
      data-call-href={call.href}
      onClick={() => captureMarketing('call_button_clicked', { where: 'top_bar', dest: call.href })}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2" y="3" width="12" height="11" rx="2" />
        <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
      </svg>
      <span className="nav-call-long">{call.label}</span>
      <span className="nav-call-short">{call.short}</span>
    </Link>
  )
}
