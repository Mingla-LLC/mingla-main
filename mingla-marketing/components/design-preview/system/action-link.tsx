'use client'
import { type ReactNode } from 'react'
import Link from 'next/link'
import { buttonClasses } from '@/components/ui/button'

// #2902 — a client boundary around `buttonClasses`.
//
// `components/ui/button.tsx` is a `'use client'` module, so a SERVER component
// cannot call `buttonClasses()` directly — Next fails the prerender. Rather
// than restructure the shipped Button (site-wide blast radius) or turn these
// landing pages into client components (they should stay server-rendered, which
// is the entire point of the search work this issue exists for), the recipe is
// consumed here, inside a client component, and rendered as a real anchor.
//
// The result is pixel-identical to <Button> by construction: same recipe, same
// tokens, no second style path to drift.

interface ActionLinkProps {
  href: string
  children: ReactNode
  variant?: 'primary' | 'glass'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ActionLink({
  href,
  children,
  variant = 'primary',
  size = 'lg',
  className,
}: ActionLinkProps) {
  const classes = buttonClasses({ variant, size, className })

  // In-page anchors must not go through the router — Link would push a
  // navigation for a hash the page already owns.
  if (href.startsWith('#')) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    )
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  )
}
