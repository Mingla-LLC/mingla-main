import type { Transition } from 'framer-motion'

export const spring = {
  soft: { type: 'spring', stiffness: 80, damping: 20 } satisfies Transition,
  snap: { type: 'spring', stiffness: 220, damping: 26 } satisfies Transition,
  bouncy: { type: 'spring', stiffness: 320, damping: 18 } satisfies Transition,
} as const

export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.65, 0, 0.35, 1] as const,
}

export const timing = {
  micro: 0.15,
  normal: 0.24,
  page: 0.48,
  cinema: 0.72,
} as const
