'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  motion,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ---------------------------------------------------------------
// Mingla ScrollMorphHero
//
// Rewrite of the 21st.dev scroll-morph component to play nicely as
// ONE section inside a normal scrolling page. The original captured
// the whole window's wheel events; this version uses framer-motion's
// useScroll against its own outer container (250vh tall, sticky inner
// pinned to the viewport). Page scroll OUTSIDE this section behaves
// normally — only the morph progress is driven by scroll WITHIN it.
// ---------------------------------------------------------------

type AnimationPhase = 'scatter' | 'line' | 'circle' | 'arc'

interface FlipCardProps {
  src: string
  index: number
  target: { x: number; y: number; rotation: number; scale: number; opacity: number }
}

const IMG_WIDTH = 60
const IMG_HEIGHT = 85
const TOTAL_IMAGES = 20

// Placeholder set — implementor will swap to real Mingla place
// photography (rooftops, comedy clubs, food markets) when assets land.
const IMAGES: readonly string[] = [
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=300&q=80',
  'https://images.unsplash.com/photo-1519710164239-da123dc03ef4?w=300&q=80',
  'https://images.unsplash.com/photo-1497366216548-37526070297c?w=300&q=80',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=300&q=80',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=300&q=80',
  'https://images.unsplash.com/photo-1506765515384-028b60a970df?w=300&q=80',
  'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=300&q=80',
  'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=300&q=80',
  'https://images.unsplash.com/photo-1500485035595-cbe6f645feb1?w=300&q=80',
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=300&q=80',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=300&q=80',
  'https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=300&q=80',
  'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=300&q=80',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=300&q=80',
  'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=300&q=80',
  'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?w=300&q=80',
  'https://images.unsplash.com/photo-1483729558449-99ef09a8c325?w=300&q=80',
  'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=300&q=80',
  'https://images.unsplash.com/photo-1523961131990-5ea7c61b2107?w=300&q=80',
  'https://images.unsplash.com/photo-1496568816309-51d7c20e3b21?w=300&q=80',
]

function FlipCard({ src, index, target }: FlipCardProps) {
  return (
    <motion.div
      animate={{
        x: target.x,
        y: target.y,
        rotate: target.rotation,
        scale: target.scale,
        opacity: target.opacity,
      }}
      transition={{ type: 'spring', stiffness: 40, damping: 15 }}
      style={{
        position: 'absolute',
        width: IMG_WIDTH,
        height: IMG_HEIGHT,
        transformStyle: 'preserve-3d',
        perspective: '1000px',
      }}
      className="cursor-pointer"
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-xl bg-vellum shadow-lg ring-1 ring-glass-border"
        style={{ backfaceVisibility: 'hidden' }}
      >
        <img
          src={src}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/10" />
      </div>
    </motion.div>
  )
}

const lerp = (start: number, end: number, t: number): number =>
  start * (1 - t) + end * t

interface ScrollMorphHeroProps {
  headline?: string
  sub?: string
  className?: string
}

export default function ScrollMorphHero({
  headline = 'Out of 4,000 spots in Lagos, 20 fit your night.',
  sub = 'Filters that think in vibes, not categories.',
  className,
}: ScrollMorphHeroProps) {
  const reduced = useMinglaReducedMotion()
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)

  const [introPhase, setIntroPhase] = useState<AnimationPhase>(reduced ? 'arc' : 'scatter')
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })

  // Auto-played intro phases (mount-time)
  useEffect(() => {
    if (reduced) {
      setIntroPhase('arc')
      return
    }
    const t1 = setTimeout(() => setIntroPhase('line'), 500)
    const t2 = setTimeout(() => setIntroPhase('circle'), 2400)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [reduced])

  // Inner container size tracking (for responsive arc math)
  useEffect(() => {
    const node = innerRef.current
    if (!node) return
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    obs.observe(node)
    setContainerSize({ width: node.offsetWidth, height: node.offsetHeight })
    return () => obs.disconnect()
  }, [])

  // Scroll-driven morph progress, scoped to THIS section only
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  })

  // 0 → 0.5 of section progress = morph from circle to arc
  const morphProgress = useTransform(scrollYProgress, [0, 0.5], [0, 1], { clamp: true })
  const smoothMorph = useSpring(morphProgress, { stiffness: 40, damping: 20 })

  // 0.5 → 1.0 of section progress = arc shuffle rotation
  const scrollRotate = useTransform(scrollYProgress, [0.5, 1.0], [0, 360], { clamp: true })
  const smoothScrollRotate = useSpring(scrollRotate, { stiffness: 40, damping: 20 })

  // Mouse parallax inside the inner container
  const mouseX = useMotionValue(0)
  const smoothMouseX = useSpring(mouseX, { stiffness: 30, damping: 20 })

  useEffect(() => {
    const node = innerRef.current
    if (!node || reduced) return
    const onMove = (e: MouseEvent): void => {
      const rect = node.getBoundingClientRect()
      const relX = e.clientX - rect.left
      const norm = (relX / rect.width) * 2 - 1
      mouseX.set(norm * 60)
    }
    node.addEventListener('mousemove', onMove)
    return () => node.removeEventListener('mousemove', onMove)
  }, [mouseX, reduced])

  // Subscribe to motion values without re-rendering on every frame
  const [morphValue, setMorphValue] = useState(reduced ? 1 : 0)
  const [rotateValue, setRotateValue] = useState(0)
  const [parallaxValue, setParallaxValue] = useState(0)

  useEffect(() => {
    const u1 = smoothMorph.on('change', setMorphValue)
    const u2 = smoothScrollRotate.on('change', setRotateValue)
    const u3 = smoothMouseX.on('change', setParallaxValue)
    return () => {
      u1()
      u2()
      u3()
    }
  }, [smoothMorph, smoothScrollRotate, smoothMouseX])

  // Headline overlay opacity ties to morph completion
  const overlayOpacity = useTransform(smoothMorph, [0.85, 1], [0, 1])
  const overlayY = useTransform(smoothMorph, [0.85, 1], [16, 0])

  // Random scatter positions (deterministic per mount)
  const scatterPositions = useMemo(
    () =>
      IMAGES.map(() => ({
        x: (Math.random() - 0.5) * 1500,
        y: (Math.random() - 0.5) * 1000,
        rotation: (Math.random() - 0.5) * 180,
        scale: 0.6,
        opacity: 0,
      })),
    [],
  )

  // For reduced-motion, render a flat, single-screen section.
  // Outer height = h-screen (no pinned scroll), morph = 1 immediately.
  const sectionHeight = reduced ? 'h-screen' : 'h-[250vh]'

  return (
    <section
      ref={sectionRef}
      className={`relative ${sectionHeight} bg-parchment ${className ?? ''}`}
    >
      <div
        ref={innerRef}
        className="sticky top-0 flex h-screen w-full items-center justify-center overflow-hidden"
      >
        {/* Cards */}
        <div className="relative flex h-full w-full items-center justify-center">
          {IMAGES.slice(0, TOTAL_IMAGES).map((src, i) => {
            let target = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }

            if (introPhase === 'scatter') {
              target = scatterPositions[i] ?? target
            } else if (introPhase === 'line') {
              const lineSpacing = 70
              const totalLineWidth = TOTAL_IMAGES * lineSpacing
              const lineX = i * lineSpacing - totalLineWidth / 2
              target = { x: lineX, y: 0, rotation: 0, scale: 1, opacity: 1 }
            } else {
              // Phase: 'circle' or 'arc' — interpolate by morphValue
              const isMobile = containerSize.width > 0 && containerSize.width < 768
              const minDim = Math.min(containerSize.width, containerSize.height) || 800

              // Circle layout
              const circleRadius = Math.min(minDim * 0.32, 320)
              const circleAngle = (i / TOTAL_IMAGES) * 360
              const circleRad = (circleAngle * Math.PI) / 180
              const circlePos = {
                x: Math.cos(circleRad) * circleRadius,
                y: Math.sin(circleRad) * circleRadius,
                rotation: circleAngle + 90,
              }

              // Bottom arc layout
              const baseRadius = Math.min(containerSize.width || 1000, (containerSize.height || 800) * 1.5)
              const arcRadius = baseRadius * (isMobile ? 1.4 : 1.1)
              const arcApexY = (containerSize.height || 800) * (isMobile ? 0.32 : 0.22)
              const arcCenterY = arcApexY + arcRadius
              const spreadAngle = isMobile ? 100 : 130
              const startAngle = -90 - spreadAngle / 2
              const step = spreadAngle / (TOTAL_IMAGES - 1)

              const scrollProgress = Math.min(Math.max(rotateValue / 360, 0), 1)
              const maxRotation = spreadAngle * 0.8
              const boundedRotation = -scrollProgress * maxRotation

              const currentArcAngle = startAngle + i * step + boundedRotation
              const arcRad = (currentArcAngle * Math.PI) / 180
              const arcPos = {
                x: Math.cos(arcRad) * arcRadius + parallaxValue,
                y: Math.sin(arcRad) * arcRadius + arcCenterY,
                rotation: currentArcAngle + 90,
                scale: isMobile ? 1.4 : 1.7,
              }

              const m = morphValue
              target = {
                x: lerp(circlePos.x, arcPos.x, m),
                y: lerp(circlePos.y, arcPos.y, m),
                rotation: lerp(circlePos.rotation, arcPos.rotation, m),
                scale: lerp(1, arcPos.scale, m),
                opacity: 1,
              }
            }

            return <FlipCard key={i} src={src} index={i} target={target} />
          })}
        </div>

        {/* Headline overlay — fades in once morph completes */}
        <motion.div
          style={{ opacity: overlayOpacity, y: overlayY }}
          className="pointer-events-none absolute inset-x-0 top-[12%] flex justify-center px-6"
        >
          <div className="glass-frost max-w-2xl rounded-xl p-8 text-center">
            <h2 className="font-display text-3xl font-medium leading-[1.1] tracking-[-0.02em] text-text-primary md:text-5xl">
              {headline}
            </h2>
            <p className="mt-4 text-base text-text-secondary md:text-lg">{sub}</p>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
