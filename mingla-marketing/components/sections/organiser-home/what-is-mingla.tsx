'use client'

import { useEffect, useRef, useState } from 'react'
import { useInView } from 'framer-motion'
import { Bot, Megaphone, Sparkles, type LucideIcon } from 'lucide-react'
import { Reveal } from '@/components/ui/reveal'
import { AriInput } from '@/components/sections/organiser-home/ari-input'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import {
  Stepper,
  StepperItem,
  StepperTrigger,
  StepperIndicator,
  StepperTitle,
  StepperDescription,
  StepperNav,
} from '@/components/ui/stepper'

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
    title: 'Build with Ari',
    description:
      'Start with a simple brief. Ari helps shape your page, offer, and marketing so you can move from idea to something ready to publish.',
  },
  {
    step: 2,
    icon: Bot,
    title: 'Match real intent',
    description:
      'The Mingla AI brain understands what people want by vibe, place, and timing — then connects that intent with relevant hosts.',
  },
  {
    step: 3,
    icon: Megaphone,
    title: 'Drive qualified discovery',
    description:
      'Mingla helps put you in front of people already looking for your kind of plan, turning consumer intent into relevant traffic, bookings, and guest relationships.',
  },
]

const STEP_DURATION_MS = 1700

export function OrganiserWhatIsMingla() {
  const [active, setActive] = useState(1)
  const [interacted, setInteracted] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const reduced = useMinglaReducedMotion()
  const inView = useInView(sectionRef, { once: true, amount: 0.25 })

  useEffect(() => {
    if (!inView) return
    if (reduced) {
      setActive(STEPS.length)
      return
    }
    if (interacted) return

    const timers = STEPS.slice(1).map((step, index) =>
      window.setTimeout(() => setActive(step.step), STEP_DURATION_MS * (index + 1)),
    )

    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [inView, interacted, reduced])

  const handleStepChange = (step: number): void => {
    setInteracted(true)
    setActive(step)
  }

  return (
    <section ref={sectionRef} className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72"
        style={{
          background:
            'radial-gradient(120% 100% at 50% 0%, rgba(235,120,37,0.12) 0%, transparent 60%)',
        }}
      />
      <div className="flex items-center px-6 py-24 md:px-10 md:py-32 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2 lg:items-stretch lg:gap-20">
          <div className="flex max-w-xl flex-col justify-center">
            <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
              What is Mingla?
            </Reveal>
            <Reveal>
              <h2 className="mt-4 font-display text-3xl leading-[1.06] tracking-[-0.02em] text-text-primary md:text-5xl">
                We make real life <span className="text-warm-ink">easier to find.</span>
              </h2>
            </Reveal>

            <Reveal delay={0.1}>
              <AriInput className="mt-8" />
            </Reveal>

            <Reveal delay={0.18}>
              <div className="mt-6 space-y-4 text-base leading-relaxed text-text-secondary md:text-lg">
                <p>
                  Ari helps turn what makes your place or experience special into a page, an offer,
                  and marketing people can understand.
                </p>
                <p>
                  Then the Mingla AI brain reads what people are looking for by vibe, place, and
                  timing&mdash;helping drive relevant discovery back to hosts instead of leaving
                  them to fight for random attention.
                </p>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.1} className="flex flex-col justify-center lg:h-full">
            <Stepper
              value={active}
              onValueChange={handleStepChange}
              orientation="vertical"
              className="font-dashboard lg:h-full"
            >
              <StepperNav className="w-full flex-col gap-0 lg:h-full">
                {STEPS.map((step, index) => {
                  const Icon = step.icon
                  const isLast = index === STEPS.length - 1
                  return (
                    <StepperItem
                      key={step.step}
                      step={step.step}
                      className="w-full !flex-row !items-stretch !justify-start lg:flex-1"
                    >
                      <StepperTrigger className="flex w-full items-stretch gap-4 rounded-2xl p-3 text-left transition-colors duration-300 hover:bg-black/[0.025] data-[state=active]:bg-black/[0.03]">
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
                        <div className="pb-6 pt-1.5">
                          <StepperTitle className="lg:data-[state=inactive]:text-text-muted">
                            {step.title}
                          </StepperTitle>
                          <StepperDescription className="mt-2 overflow-hidden lg:mt-0 lg:max-h-0 lg:opacity-0 lg:transition-all lg:duration-500 lg:ease-out lg:data-[state=active]:mt-2 lg:data-[state=active]:max-h-36 lg:data-[state=active]:opacity-100 lg:data-[state=completed]:mt-2 lg:data-[state=completed]:max-h-36 lg:data-[state=completed]:opacity-100">
                            {step.description}
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
