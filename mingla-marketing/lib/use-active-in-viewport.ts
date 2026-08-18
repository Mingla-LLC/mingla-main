'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'

/** Keeps continuous decorative work alive only while it can actually be seen. */
export function useActiveInViewport<T extends Element>(amount = 0.05) {
  const ref = useRef<T>(null)
  const inView = useInView(ref, { amount })
  const [pageVisible, setPageVisible] = useState(true)

  useEffect(() => {
    const syncVisibility = () => setPageVisible(document.visibilityState === 'visible')
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => document.removeEventListener('visibilitychange', syncVisibility)
  }, [])

  return { ref, active: inView && pageVisible }
}
