'use client'

// ---------------------------------------------------------------
// #4137 — the website builder demo in the /host brand tile.
//
// The prompt types itself, Ari ticks five steps, and the site assembles in a
// browser frame section by section, then goes live. It replaces AriCreativeCard
// on /host (which stays for /internal/charts), and with it the screenshot of a
// real host's site: everything here is a generic, nameless example.
//
// AT REST IT IS FINISHED. The server render, no-JS visitors and reduced-motion
// visitors all see the whole prompt, every step done and the full site live.
// The loop runs only while the tile is at least 35% on screen and the tab is
// visible; leaving clears every timer and restores the finished state, and
// coming back replays from the start.
//
// One role="img" with a full description; nothing inside is focusable. The
// "Order", "Add" and "Book" pills are spans, not dead buttons. The booking
// form shows field LABELS, never invented values (constitution rule 9).
// ---------------------------------------------------------------

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'

import { cn } from '@/lib/cn'
import { hostImage } from '@/lib/design-preview/host-imagery'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'

/** The live prompt string, kept verbatim from AriCreativeCard. */
export const BUILDER_PROMPT =
  'Build a site for my 24/7 food house in Lekki — the menu with prices, online ordering, and a table booking form.'

export const BUILDER_STEPS = [
  'Reading your brief',
  'Hero from your own photos',
  'Menu with ordering',
  'Table booking form',
  'Published on your domain',
] as const

/** Timeline, copied from the approved mockup (page.js). */
export const BUILDER_TIMING = {
  typeStart: 400,
  perChar: 26,
  beforeSend: 350,
  sending: 200,
  stepGap: 900,
  stepWork: 650,
  hold: 4200,
} as const

const LABEL =
  'Example: Ari takes a brief for a 24/7 food house in Lekki, then builds a website with a hero photo, a menu with ordering and a table booking form, and publishes it.'

type StepState = 'idle' | 'working' | 'done'

interface DemoState {
  typed: number
  steps: StepState[]
  phase: 'idle' | 'sending' | 'thinking'
}

const FINISHED: DemoState = {
  typed: BUILDER_PROMPT.length,
  steps: BUILDER_STEPS.map(() => 'done'),
  phase: 'idle',
}

const MENU = [
  { slot: 'B2', name: 'Pepper chicken' },
  { slot: 'B3', name: 'House burger' },
  { slot: 'B4', name: 'Chapman' },
] as const

export function AriSiteBuilderDemo() {
  const reduced = useMinglaReducedMotion()
  const { ref, active } = useActiveInViewport<HTMLDivElement>(0.35)
  const [state, setState] = useState<DemoState>(FINISHED)
  const timers = useRef<number[]>([])

  useEffect(() => {
    const clear = () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
    if (reduced || !active) {
      clear()
      setState(FINISHED)
      return clear
    }

    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms))
    }

    const play = () => {
      clear()
      setState({ typed: 0, steps: BUILDER_STEPS.map(() => 'idle'), phase: 'idle' })
      let t = BUILDER_TIMING.typeStart
      for (let n = 1; n <= BUILDER_PROMPT.length; n += 1) {
        at(t + n * BUILDER_TIMING.perChar, () => setState((s) => ({ ...s, typed: n })))
      }
      t += BUILDER_PROMPT.length * BUILDER_TIMING.perChar + BUILDER_TIMING.beforeSend
      at(t, () => setState((s) => ({ ...s, phase: 'sending' })))
      at(t + BUILDER_TIMING.sending, () => setState((s) => ({ ...s, phase: 'thinking' })))
      t += 400
      BUILDER_STEPS.forEach((_, i) => {
        const setStep = (value: StepState) =>
          setState((s) => ({ ...s, steps: s.steps.map((v, j) => (j === i ? value : v)) }))
        at(t + i * BUILDER_TIMING.stepGap, () => setStep('working'))
        at(t + i * BUILDER_TIMING.stepGap + BUILDER_TIMING.stepWork, () => setStep('done'))
      })
      t += BUILDER_STEPS.length * BUILDER_TIMING.stepGap + 200
      at(t, () => setState((s) => ({ ...s, phase: 'idle' })))
      at(t + BUILDER_TIMING.hold, play)
    }

    play()
    return clear
  }, [active, reduced])

  // Step n (1-based) reveals its site section once done.
  const shown = (step: number) => state.steps[step - 1] === 'done'
  const thinking = state.phase === 'thinking' && !reduced

  return (
    <div
      ref={ref}
      role="img"
      aria-label={LABEL}
      className={cn('cut-bld', thinking && 'is-thinking', state.phase === 'sending' && 'is-sending', reduced && 'is-still')}
    >
      <div aria-hidden="true" className="cut-bld-left">
        <div className="cut-pbox">
          <span className="cut-orb" />
          <span className="cut-ptext">
            {BUILDER_PROMPT.slice(0, state.typed)}
            <span className="cut-caret" />
          </span>
          <span className="cut-send">↑</span>
        </div>
        <ol className="cut-steps">
          {BUILDER_STEPS.map((label, i) => (
            <li key={label} className={cn(state.steps[i] === 'working' && 'working', state.steps[i] === 'done' && 'done')}>
              <i />
              {label}
            </li>
          ))}
        </ol>
      </div>

      <div aria-hidden="true" className="cut-browser">
        <div className="cut-bbar">
          <i />
          <i />
          <i />
          <span className="cut-url">
            <span className="cut-lock">●</span> yourfoodhouse.com
          </span>
        </div>
        <div className="cut-bsite">
          <div className={cn('cut-bs cut-bs-hero', shown(2) && 'show')}>
            <Image src={hostImage('B1').file} alt="" width={1200} height={430} sizes="(min-width: 1024px) 30vw, 90vw" loading="lazy" />
            <div className="cut-bs-hero-in">
              <b>24/7 Food House</b>
              <span>Lekki · open all night</span>
              <div className="cut-bs-btns">
                <em>Order online</em>
                <em className="ghost">Book a table</em>
              </div>
            </div>
          </div>
          <div className={cn('cut-bs cut-bs-menu', shown(3) && 'show')}>
            <div className="cut-bs-h">Menu</div>
            <div className="cut-bs-items">
              {MENU.map((item) => (
                <div key={item.slot}>
                  <Image src={hostImage(item.slot).file} alt="" width={480} height={360} sizes="120px" loading="lazy" />
                  <span>{item.name}</span>
                  <em>Add</em>
                </div>
              ))}
            </div>
          </div>
          <div className={cn('cut-bs cut-bs-book', shown(4) && 'show')}>
            <div className="cut-bs-h">Book a table</div>
            <div className="cut-bs-form">
              <span>Date</span>
              <span>Time</span>
              <span>Guests</span>
              <em>Book</em>
            </div>
          </div>
        </div>
        <div className={cn('cut-live', shown(5) && 'show')}>
          <span className="cut-live-dot" />
          Your site is live
        </div>
      </div>
    </div>
  )
}
