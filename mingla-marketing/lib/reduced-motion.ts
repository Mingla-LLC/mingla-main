'use client'
import { useReducedMotion } from 'framer-motion'

/**
 * Single source of truth for reduced-motion checks across the marketing site.
 * Wraps framer-motion's hook to return a definite boolean (never null) so
 * call sites can use it directly in conditional expressions.
 */
export function useMinglaReducedMotion(): boolean {
  const reduced = useReducedMotion()
  return reduced ?? false
}
