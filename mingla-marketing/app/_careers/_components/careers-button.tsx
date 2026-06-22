'use client'
// META-ORCH-1221 [Careers site] — shared careers CTA buttons (DESIGN §3.3 / §4.5
// + ADDENDUM D-2). Solid coral buttons rest at --coral-600 (#E85D1F) and hover
// to --coral-700 for a clean WCAG-AA pass. Ghost buttons keep coral-500 text +
// border. ≥44px hit targets, visible coral focus ring (§5).

import Link from 'next/link'
import type { ReactNode } from 'react'

const baseSolid =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold text-white ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[var(--coral-500)] focus-visible:ring-offset-2 disabled:opacity-70'

const baseGhost =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[var(--coral-500)] focus-visible:ring-offset-2 disabled:opacity-70'

// D-2: resting --coral-600, hover --coral-700.
const SOLID_STYLE = {
  background: 'var(--coral-600)',
  minHeight: 44,
} as const
const GHOST_STYLE = {
  color: 'var(--coral-500)',
  border: '1px solid var(--coral-500)',
  background: 'transparent',
  minHeight: 44,
} as const

export function SolidCtaLink({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`${baseSolid} px-7 py-3.5 text-[16px] hover:bg-[var(--coral-700)] ${className}`}
      style={SOLID_STYLE}
    >
      {children}
    </Link>
  )
}

export function GhostCtaLink({
  href,
  children,
  className = '',
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`${baseGhost} px-[18px] py-2.5 text-[15px] hover:bg-[var(--coral-050)] ${className}`}
      style={GHOST_STYLE}
    >
      {children}
    </Link>
  )
}

export function SolidCtaButton({
  children,
  className = '',
  type = 'button',
  disabled = false,
  onClick,
}: {
  children: ReactNode
  className?: string
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${baseSolid} px-7 py-3.5 text-[16px] enabled:hover:bg-[var(--coral-700)] ${className}`}
      style={SOLID_STYLE}
    >
      {children}
    </button>
  )
}
