'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'

export function MotionAwareMontage({ children, label }: { children: ReactNode; label: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [onscreen, setOnscreen] = useState(false)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(document.visibilityState === 'visible')
    const onVisibilityChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibilityChange)

    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setOnscreen(true)
      return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }

    const observer = new IntersectionObserver(
      ([entry]) => setOnscreen(entry?.isIntersecting ?? false),
      { threshold: 0.08 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="ps-montage"
      data-motion-active={onscreen && visible ? 'true' : 'false'}
      aria-label={label}
    >
      {children}
    </div>
  )
}
