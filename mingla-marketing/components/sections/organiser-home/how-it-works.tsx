'use client'
import { Reveal, RevealGroup } from '@/components/ui/reveal'

// ORCH-1010 — the real journey from the owner's chair in 4 true steps, ending
// on "a full room". A hairline through-line with warm-ink step nodes makes it
// read as a journey, not a feature list. Vellum band (alt-surface rhythm).

interface Step {
  n: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    n: '01',
    title: "show us what you've got",
    body: 'Your place, your menu, your event, your trip, your class, your pop-up — whatever you want people to show up for.',
  },
  {
    n: '02',
    title: 'we make it impossible to ignore',
    body: "We turn it into a page and a story people get in seconds: the vibe, the details that matter, the reason it's worth leaving the house for.",
  },
  {
    n: '03',
    title: 'we put it in front of the right people',
    body: 'Mingla matches what you offer to people nearby by taste, mood, timing, budget, and what they’re already planning — not just who’s close, but who actually wants this tonight.',
  },
  {
    n: '04',
    title: 'they show up — and you can sell them the night',
    body: 'People discover you, save you, and book or buy right there. Sell tickets, packages, and tables with all-in pricing and no checkout surprises — then watch who came through the door.',
  },
]

export function OrganiserHowItWorks() {
  return (
    <section className="seam-top bg-vellum px-6 py-24 md:px-10 md:py-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-6xl">
        <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
          How it works
        </Reveal>

        <Reveal>
          <h2 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-7xl">
            from what you have <br className="hidden md:block" />
            <span className="text-warm-ink">to a full room.</span>
          </h2>
        </Reveal>

        {/* Step row. On lg, a hairline rail runs behind the number nodes. */}
        <div className="relative mt-16">
          {/* Desktop horizontal rail — behind the 40px node baseline. */}
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-5 hidden h-px lg:block"
            style={{ background: 'var(--seam-light)' }}
          />
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            <RevealGroup
              items={STEPS}
              step={0.08}
              base={0.2}
              keyFor={(step) => step.n}
            >
              {(step) => (
                <div className="relative flex flex-col gap-4 pl-16 lg:pl-0">
                  {/* Number node sitting ON the rail. Mobile: left gutter with a
                      vertical hairline; lg: inline at the top of the column. */}
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-0 flex size-10 items-center justify-center rounded-full bg-warm/12 font-display text-base text-warm-ink lg:relative"
                    style={{ boxShadow: 'var(--elev-1)' }}
                  >
                    {step.n}
                  </span>
                  {/* Mobile vertical rail segment in the left gutter (the
                      horizontal --seam-light gradient is invisible vertically,
                      so the vertical leg uses the ink divider tint directly). */}
                  <span
                    aria-hidden="true"
                    className="absolute left-5 top-10 bottom-[-2rem] w-px bg-[rgba(14,14,16,0.10)] lg:hidden"
                  />
                  <h3 className="font-display text-xl leading-tight tracking-[-0.005em] text-text-primary md:text-2xl">
                    {step.title}
                  </h3>
                  <p className="text-base leading-relaxed text-text-secondary">
                    {step.body}
                  </p>
                </div>
              )}
            </RevealGroup>
          </div>
        </div>
      </div>
    </section>
  )
}
