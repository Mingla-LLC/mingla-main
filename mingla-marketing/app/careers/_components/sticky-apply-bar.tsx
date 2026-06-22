'use client'
// META-ORCH-1222 [Careers site] — mobile + tablet sticky Apply bar (DESIGN §3.2.5
// / §3.4). Appears (slides up) when the top Apply CTA scrolls out of view, via an
// IntersectionObserver on a sentinel placed at the top CTA. Desktop (≥1024) never
// shows it. Reduced-motion → instant. Glass with backdrop fallback.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

export function StickyApplyBar({
  slug,
  roleTitle,
}: {
  slug: string
  roleTitle: string
}) {
  const reduced = useMinglaReducedMotion()
  const [visible, setVisible] = useState(false)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Watch the sentinel rendered just after the top CTA: once it leaves the
    // top of the viewport (scrolled past), reveal the bar.
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <>
      {/* Sentinel — sits where the top Apply CTA is; observed for scroll-out. */}
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />

      <div
        className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          opacity: visible ? 1 : 0,
          transition: reduced ? 'none' : 'transform 220ms ease-out, opacity 220ms ease-out',
          pointerEvents: visible ? 'auto' : 'none',
          paddingBottom: 'env(safe-area-inset-bottom)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          background: 'rgba(255,255,255,0.85)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div className="mx-auto flex max-w-[760px] items-center justify-between gap-3 px-5 py-3">
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium"
            style={{ color: 'var(--ink-muted)' }}
          >
            {roleTitle}
          </span>
          <Link
            href={`/roles/${slug}/apply`}
            className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[15px] font-semibold text-white hover:bg-[var(--coral-700)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral-500)] focus-visible:ring-offset-2"
            style={{ background: 'var(--coral-600)', minHeight: 44 }}
          >
            Apply
          </Link>
        </div>
      </div>
    </>
  )
}
