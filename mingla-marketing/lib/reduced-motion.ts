'use client'
import { useSyncExternalStore } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function reducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * Single source of truth for reduced-motion checks across the marketing site.
 * The server snapshot is deliberately false and React re-reads the real media
 * query immediately after hydration. That keeps the server and hydration
 * renders byte-for-byte stable while CSS already suppresses motion for a
 * visitor whose OS preference is Reduce Motion.
 */
export function useMinglaReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false)
}
