'use client'
import type { ReactNode } from 'react'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'

/** #4137 — pauses the hero wall's zoom while it is off screen or the tab is hidden. */
export function HeroWallMotion({ children }: { children: ReactNode }) {
  const { ref, active } = useActiveInViewport<HTMLDivElement>()
  return (
    <div ref={ref} aria-hidden="true" className="cut-hero-wall" data-paused={active ? undefined : ''}>
      {children}
    </div>
  )
}
