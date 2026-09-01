'use client'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CalendarCheck, ImageIcon, UtensilsCrossed } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'

// ---------------------------------------------------------------
// #2902 — the Ari composer, and the site it produces.
//
// Adapted from the supplied `creative-card`, rebranded to Ari and extended
// into a two-phase demo: Ari receives a prompt, then the real site it built
// scrolls past inside the same card.
//
// DEPENDENCIES: none added. lucide-react and framer-motion are both here;
// `@/lib/utils` → `@/lib/cn`.
//
// FOUR CHANGES TO THE SUPPLIED SOURCE:
//
//  1. PRESENTATIONAL, NOT INTERACTIVE. The original ships a live <textarea>,
//     three icon buttons and a send button. On a marketing page not one of
//     them can do anything — four dead controls, which this codebase forbids.
//     The whole composer is therefore one `role="img"` with a full label, the
//     same treatment the shipped `AriInput` uses for exactly this reason.
//  2. THE GLOWS ARE GONE. The original's `bg-gradient-radial` corner blob and
//     the white `drop-shadow-[0_0_5px_#fff]` on send both come out, per the
//     standing no-glow rule for components.
//  3. THE ARI ORB replaces the plain composer chrome — the same warm CSS orb
//     the shipped AriInput draws, so this reads as Ari and not as a generic
//     chat box.
//  4. TOKENS, not `dark:` variants. The tile it sits in is already dark, so
//     the component takes the surrounding Cutout tokens rather than carrying
//     its own light/dark fork.
//
// The reveal is a CAPTURED SCROLL of the real site, not an iframe:
// usemingla.com sets `frame-ancestors 'self'`, and a live frame is heavy on a
// page whose Core Web Vitals this issue exists to fix.
// ---------------------------------------------------------------

const PROMPT =
  'Build a site for my 24/7 food house in Lekki — the menu with prices, online ordering, and a table booking form.'

const CHIPS = [
  { icon: UtensilsCrossed, label: 'Menu & prices' },
  { icon: ImageIcon, label: 'Gallery' },
  { icon: CalendarCheck, label: 'Table bookings' },
]

const TYPE_MS = 26
const HOLD_AFTER_TYPING = 900
const SCROLL_MS = 9000
const HOLD_AT_END = 1400

type Phase = 'typing' | 'building' | 'site'

export function AriCreativeCard({
  siteSrc,
  siteAlt,
  className,
}: {
  siteSrc: string
  siteAlt: string
  className?: string
}) {
  const reduced = useMinglaReducedMotion()
  const { ref, active } = useActiveInViewport<HTMLDivElement>()
  const [phase, setPhase] = useState<Phase>('typing')
  const [typed, setTyped] = useState('')
  // How far through the brief we are, 0–1. Drives the skeleton filling in.
  const progress = phase === 'building' ? 1 : typed.length / PROMPT.length
  const timers = useRef<number[]>([])

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
  }

  useEffect(() => {
    // Reduced motion: skip the performance entirely and rest on the result.
    if (reduced) {
      setTyped(PROMPT)
      setPhase('site')
      return
    }
    // Pauses off-screen and on a hidden tab, like everything else here. A
    // continuous loop in peripheral vision is the one thing worth gating.
    if (!active) return

    let cancelled = false
    const run = () => {
      if (cancelled) return
      clearTimers()
      setPhase('typing')
      setTyped('')
      const chars = Array.from(PROMPT)
      chars.forEach((_, i) => {
        timers.current.push(
          window.setTimeout(() => setTyped(chars.slice(0, i + 1).join('')), i * TYPE_MS),
        )
      })
      const typedDone = chars.length * TYPE_MS
      timers.current.push(window.setTimeout(() => setPhase('building'), typedDone + HOLD_AFTER_TYPING))
      timers.current.push(window.setTimeout(() => setPhase('site'), typedDone + HOLD_AFTER_TYPING + 900))
      timers.current.push(
        window.setTimeout(run, typedDone + HOLD_AFTER_TYPING + 900 + SCROLL_MS + HOLD_AT_END),
      )
    }
    run()
    return () => {
      cancelled = true
      clearTimers()
    }
  }, [active, reduced])

  return (
    <div ref={ref} className={cn('relative h-full w-full overflow-hidden rounded-2xl', className)}>
      <AnimatePresence mode="wait">
        {phase === 'site' ? (
          <motion.div
            key="site"
            initial={reduced ? false : { opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 overflow-hidden rounded-2xl bg-black/25 ring-1 ring-inset ring-white/15"
          >
            {/* Browser chrome, so it reads as a website and not a photo. */}
            <div
              aria-hidden="true"
              className="flex h-7 items-center gap-1.5 bg-black/40 px-3"
            >
              <span className="h-2 w-2 rounded-full bg-white/25" />
              <span className="h-2 w-2 rounded-full bg-white/25" />
              <span className="h-2 w-2 rounded-full bg-white/25" />
              <span className="ml-2 truncate text-[10px] text-white/45">gogi-lagos.vercel.app</span>
            </div>
            <div className="relative h-[calc(100%-1.75rem)] overflow-hidden">
              <motion.img
                src={siteSrc}
                alt={siteAlt}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="absolute left-0 top-0 w-full"
                initial={reduced ? false : { y: 0 }}
                animate={reduced ? undefined : { y: '-62%' }}
                transition={{ duration: SCROLL_MS / 1000, ease: 'linear' }}
              />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="composer"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: reduced ? 0 : 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 flex flex-col"
          >
            {/* One presentational object. Nothing inside is focusable, because
                nothing inside can do anything on this page. */}
            <div
              role="img"
              aria-label={`Ari, the Mingla Host assistant, receiving the request: ${PROMPT}`}
              className="rounded-2xl bg-black/25 p-3 ring-1 ring-inset ring-white/15 backdrop-blur-sm"
            >
              <div className="flex items-start gap-3">
                {/* The Ari orb, as the shipped AriInput draws it. */}
                <span className="relative mt-0.5 h-9 w-9 shrink-0" aria-hidden="true">
                  {!reduced && active ? (
                    <span
                      className="absolute inset-0 rounded-full opacity-50"
                      style={{ background: '#eb7825', animation: 'mingla-orb-pulse 2.4s ease-in-out infinite' }}
                    />
                  ) : null}
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{
                      background:
                        'radial-gradient(circle at 34% 28%, #ffe2c4 0%, #f7a45a 38%, #eb7825 62%, #c2410c 100%)',
                      boxShadow: 'inset 0 -3px 8px rgba(120,40,0,0.45)',
                    }}
                  />
                </span>

                <p className="min-h-[3.5rem] flex-1 font-dashboard text-[0.875rem] leading-snug text-white/90">
                  {typed}
                  <span
                    aria-hidden="true"
                    className={cn('ml-0.5 inline-block w-[2px] -translate-y-[1px] align-middle', !reduced && 'animate-pulse')}
                    style={{ height: '1.05em', background: '#eb7825' }}
                  />
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {CHIPS.map(({ icon: Icon, label }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[0.6875rem] font-semibold text-white/70"
                  >
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {label}
                  </span>
                ))}
                <span className="ml-auto text-[0.625rem] font-bold uppercase tracking-[0.14em] text-white/40">
                  Ari
                </span>
              </div>
            </div>

            {/* The page forming underneath as the brief is typed. It fills
                what was dead space and makes the transition to the real site
                read as a continuation rather than a cut. */}
            <div
              aria-hidden="true"
              className="mt-4 flex flex-1 flex-col gap-2 overflow-hidden rounded-2xl bg-black/15 p-4 ring-1 ring-inset ring-white/10"
            >
              {[
                { w: '38%', h: 10 },
                { w: '100%', h: 42 },
                { w: '72%', h: 10 },
              ].map((blk, i) => (
                <motion.span
                  key={i}
                  className="block rounded-md bg-white/22"
                  style={{ width: blk.w, height: blk.h }}
                  initial={{ opacity: 0, scaleX: 0.25 }}
                  animate={{
                    opacity: progress > (i + 1) / 6 ? 1 : 0.14,
                    scaleX: progress > (i + 1) / 6 ? 1 : 0.25,
                  }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                />
              ))}
              <div className="mt-1 flex gap-2">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-8 flex-1 rounded-md bg-white/16"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{
                      opacity: progress > 0.62 + i * 0.1 ? 1 : 0.12,
                      y: progress > 0.62 + i * 0.1 ? 0 : 6,
                    }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  />
                ))}
              </div>
              <p className="mt-auto text-center text-[0.75rem] font-semibold text-white/60">
                {phase === 'building' ? 'Publishing…' : 'Ari is drafting the page'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
