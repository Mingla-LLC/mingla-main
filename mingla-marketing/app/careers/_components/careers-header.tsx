'use client'
// META-ORCH-1222 [Careers site] — careers nav header (DESIGN §1).
// Sticky, 64px, glass (backdrop-blur), raises a hairline shadow past 8px scroll.
// Left: Mingla wordmark → usemingla.com. Right: "All roles" → /.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export function CareersHeader() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className="sticky top-0 z-50"
      style={{
        height: 64,
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
        background: 'rgba(255,255,255,0.72)',
        borderBottom: '1px solid var(--border)',
        boxShadow: scrolled ? '0 1px 0 rgba(15,17,21,0.06)' : 'none',
        transition: 'box-shadow 180ms ease-out',
      }}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between px-5 sm:px-6">
        <a href="https://usemingla.com" aria-label="Mingla home">
          <Image
            src="/brand/mingla-wordmark.svg"
            alt="Mingla"
            width={108}
            height={28}
            priority
            className="h-7 w-auto"
          />
        </a>
        <Link
          href="/"
          className="text-[14px] font-medium transition-colors hover:text-[var(--coral-500)]"
          style={{ color: 'var(--ink-muted)' }}
        >
          All roles
        </Link>
      </div>
    </header>
  )
}
