'use client'
import { useRef, useState } from 'react'
import { useScroll, useMotionValueEvent } from 'framer-motion'
import { Sparkles, Bot, Megaphone, type LucideIcon } from 'lucide-react'
import { Reveal } from '@/components/ui/reveal'
import { AriInput } from '@/components/sections/organiser-home/ari-input'
import {
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperTitle,
  StepperDescription,
  StepperNav,
} from '@/components/ui/stepper'

// ORCH-1010 — "What is Mingla?" Split column: the explainer on the left, an
// adapted vertical auto-advancing Stepper on the right showing how consumer
// Mingla and Mingla Business connect — vibe matching, one AI (Ari) across both
// sides, and the marketing tools.

interface Step {
  step: number
  icon: LucideIcon
  title: string
  description: string
}

const STEPS: Step[] = [
  {
    step: 1,
    icon: Sparkles,
    title: 'Find the vibe',
    description:
      'People come to Mingla to find a vibe, not a venue. They name the night they want; we surface the places, events, and experiences that fit — and match you to the exact people already looking for what you offer.',
  },
  {
    step: 2,
    icon: Bot,
    title: 'One AI, both sides',
    description:
      'Ari, your AI partner in Mingla Business, names your vibe, builds your page, and runs your marketing. The same intelligence powers the consumer side — placing you in front of the right people at the right moment. One brain, working both ends.',
  },
  {
    step: 3,
    icon: Megaphone,
    title: 'Grow on autopilot',
    description:
      'Turn discovery into regulars: email blasts to your real buyers, a customer list you own, and AI reach that fills your slow nights — all from one place.',
  },
]

// Map scroll progress through the section to the active step. Scrubbing the
// steps on scroll lets visitors read each one (a middle ground between a static
// list and a timed auto-loop).
function stepForProgress(v: number, count: number): number {
  return Math.min(count, Math.max(1, Math.floor(v * count) + 1))
}

export function OrganiserWhatIsMingla() {
  const [active, setActive] = useState(1)
  const sectionRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  })
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    setActive(stepForProgress(v, STEPS.length))
  })

  // Desktop: the section is tall and the content is pinned (sticky), so scrolling
  // scrubs the 3 steps while everything stays in view — each step gets a real
  // reading moment. Mobile: normal flow, all steps shown expanded (below).
  return (
    <section ref={sectionRef} className="relative lg:min-h-[180vh]">
      {/* Warm glow at the seam — the section emerges from the hero's dark wall
          into a warm-lit space (continuous-experience transition, no hard line). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'radial-gradient(120% 100% at 50% 0%, rgba(235,120,37,0.12) 0%, transparent 60%)',
        }}
      />
      <div className="flex items-center px-6 py-24 md:px-10 md:py-32 lg:sticky lg:top-0 lg:min-h-screen [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2 lg:items-stretch lg:gap-20">
        {/* LEFT — what is Mingla */}
        <div className="flex max-w-xl flex-col justify-center">
          <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
            What is Mingla?
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-3xl leading-[1.06] tracking-[-0.02em] text-text-primary md:text-5xl">
              We make real life <span className="text-warm-ink">easier to find.</span>
            </h2>
          </Reveal>

          {/* Ari typing bar — different operators, different asks. */}
          <Reveal delay={0.1}>
            <AriInput className="mt-8" />
          </Reveal>

          <Reveal delay={0.18}>
            <p className="mt-6 text-base leading-relaxed text-text-secondary md:text-lg">
              The places with the most soul are often the hardest to find — not because people
              wouldn&rsquo;t love them, but because attention is scattered and running a business
              already takes everything you have. Mingla is the other side of that: people find the
              night they&rsquo;re after by vibe, not by searching, and your place is what they find.
              And you don&rsquo;t do the finding alone — Ari helps name your vibe, build your page,
              and spin up the kind of event that fills a room, then put it in front of the right
              people from inside the app, so you spend less on marketing and less time fighting to
              be seen. Because Mingla exists to make real life easier to find — for the people
              looking, and for the places worth finding.
            </p>
          </Reveal>
        </div>

        {/* RIGHT — the connecting steps (scroll-driven). h-full so the column
            matches the left column's height for desktop uniformity. */}
        <Reveal delay={0.1} className="flex flex-col justify-center lg:h-full">
          <Stepper
            value={active}
            onValueChange={setActive}
            orientation="vertical"
            className="font-dashboard lg:h-full"
          >
            <StepperNav className="w-full flex-col gap-0 lg:h-full">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                const isLast = i === STEPS.length - 1
                return (
                  <StepperItem
                    key={s.step}
                    step={s.step}
                    className="w-full !flex-row !items-stretch !justify-start lg:flex-1"
                  >
                    <StepperTrigger className="flex w-full items-stretch gap-4 rounded-2xl p-3 text-left transition-colors duration-300 hover:bg-black/[0.025] data-[state=active]:bg-black/[0.03]">
                      {/* indicator + connector column */}
                      <div className="flex flex-col items-center">
                        <StepperIndicator>
                          <Icon className="size-[18px]" />
                        </StepperIndicator>
                        {!isLast ? (
                          <span
                            aria-hidden="true"
                            className="my-1 w-0.5 flex-1 rounded-full bg-black/10"
                          />
                        ) : null}
                      </div>
                      {/* text column */}
                      <div className="pb-6 pt-1.5">
                        <StepperTitle className="lg:data-[state=inactive]:text-text-muted">
                          {s.title}
                        </StepperTitle>
                        {/* Mobile: always expanded (readable without scroll-scrub).
                            Desktop: collapse/expand driven by the scroll-active step. */}
                        <StepperDescription className="mt-2 overflow-hidden lg:mt-0 lg:max-h-0 lg:opacity-0 lg:transition-all lg:duration-500 lg:ease-out lg:data-[state=active]:mt-2 lg:data-[state=active]:max-h-44 lg:data-[state=active]:opacity-100">
                          {s.description}
                        </StepperDescription>
                      </div>
                    </StepperTrigger>
                  </StepperItem>
                )
              })}
            </StepperNav>
          </Stepper>
        </Reveal>
        </div>
      </div>
    </section>
  )
}
