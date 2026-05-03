'use client'
import { type ReactNode } from 'react'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { cn } from '@/lib/cn'

type Speed = 'slow' | 'medium' | 'fast'

interface MarqueeProps {
  speed?: Speed
  pauseOnHover?: boolean
  className?: string
  children: ReactNode
}

const speeds: Record<Speed, number> = { slow: 60, medium: 40, fast: 20 }

export function Marquee({
  speed = 'slow',
  pauseOnHover = true,
  className,
  children,
}: MarqueeProps) {
  const reduced = useMinglaReducedMotion()

  if (reduced) {
    return (
      <div className={cn('flex flex-wrap items-center justify-center gap-3', className)}>
        {children}
      </div>
    )
  }

  const seconds = speeds[speed]

  return (
    <div className={cn('group relative overflow-hidden', className)}>
      <div
        className={cn(
          'flex w-max items-center gap-6',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
        )}
        style={{ animation: `mingla-marquee ${seconds}s linear infinite` }}
      >
        <div className="flex shrink-0 items-center gap-6">{children}</div>
        <div aria-hidden="true" className="flex shrink-0 items-center gap-6">
          {children}
        </div>
      </div>
      <style>{`@keyframes mingla-marquee { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }`}</style>
    </div>
  )
}
