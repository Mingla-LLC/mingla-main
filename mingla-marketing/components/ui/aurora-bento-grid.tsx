'use client'
import * as React from 'react'
import { motion, type Transition } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// #2902 — aurora bento grid.
//
// DEPENDENCIES: framer-motion only, already installed. Nothing added.
//
// CHANGES TO THE SUPPLIED SOURCE:
//
//  1. TYPED. The original is plain JS with untyped props (`{ style,
//     animateProps }`, `{ className, children, gradientFrom, gradientTo }`),
//     which will not compile under this repo's strict TS.
//  2. RE-TINTED. The demo's purple / yellow / blue / emerald / sky palette is
//     replaced with Mingla's warm range. The gradients are token-driven so a
//     brand change moves them.
//  3. REDUCED MOTION. The original animates the blobs on an infinite loop with
//     no escape and runs its stagger regardless. Both are gated here — the
//     aurora holds still and items appear in place.
//  4. ENTRY ON SCROLL, not on mount. `animate="visible"` fires immediately even
//     if the grid is far below the fold, so by the time a reader arrives the
//     animation has already played to an empty screen. `whileInView` runs it
//     when it is actually seen.
//
// NOTE ON THE GLOW RULE. Seth's earlier direction was "no glows — a clean
// cut-out across the app", and that still holds for buttons and cards, where a
// halo reads as a mistake. An aurora is a different thing: a soft field BEHIND
// a dark band, not a ring around an element. It is kept low-opacity and warm so
// it reads as light in a room rather than as a glowing component.
// ---------------------------------------------------------------

const AURORA_TRANSITION: Transition = {
  duration: 25,
  repeat: Infinity,
  repeatType: 'reverse',
  ease: 'easeInOut',
}

interface BlobProps {
  style: React.CSSProperties
  animateProps: { x: number[]; y: number[] }
}

export function AuroraBackground({ className }: { className?: string }) {
  const reduced = useMinglaReducedMotion()

  const Blob = ({ style, animateProps }: BlobProps) => (
    <motion.div
      className="absolute rounded-full opacity-45 mix-blend-screen blur-[80px]"
      style={style}
      animate={reduced ? undefined : animateProps}
      transition={AURORA_TRANSITION}
    />
  )

  return (
    <div aria-hidden="true" className={cn('absolute inset-0 z-0 overflow-hidden', className)}>
      <Blob
        style={{
          top: '-18%',
          left: '-8%',
          width: '38rem',
          height: '38rem',
          background: 'rgba(235, 120, 37, 0.55)',
        }}
        animateProps={{ x: [0, 90, -40, 0], y: [0, -70, 100, 0] }}
      />
      <Blob
        style={{
          top: '18%',
          right: '-16%',
          width: '28rem',
          height: '28rem',
          background: 'rgba(244, 214, 121, 0.38)',
        }}
        animateProps={{ x: [0, -100, 60, 0], y: [0, 90, -70, 0] }}
      />
      <Blob
        style={{
          bottom: '-18%',
          left: '22%',
          width: '32rem',
          height: '32rem',
          background: 'rgba(168, 69, 14, 0.5)',
        }}
        animateProps={{ x: [0, 70, -90, 0], y: [0, -80, 50, 0] }}
      />
    </div>
  )
}

export function BentoGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const reduced = useMinglaReducedMotion()
  return (
    <motion.div
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.09 } } }}
      initial={reduced ? false : 'hidden'}
      // whileInView, not animate: the grid sits well below the fold, and the
      // original would have played its entrance to nobody.
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      className={cn(
        'grid grid-cols-1 gap-4 md:grid-cols-6 md:auto-rows-[13rem]',
        className,
      )}
    >
      {children}
    </motion.div>
  )
}

export function BentoGridItem({
  className,
  children,
  tone = 'ink',
}: {
  className?: string
  children: React.ReactNode
  /** `brand` is the one accent tile; everything else is a warm dark surface. */
  tone?: 'ink' | 'brand' | 'raised'
}) {
  const reduced = useMinglaReducedMotion()
  const TONE: Record<string, string> = {
    ink: 'linear-gradient(150deg, rgba(38,34,29,0.92) 0%, rgba(22,20,17,0.94) 100%)',
    raised: 'linear-gradient(150deg, rgba(52,46,39,0.92) 0%, rgba(30,27,23,0.94) 100%)',
    brand: 'linear-gradient(150deg, #f0842f 0%, #c85f14 100%)',
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 22 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } },
      }}
      whileHover={reduced ? undefined : { y: -4, transition: { duration: 0.2 } }}
      className={cn(
        'group relative flex min-h-[13rem] flex-col justify-between overflow-hidden rounded-[var(--cut-r-card)] p-6 sm:p-7',
        className,
      )}
      style={{
        background: TONE[tone],
        boxShadow:
          '0 10px 30px rgba(0,0,0,0.34), 0 -8px 0 0 rgba(0,0,0,0.22) inset, 0 4px 0 0 rgba(255,255,255,0.08) inset',
      }}
    >
      {/* Shine sweep on hover — the one flourish kept from the original. */}
      {!reduced ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[-150%] top-0 h-full w-[50%] skew-x-[-25deg] bg-[linear-gradient(to_right,transparent_0%,#ffffff26_50%,transparent_100%)] transition-all duration-700 ease-in-out group-hover:left-[125%]"
        />
      ) : null}
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </motion.div>
  )
}
