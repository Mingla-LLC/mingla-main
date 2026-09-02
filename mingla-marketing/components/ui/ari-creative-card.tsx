'use client'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUp, CalendarCheck, ImageIcon, UtensilsCrossed } from 'lucide-react'
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
// ONE BOX THAT GROWS. Earlier the composer was stretched to the site's full
// footprint so the swap would be seamless — but a chat bubble holding the
// whole tile open for a website that has not arrived yet reads as dead space.
//
// So the box is now sized by its CONTENT and animates between states: a
// compact composer, taller as Ari drafts, then expanding to fill the tile when
// the site arrives. Same box throughout — framer-motion's `layout` animates the
// change — so the transition is still continuous, just no longer pre-reserved.
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
const SCROLL_MS = 22000
const HOLD_AT_END = 2200

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
      timers.current.push(window.setTimeout(() => setPhase('site'), typedDone + HOLD_AFTER_TYPING + 2100))
      timers.current.push(
        window.setTimeout(run, typedDone + HOLD_AFTER_TYPING + 2100 + SCROLL_MS + HOLD_AT_END),
      )
    }
    run()
    return () => {
      cancelled = true
      clearTimers()
    }
  }, [active, reduced])

  return (
    <div ref={ref} className={cn('relative flex h-full w-full flex-col justify-end', className)}>
      <motion.div
        data-ari-screen={phase === 'site' ? 'site' : 'composer'}
        // `layout` is what makes the box GROW into the site rather than cut to
        // it. Off under reduced motion, where the size simply changes.
        layout={!reduced}
        transition={{ layout: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } }}
        className={cn(
          'shrink-0 rounded-2xl bg-black/25 ring-1 ring-inset ring-white/15 backdrop-blur-sm',
          phase === 'site' && 'h-full overflow-hidden',
        )}
      >
        <AnimatePresence mode="wait">
          {phase === 'site' ? (
            <motion.div
              key="site"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="flex h-full flex-col"
            >
              {/* Browser chrome, so it reads as a website and not a photo. */}
              <div aria-hidden="true" className="flex h-7 shrink-0 items-center gap-1.5 bg-black/40 px-3">
                <span className="h-2 w-2 rounded-full bg-white/25" />
                <span className="h-2 w-2 rounded-full bg-white/25" />
                <span className="h-2 w-2 rounded-full bg-white/25" />
              </div>
              <div className="relative flex-1 overflow-hidden">
                <motion.img
                  src={siteSrc}
                  alt={siteAlt}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="absolute left-0 top-0 w-full"
                  initial={reduced ? false : { y: 0 }}
                  animate={reduced ? undefined : { y: '-62%' }}
                  transition={{ duration: SCROLL_MS / 1000, ease: 'linear', delay: 0.5 }}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="composer"
              role="img"
              aria-label={`Ari, the Mingla Host assistant, receiving the request: ${PROMPT}`}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.3 }}
              className="p-4"
            >
              <div className="flex items-start gap-3">
                {/* The Ari orb, as the shipped AriInput draws it. */}
                <span className="relative mt-0.5 h-10 w-10 shrink-0" aria-hidden="true">
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

                <p className="min-h-[2.5rem] flex-1 font-dashboard text-[0.9375rem] leading-snug text-white/90">
                  {typed}
                  <span
                    aria-hidden="true"
                    className={cn('ml-0.5 inline-block w-[2px] -translate-y-[1px] align-middle', !reduced && 'animate-pulse')}
                    style={{ height: '1.05em', background: '#eb7825' }}
                  />
                </p>
              </div>

              {/* Drafting, INSIDE the chat: Ari's reply lands in the same bubble
                  as the brief, and the box grows to hold it. */}
              <AnimatePresence>
                {phase === 'building' ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 flex items-center gap-3 border-t border-white/12 pt-3">
                      <span className="flex gap-1" aria-hidden="true">
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            className="h-1.5 w-1.5 rounded-full bg-white/70"
                            animate={{ opacity: [0.25, 1, 0.25] }}
                            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.16 }}
                          />
                        ))}
                      </span>
                      <span className="font-dashboard text-[0.8125rem] text-white/80">
                        Building your site…
                      </span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {[
                        { w: '34%', h: 6 },
                        { w: '100%', h: 22 },
                      ].map((blk, i) => (
                        <motion.span
                          key={i}
                          className="block rounded bg-white/22"
                          style={{ width: blk.w, height: blk.h }}
                          initial={{ opacity: 0, scaleX: 0.3 }}
                          animate={{ opacity: 1, scaleX: 1 }}
                          transition={{ duration: 0.4, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                        />
                      ))}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {CHIPS.map(({ icon: Icon, label }) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[0.6875rem] font-semibold text-white/70"
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {label}
                    </span>
                  ))}
                </div>

                <span
                  aria-hidden="true"
                  data-ari-send=""
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white"
                  style={{
                    background: 'linear-gradient(180deg, #f0842f 0%, #dd6a16 100%)',
                    boxShadow:
                      '0 -2px 0 0 #a8450e inset, 0 1px 0 0 rgba(255,255,255,0.3) inset, 0 4px 10px rgba(20,18,15,0.28)',
                  }}
                >
                  <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.4} />
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
