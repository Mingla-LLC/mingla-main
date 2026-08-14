'use client'

import { useRef, type ReactNode } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { cn } from '@/lib/cn'

gsap.registerPlugin(useGSAP)

export function GsapReveal({ children, className }: { children: ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null)

  useGSAP(() => {
    const root = scope.current
    if (!root) return
    const items = gsap.utils.toArray<HTMLElement>('[data-reveal]', root)
    const mm = gsap.matchMedia()
    let observer: IntersectionObserver | undefined

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const tween = gsap.from(items, {
        y: 22,
        duration: 0.7,
        stagger: 0.1,
        ease: 'power3.out',
        paused: true,
      })
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return
          tween.play()
          observer?.disconnect()
        },
        { threshold: 0.14 },
      )
      observer.observe(root)
      return () => observer?.disconnect()
    })

    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(items, { clearProps: 'all' }))
    return () => {
      observer?.disconnect()
      mm.revert()
    }
  }, { scope })

  return <div ref={scope} className={cn(className)}>{children}</div>
}
