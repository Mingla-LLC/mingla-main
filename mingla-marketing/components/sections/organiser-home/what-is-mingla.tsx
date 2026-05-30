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
    offset: ['start 0.85', 'end 0.2'],
  })
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    setActive(stepForProgress(v, STEPS.length))
  })

  return (
    <section
      ref={sectionRef}
      className="seam-top px-6 py-24 md:px-10 md:py-32 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]"
    >
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
        {/* LEFT — what is Mingla */}
        <div className="max-w-xl">
          <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
            What is Mingla?
          </Reveal>
          <Reveal>
            <h2 className="mt-4 font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-6xl">
              We make real life <span className="text-warm-ink">easier to find.</span>
            </h2>
          </Reveal>

          {/* Ari typing bar — different operators, different asks. */}
          <Reveal delay={0.1}>
            <AriInput className="mt-8" />
          </Reveal>

          <Reveal delay={0.18}>
            <p className="mt-6 text-lg leading-relaxed text-text-secondary md:text-xl">
              Mingla is where people find what to do — by vibe, not by searching. The consumer app
              surfaces the places, events, and experiences that match the night they want. Mingla
              Business is the other side of that coin: the AI and tools that get your place found,
              booked, and remembered.
            </p>
          </Reveal>
        </div>

        {/* RIGHT — the connecting steps (vertical, auto-advancing) */}
        <Reveal delay={0.1}>
          <Stepper
            value={active}
            onValueChange={setActive}
            orientation="vertical"
            className="font-dashboard"
          >
            <StepperNav className="w-full flex-col gap-0">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                const isLast = i === STEPS.length - 1
                return (
                  <StepperItem
                    key={s.step}
                    step={s.step}
                    className="w-full !flex-row !items-stretch !justify-start"
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
                        <StepperTitle className="data-[state=inactive]:text-text-muted">
                          {s.title}
                        </StepperTitle>
                        <StepperDescription className="mt-0 max-h-0 overflow-hidden opacity-0 transition-all duration-500 ease-out data-[state=active]:mt-2 data-[state=active]:max-h-44 data-[state=active]:opacity-100">
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
    </section>
  )
}
