'use client'
import * as React from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — 3D tilt card.
//
// DEPENDENCIES: framer-motion and lucide-react, both already installed.
// Nothing new. The only edit to the supplied source is `@/lib/utils` →
// `@/lib/cn`, which is where this repo's `cn` lives (this is not a shadcn
// project — there is no components.json — but `components/ui/` already exists,
// so the file lands exactly where it was asked to).
//
// ADDED: a reduced-motion guard. The tilt is a large, continuous,
// cursor-driven 3D transform, which is precisely the class of motion that
// causes trouble for vestibular users. Under `prefers-reduced-motion` the card
// renders flat and still.
//
// `Card3D` is the reusable tilt shell — the part the Mingla cards need.
// `InteractiveTravelCard` is the supplied component, kept intact.
// ---------------------------------------------------------------

const SPRING = { damping: 15, stiffness: 150 }

/** The reusable tilt container. Children provide their own surface. */
export const Card3D = React.forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode
    className?: string
    /** Max tilt in degrees. Lower reads calmer on dense grids. */
    intensity?: number
  }
>(({ children, className, intensity = 8 }, ref) => {
  const reduced = useMinglaReducedMotion()
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const springX = useSpring(mouseX, SPRING)
  const springY = useSpring(mouseY, SPRING)
  const rotateX = useTransform(springY, [-0.5, 0.5], [`${intensity}deg`, `-${intensity}deg`])
  const rotateY = useTransform(springX, [-0.5, 0.5], [`-${intensity}deg`, `${intensity}deg`])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced) return
    const { width, height, left, top } = e.currentTarget.getBoundingClientRect()
    mouseX.set((e.clientX - left) / width - 0.5)
    mouseY.set((e.clientY - top) / height - 0.5)
  }

  const reset = () => {
    mouseX.set(0)
    mouseY.set(0)
  }

  return (
    <div style={{ perspective: 1000 }} className="h-full">
      <motion.div
        ref={ref}
        onMouseMove={handleMouseMove}
        onMouseLeave={reset}
        style={reduced ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
        className={cn('relative h-full', className)}
      >
        {children}
      </motion.div>
    </div>
  )
})
Card3D.displayName = 'Card3D'

/** Lifts a child toward the viewer inside a Card3D. */
export function Layer({
  z = 40,
  className,
  children,
}: {
  z?: number
  className?: string
  children: React.ReactNode
}) {
  const reduced = useMinglaReducedMotion()
  return (
    <div style={reduced ? undefined : { transform: `translateZ(${z}px)` }} className={className}>
      {children}
    </div>
  )
}

export interface InteractiveTravelCardProps {
  title: string
  subtitle: string
  imageUrl: string
  actionText: string
  href: string
  onActionClick: () => void
  className?: string
}

/** The supplied travel card, on this repo's `cn` and with the motion guard. */
export const InteractiveTravelCard = React.forwardRef<
  HTMLDivElement,
  InteractiveTravelCardProps
>(({ title, subtitle, imageUrl, actionText, href, onActionClick, className }, ref) => {
  const reduced = useMinglaReducedMotion()
  return (
    <Card3D ref={ref} intensity={10.5} className={cn('h-[26rem] w-80', className)}>
      <div
        className="relative h-full w-full rounded-2xl border border-[var(--cut-hairline)] shadow-2xl"
        style={reduced ? undefined : { transformStyle: 'preserve-3d' }}
      >
        <div
          style={reduced ? undefined : { transform: 'translateZ(50px)', transformStyle: 'preserve-3d' }}
          className="absolute inset-4 grid h-[calc(100%-2rem)] w-[calc(100%-2rem)] grid-rows-[1fr_auto] rounded-xl shadow-lg"
        >
          <img
            src={imageUrl}
            alt={`${title}, ${subtitle}`}
            className="absolute inset-0 h-full w-full rounded-xl object-cover"
          />
          <div className="absolute inset-0 h-full w-full rounded-xl bg-gradient-to-b from-black/20 via-transparent to-black/60" />
          <div className="relative flex flex-col justify-between rounded-xl p-4 text-white">
            <div className="flex items-start justify-between">
              <Layer z={50}>
                <h3 className="font-display text-2xl">{title}</h3>
                <p className="text-sm font-light text-white/80">{subtitle}</p>
              </Layer>
              <Layer z={60}>
                <motion.a
                  href={href}
                  target="_blank"
                  rel="noopener"
                  whileHover={reduced ? undefined : { scale: 1.1, rotate: '2.5deg' }}
                  whileTap={reduced ? undefined : { scale: 0.9 }}
                  aria-label={`Learn more about ${title}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/30 backdrop-blur-sm transition-colors hover:bg-white/30 focus-ring"
                >
                  <ArrowUpRight className="h-5 w-5 text-white" aria-hidden="true" />
                </motion.a>
              </Layer>
            </div>
            <Layer z={40}>
              <motion.button
                type="button"
                onClick={onActionClick}
                whileHover={reduced ? undefined : { scale: 1.05 }}
                whileTap={reduced ? undefined : { scale: 0.95 }}
                className="w-full rounded-lg bg-white/10 py-3 text-center font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-md transition-colors hover:bg-white/20 focus-ring"
              >
                {actionText}
              </motion.button>
            </Layer>
          </div>
        </div>
      </div>
    </Card3D>
  )
})
InteractiveTravelCard.displayName = 'InteractiveTravelCard'
