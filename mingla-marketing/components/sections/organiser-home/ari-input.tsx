'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — "Ari" typing bar. A presentational Ari composer (NOT a live input —
// avoids a dead tap) that typewrites through real business requests, one after
// another, to simulate different operators asking Ari for different things.
// Adapted from the OrbInput pattern; the external giphy orb is replaced with a
// self-contained warm CSS orb. Illustrative of Ari's range (product vision).

const PROMPTS = [
  "Here's my menu — create a Friday experience to boost bookings.",
  'Create an afrobeats event for Sunday, with flyer ideas.',
  'Build the trip page for my travel company.',
  'Run the marketing for my last event.',
  "What's my ROI this month?",
  'Give me the data on last weekend.',
] as const

const CHAR_DELAY = 48 // ms per character
const IDLE_AFTER = 1900 // ms to hold a finished sentence

export function AriInput({ className }: { className?: string }) {
  const reduced = useMinglaReducedMotion()
  const prompts = useMemo(() => PROMPTS, [])
  const [index, setIndex] = useState(0)
  const [text, setText] = useState(reduced ? PROMPTS[0] : '')
  const [typing, setTyping] = useState(!reduced)
  const intervalRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (reduced) return
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)

    const current = prompts[index]
    const chars = Array.from(current)
    setText('')
    setTyping(true)
    let i = 0

    intervalRef.current = window.setInterval(() => {
      if (i < chars.length) {
        setText(chars.slice(0, i + 1).join(''))
        i += 1
      } else {
        if (intervalRef.current) window.clearInterval(intervalRef.current)
        setTyping(false)
        timeoutRef.current = window.setTimeout(() => {
          setIndex((p) => (p + 1) % prompts.length)
        }, IDLE_AFTER)
      }
    }, CHAR_DELAY)

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [index, prompts, reduced])

  return (
    <div
      className={cn(
        'font-dashboard flex items-center gap-3.5 rounded-[1.6rem] border border-white/10 bg-[#15120f] p-3 pr-5 shadow-xl',
        className,
      )}
      role="img"
      aria-label={`Ari, the Mingla Business AI, answering requests like: ${prompts.join('; ')}`}
    >
      {/* warm Ari orb */}
      <span className="relative h-11 w-11 shrink-0" aria-hidden="true">
        {!reduced ? (
          <span
            className="absolute inset-0 rounded-full opacity-50"
            style={{ background: 'var(--color-warm)', animation: 'mingla-orb-pulse 2.4s ease-in-out infinite' }}
          />
        ) : null}
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle at 34% 28%, #ffe2c4 0%, #f7a45a 38%, #eb7825 62%, #c2410c 100%)',
            boxShadow: 'inset 0 -3px 8px rgba(120,40,0,0.45), 0 0 18px rgba(235,120,37,0.5)',
          }}
        />
      </span>

      <span className="h-9 w-px shrink-0 bg-white/15" aria-hidden="true" />

      {/* typed request */}
      <span className="min-h-[1.6rem] flex-1 text-[15px] leading-snug text-white/90 md:text-base">
        {text}
        <span
          className={cn('ml-0.5 inline-block w-[2px] -translate-y-[1px] align-middle', !reduced && 'animate-pulse')}
          style={{ height: '1.05em', background: 'var(--color-warm)' }}
          aria-hidden="true"
        />
      </span>

      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35" aria-hidden="true">
        Ari
      </span>
    </div>
  )
}
