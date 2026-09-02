'use client'
import React, { useContext, useEffect, useRef, useState } from 'react'
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'framer-motion'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------
// #2902 — scroll-velocity marquee.
//
// DEPENDENCIES: none added. The snippet imports from `motion/react`; `motion`
// is framer-motion under its newer name and this app already depends on
// framer-motion@11, where every hook used here exists unchanged
// (useAnimationFrame / useMotionValue / useScroll / useSpring / useTransform /
// useVelocity / MotionValue). Installing `motion` alongside it would ship two
// copies of the same animation runtime. `@/lib/utils` → `@/lib/cn`.
//
// TWO CORRECTIONS TO THE SUPPLIED SOURCE:
//
//  1. REDUCED MOTION ACTUALLY STOPS IT. The original reads
//     `prefers-reduced-motion` but only uses it to cap the speed multiplier at
//     1 — the marquee still scrolls, forever. For a user who asked the OS to
//     reduce motion, a permanently moving band is the exact thing they turned
//     off. Here it holds still.
//  2. The row is marked `aria-hidden` at the call site and the operator names
//     are also rendered as real static text, so a screen reader gets the list
//     once rather than N duplicated copies of a decorative loop.
//
// Already correct in the original and kept: it pauses off-screen and when the
// tab is hidden, which is the same discipline the rest of this system uses.
// ---------------------------------------------------------------

export const wrap = (min: number, max: number, v: number) => {
  const rangeSize = max - min
  return ((((v - min) % rangeSize) + rangeSize) % rangeSize) + min
}

const ScrollVelocityContext = React.createContext<MotionValue<number> | null>(null)

export function ScrollVelocityContainer({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { scrollY } = useScroll()
  const scrollVelocity = useVelocity(scrollY)
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 })
  const velocityFactor = useTransform(smoothVelocity, (v) => {
    const sign = v < 0 ? -1 : 1
    return sign * Math.min(5, (Math.abs(v) / 1000) * 5)
  })

  return (
    <ScrollVelocityContext.Provider value={velocityFactor}>
      <div className={cn('relative w-full', className)} {...props}>
        {children}
      </div>
    </ScrollVelocityContext.Provider>
  )
}

interface ScrollVelocityRowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  baseVelocity?: number
  direction?: 1 | -1
  scrollReactivity?: boolean
}

function ScrollVelocityRowImpl({
  children,
  baseVelocity = 5,
  direction = 1,
  className,
  velocityFactor,
  scrollReactivity = true,
  ...props
}: ScrollVelocityRowProps & { velocityFactor: MotionValue<number> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const blockRef = useRef<HTMLDivElement>(null)
  const [numCopies, setNumCopies] = useState(1)

  const baseX = useMotionValue(0)
  const baseDirectionRef = useRef<number>(direction >= 0 ? 1 : -1)
  const currentDirectionRef = useRef<number>(direction >= 0 ? 1 : -1)
  const unitWidth = useMotionValue(0)

  const isInViewRef = useRef(true)
  const isPageVisibleRef = useRef(true)
  const reducedRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    const block = blockRef.current
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null
    let mq: MediaQueryList | null = null

    const onVisibility = () => {
      isPageVisibleRef.current = document.visibilityState === 'visible'
    }
    const onPRM = () => {
      if (mq) reducedRef.current = mq.matches
    }

    if (container && block) {
      const updateSizes = () => {
        const cw = container.offsetWidth || 0
        const bw = block.scrollWidth || 0
        unitWidth.set(bw)
        const next = bw > 0 ? Math.max(3, Math.ceil(cw / bw) + 2) : 1
        setNumCopies((prev) => (prev === next ? prev : next))
      }
      updateSizes()

      ro = new ResizeObserver(updateSizes)
      ro.observe(container)
      ro.observe(block)

      io = new IntersectionObserver(([entry]) => {
        if (entry) isInViewRef.current = entry.isIntersecting
      })
      io.observe(container)

      document.addEventListener('visibilitychange', onVisibility, { passive: true })
      onVisibility()

      mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      mq.addEventListener('change', onPRM)
      onPRM()
    }

    return () => {
      ro?.disconnect()
      io?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      mq?.removeEventListener('change', onPRM)
    }
  }, [unitWidth])

  const x = useTransform([baseX, unitWidth], ([v, bw]) => {
    const width = Number(bw) || 1
    return `${-wrap(0, width, Number(v) || 0)}px`
  })

  useAnimationFrame((_, delta) => {
    // Reduced motion HOLDS THE BAND STILL. The original only slowed it down.
    if (reducedRef.current) return
    if (!isInViewRef.current || !isPageVisibleRef.current) return

    const vf = scrollReactivity ? velocityFactor.get() : 0
    const absVf = Math.min(5, Math.abs(vf))
    if (absVf > 0.1) {
      currentDirectionRef.current = baseDirectionRef.current * (vf >= 0 ? 1 : -1)
    }

    const bw = unitWidth.get() || 0
    if (bw <= 0) return
    const pixelsPerSecond = (bw * baseVelocity) / 100
    baseX.set(
      baseX.get() + currentDirectionRef.current * pixelsPerSecond * (1 + absVf) * (delta / 1000),
    )
  })

  return (
    <div
      className={cn('w-full overflow-hidden whitespace-nowrap', className)}
      ref={containerRef}
      {...props}
    >
      <motion.div
        className="inline-flex transform-gpu select-none items-center will-change-transform"
        style={{ x }}
      >
        {Array.from({ length: numCopies }).map((_, i) => (
          <div
            aria-hidden={i !== 0}
            className="inline-flex shrink-0 items-center"
            key={i}
            ref={i === 0 ? blockRef : null}
          >
            {children}
          </div>
        ))}
      </motion.div>
    </div>
  )
}

function ScrollVelocityRowLocal(props: ScrollVelocityRowProps) {
  const { scrollY } = useScroll()
  const v = useVelocity(scrollY)
  const smooth = useSpring(v, { damping: 50, stiffness: 400 })
  const factor = useTransform(smooth, (val) => {
    const sign = val < 0 ? -1 : 1
    return sign * Math.min(5, (Math.abs(val) / 1000) * 5)
  })
  return <ScrollVelocityRowImpl {...props} velocityFactor={factor} />
}

export function ScrollVelocityRow(props: ScrollVelocityRowProps) {
  const shared = useContext(ScrollVelocityContext)
  if (shared) return <ScrollVelocityRowImpl {...props} velocityFactor={shared} />
  return <ScrollVelocityRowLocal {...props} />
}

export default ScrollVelocityRow
