'use client'
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Link2, Share2, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import {
  TruthfulPlaceCard,
  TruthfulPlanCard,
} from '@/components/design-preview/explorer/truthful-cards'
import { LAGOS_PLANS, LAGOS_VENUES } from '@/lib/design-preview/lagos-truth'
import { ProvenanceChip } from '@/components/design-preview/system/provenance-chip'
import { ThreeStepDemo, type DemoStep } from '@/components/design-preview/system/three-step-demo'

// #2902 — the Explorer proof lab.
//
// Every venue in here is a REAL Lagos place-pool record. The cards are the
// truthful variants from `truthful-cards.tsx` rather than the shipped
// `PlaceCard` / `IntentCard`, because those two render invented social proof
// and unverified plan totals as fact — see that file's header for the full
// reason and the production fix it implies.

const EASE = [0.16, 1, 0.3, 1] as const

/** The three intents the demo lets a reader choose between. */
const INTENTS = [
  { id: 'first-date', label: 'A slow first date' },
  { id: 'group-fun', label: 'A group night out' },
  { id: 'take-a-stroll', label: 'A cheap Sunday' },
] as const

type IntentId = (typeof INTENTS)[number]['id']

function CardStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center rounded-2xl bg-white/[0.03] p-6 ring-1 ring-inset ring-white/[0.07]">
      {children}
    </div>
  )
}

/** Step 1 — the reader picks the intent, exactly as an Explorer would. */
function IntentPicker({
  value,
  onChange,
}: {
  value: IntentId
  onChange: (id: IntentId) => void
}) {
  return (
    <div>
      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
          What are you actually trying to do?
        </legend>
        <div className="mt-4 flex flex-wrap gap-2">
          {INTENTS.map((intent) => {
            const isActive = intent.id === value
            return (
              <button
                key={intent.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onChange(intent.id)}
                className={cn(
                  'min-h-11 rounded-full px-5 text-sm font-semibold transition-colors duration-200 ease-out-quart focus-ring',
                  isActive
                    ? 'bg-warm text-white'
                    : 'bg-white/[0.07] text-white/72 ring-1 ring-inset ring-white/10 hover:bg-white/[0.12] hover:text-white',
                )}
              >
                {intent.label}
              </button>
            )
          })}
        </div>
      </fieldset>
      <p className="mt-6 max-w-md text-sm leading-relaxed text-white/55">
        Mingla starts from the plan, not the map. You say what kind of evening it is; the venues
        are the answer, not the question.
      </p>

      {/* What the choice actually moves. Added after reviewing the built page:
          the step-1 panel was a row of chips against a 360px card, and the
          imbalance read as an unfinished section rather than a calm one. */}
      <dl className="mt-8 space-y-4 border-l border-white/10 pl-5">
        {[
          ['The venues', 'A different set of real Lagos places, not the same list re-sorted.'],
          ['The order', 'Where the night starts and how it ends changes with the occasion.'],
          ['The budget band', 'A cheap Sunday and a group night are not the same money.'],
        ].map(([term, def]) => (
          <div key={term}>
            <dt className="font-display text-sm leading-tight text-white">{term}</dt>
            <dd className="mt-1 max-w-md text-sm leading-relaxed text-white/55">{def}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function LagosPlanLab() {
  const reduced = useMinglaReducedMotion()
  const [intent, setIntent] = useState<IntentId>('first-date')

  const plan = useMemo(
    () => LAGOS_PLANS.find((p) => p.id === intent) ?? LAGOS_PLANS[0],
    [intent],
  )

  /** The first stop's real venue record, so step 1 shows a real place card. */
  const leadVenue = useMemo(() => {
    const first = plan.stops[0]?.name
    return LAGOS_VENUES.find((v) => v.name === first) ?? LAGOS_VENUES[0]
  }, [plan])

  const steps: readonly DemoStep[] = [
    {
      id: 'intent',
      label: 'Say the plan',
      caption:
        'Pick the kind of evening. Everything after this responds to that choice — try switching it and watch the plan below change.',
      panel: (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14">
          <IntentPicker value={intent} onChange={setIntent} />
          <CardStage>
            <AnimatePresence mode="wait">
              <motion.div
                key={leadVenue.placeKey}
                initial={reduced ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.97 }}
                transition={{ duration: reduced ? 0 : 0.3, ease: EASE }}
              >
                <TruthfulPlaceCard venue={leadVenue} eager />
              </motion.div>
            </AnimatePresence>
          </CardStage>
        </div>
      ),
    },
    {
      id: 'plan',
      label: 'See the whole night',
      caption:
        'Mingla returns a route, not a list — where you start, where you go next, and how it ends. This is the real Mingla plan card.',
      panel: (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14">
          <div>
            <h3 className="font-display text-2xl leading-tight tracking-[-0.015em] text-white md:text-3xl">
              {plan.title}
            </h3>
            <p className="mt-3 max-w-md text-base leading-relaxed text-white/68">
              {plan.sellLine}
            </p>
            <ol className="mt-7 space-y-3.5">
              {plan.stops.map((stop, i) => (
                <li key={stop.name} className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warm/16 font-display text-xs tabular-nums text-warm"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-display text-base leading-tight text-white">{stop.name}</p>
                    <p className="mt-0.5 text-sm text-white/50">{stop.role}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ProvenanceChip kind="first-party" />
              <span className="text-xs leading-relaxed text-white/45">
                Venue names and photos are real place-pool records.
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ProvenanceChip kind="illustrative" />
              <span className="text-xs leading-relaxed text-white/45">
                The {plan.illustrativePriceRange} / {plan.illustrativeDuration} estimate is an
                example, not a quote or a booking.
              </span>
            </div>
          </div>
          <CardStage>
            <AnimatePresence mode="wait">
              <motion.div
                key={plan.id}
                initial={reduced ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -10 }}
                transition={{ duration: reduced ? 0 : 0.32, ease: EASE }}
              >
                <TruthfulPlanCard plan={plan} eager />
              </motion.div>
            </AnimatePresence>
          </CardStage>
        </div>
      ),
    },
    {
      id: 'share',
      label: 'Send it to the group',
      caption:
        'A plan is only real once other people agree to it. Mingla sends the whole route as one link the group can open, vote on, and lock.',
      panel: (
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14">
          <div>
            <ul className="space-y-4">
              {[
                {
                  icon: Link2,
                  title: 'One link, not five screenshots',
                  body: 'The route, the stops and the order travel together, so nobody has to reconstruct the night from a group chat.',
                },
                {
                  icon: Users,
                  title: 'The group decides in the plan',
                  body: 'Everyone opens the same plan and reacts to it, instead of a thread where the plan quietly dies.',
                },
                {
                  icon: Check,
                  title: 'It ends in a decision',
                  body: 'The point of the link is a locked plan and a date, not more discussion.',
                },
              ].map((row) => (
                <li key={row.title} className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warm/14"
                  >
                    <row.icon className="h-4 w-4 text-warm" strokeWidth={2.2} />
                  </span>
                  <div>
                    <p className="font-display text-base leading-tight text-white">{row.title}</p>
                    <p className="mt-1 max-w-md text-sm leading-relaxed text-white/58">
                      {row.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ProvenanceChip kind="product-capability" />
              <span className="text-xs leading-relaxed text-white/45">
                Group plans and shared links ship in the Mingla app today.
              </span>
            </div>
          </div>
          <CardStage>
            <div className="w-full max-w-[20rem] rounded-2xl bg-[#12141a] p-5 ring-1 ring-inset ring-white/10">
              <div className="flex items-center gap-2.5">
                <Share2 className="h-4 w-4 text-warm" aria-hidden="true" />
                <span className="font-dashboard text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
                  Shared plan
                </span>
              </div>
              <p className="mt-4 font-display text-lg leading-tight text-white">
                {plan.title}
              </p>
              <p className="mt-1.5 font-dashboard text-xs text-white/50">{plan.itineraryLabel}</p>
              <div className="mt-5 flex -space-x-2" aria-hidden="true">
                {plan.stops.map((stop) => (
                  <img
                    key={stop.name}
                    src={stop.photo}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="h-12 w-12 rounded-full object-cover ring-2 ring-[#12141a]"
                  />
                ))}
              </div>
              <p className="mt-5 font-dashboard text-[11px] leading-relaxed text-white/38">
                Opens in Mingla with every stop attached.
              </p>
            </div>
          </CardStage>
        </div>
      ),
    },
  ]

  return (
    <ThreeStepDemo
      steps={steps}
      polarity="night"
      label="How a Lagos plan comes together"
    />
  )
}
