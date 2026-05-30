'use client'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Reveal } from '@/components/ui/reveal'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — "Built for". The FULL experience economy across 6 image cards that
// drift slowly to the right (marquee), with a pin-dot chip cloud of business
// types around the heading. Make the owner say "that's me".
//
// Photos: Unsplash (free license) — hotlinked CDN, verified to load. Swap freely.

interface Audience {
  eyebrow: string
  title: string
  body: string
  cta: string
  image: string
}

const IMG = (id: string): string =>
  `https://images.unsplash.com/photo-${id}?w=1100&q=70&auto=format&fit=crop`

const AUDIENCES: Audience[] = [
  {
    eyebrow: 'Restaurants & cafés',
    title: 'make your menu the reason.',
    body: 'The handmade pasta. The patio at golden hour. The cocktail only your bartender can make. Mingla turns your menu, your room, and your best nights into something people book a table for.',
    cta: 'Fill more tables',
    image: IMG('1517248135467-4c7edcad34c4'),
  },
  {
    eyebrow: 'Bars, clubs & nightlife',
    title: 'give people a night they brag about.',
    body: "The DJ. The sound. The room when it's full. The thing everyone wants to be in. Mingla turns your energy into a crowd that shows up — and comes back.",
    cta: 'Build the crowd',
    image: IMG('1545128485-c400e7702796'),
  },
  {
    eyebrow: 'Venues & activity spaces',
    title: 'be the plan, not the afterthought.',
    body: 'A date. A birthday. A team night. A weekend ritual. Mingla shapes your space and packages into plans people actively choose — and pay for up front.',
    cta: 'Sell more group plans',
    image: IMG('1492684223066-81342ee5ff30'),
  },
  {
    eyebrow: 'Events & promoters',
    title: 'sell the night, not just the ticket.',
    body: 'A flyer says what’s happening. Mingla says why it matters — the lineup, the crowd, the culture, the timing — and lets people buy in seconds.',
    cta: 'Sell out your event',
    image: IMG('1459749411175-04bf5292ceea'),
  },
  {
    eyebrow: 'Experiences, trips & adventures',
    title: 'turn a thing-to-do into a must-do.',
    body: 'Cooking classes, horseback rides, tours, day trips, tastings, outdoor adventures. Mingla helps experience and trip organizers turn “that sounds fun” into a booking — matched to the people already looking for exactly this.',
    cta: 'Book out your experience',
    image: IMG('1556910103-1c02745aae4d'),
  },
  {
    eyebrow: 'Pop-ups & independent creators',
    title: 'land fast. land hard.',
    body: 'A pop-up has one shot. Mingla helps chefs, artists, makers, and curators turn concept, scarcity, and timing into something people feel they cannot miss.',
    cta: 'Launch your pop-up',
    image: IMG('1555396273-367ea4eb4db5'),
  },
]

// Pin-dot chips — business types that could use Mingla, scattered around the
// heading like map pins.
// Business-type pins, scattered ABOVE and BELOW the heading only (never over the
// text) so nothing overlaps the headline on mobile or desktop.
const CHIPS: { label: string; s: React.CSSProperties }[] = [
  // above
  { label: 'Restaurant', s: { top: '-20%', left: '-2%' } },
  { label: 'Taco truck', s: { top: '-40%', left: '22%' } },
  { label: 'Pottery studio', s: { top: '-22%', left: '48%' } },
  { label: 'Trip planners', s: { top: '-42%', left: '68%' } },
  { label: 'Rooftop bar', s: { top: '-26%', right: '-3%' } },
  // below
  { label: 'Sunday market', s: { top: '116%', left: '-2%' } },
  { label: 'Comedy night', s: { top: '140%', left: '22%' } },
  { label: 'Wine tasting', s: { top: '120%', left: '48%' } },
  { label: 'Supper club', s: { top: '142%', left: '66%' } },
  { label: 'Food festival', s: { top: '122%', right: '-3%' } },
]

function Pin({
  label,
  index,
  reduced,
  className,
  style,
}: {
  label: string
  index: number
  reduced: boolean
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-sm ring-1 ring-black/[0.06] backdrop-blur',
        className,
      )}
      style={{
        ...style,
        animation: reduced ? undefined : `mingla-chip-pulse 4.5s ease-in-out ${index * 0.4}s infinite`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--color-success)' }} />
      {label}
    </span>
  )
}

function AudienceCard({ a }: { a: Audience }) {
  return (
    <article
      className="group relative h-[430px] w-[300px] shrink-0 overflow-hidden rounded-2xl sm:w-[340px]"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={a.image}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover transition-transform duration-500 ease-out-quart group-hover:scale-105"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to top, rgba(8,9,12,0.97) 0%, rgba(8,9,12,0.9) 28%, rgba(8,9,12,0.5) 54%, rgba(8,9,12,0) 100%)',
        }}
      />
      {/* Category — orange chip, white text, top of the card. */}
      <span
        className="absolute left-5 top-5 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm"
        style={{ background: 'var(--color-warm)' }}
      >
        {a.eyebrow}
      </span>
      <div className="absolute inset-x-0 bottom-0 flex flex-col justify-end p-6">
        <h3 className="font-display text-2xl leading-tight tracking-[-0.005em] text-white">
          {a.title}
        </h3>
        <p className="mt-2.5 line-clamp-2 text-sm leading-snug text-white/80">{a.body}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
          {a.cta}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 ease-out-quart group-hover:translate-x-1"
            aria-hidden="true"
          />
        </span>
      </div>
    </article>
  )
}

export function OrganiserAudiences() {
  const reduced = useMinglaReducedMotion()
  const loop = [...AUDIENCES, ...AUDIENCES]

  return (
    <section className="seam-top relative overflow-hidden pb-24 pt-24 md:pb-32 lg:pt-48 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]">
      {/* Heading + pin-dot chip cloud */}
      <div className="relative mx-auto max-w-3xl px-6 text-center md:px-10">
        {/* Desktop: scattered pin cloud around the heading. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
          {CHIPS.map((c, i) => (
            <Pin key={c.label} label={c.label} index={i} reduced={reduced} className="absolute" style={c.s} />
          ))}
        </div>

        {/* Mobile: clean wrapped rows above + below the heading (no overlap). */}
        <div aria-hidden="true" className="mb-8 flex flex-wrap justify-center gap-2 lg:hidden">
          {CHIPS.slice(0, 5).map((c, i) => (
            <Pin key={c.label} label={c.label} index={i} reduced={reduced} />
          ))}
        </div>

        <Reveal>
          <h2 className="mx-auto max-w-2xl font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-6xl">
            whatever you create,{' '}
            <span className="text-warm-ink">Mingla makes it the plan.</span>
          </h2>
        </Reveal>

        <div aria-hidden="true" className="mt-8 flex flex-wrap justify-center gap-2 lg:hidden">
          {CHIPS.slice(5).map((c, i) => (
            <Pin key={c.label} label={c.label} index={i + 5} reduced={reduced} />
          ))}
        </div>
      </div>

      {/* Right-drifting marquee of image cards, edge-faded. Generous gap below
          the heading so the pin chips don't crowd the cards. */}
      <div
        className="group relative mt-16 [mask-image:linear-gradient(90deg,transparent,#000_7%,#000_93%,transparent)] lg:mt-44"
        aria-label="Business types Mingla is built for"
      >
        <div
          className="flex w-max gap-5 group-hover:[animation-play-state:paused]"
          style={{ animation: reduced ? undefined : 'mingla-marquee-x 60s linear infinite' }}
        >
          {loop.map((a, i) => (
            <div key={`${a.eyebrow}-${i}`} aria-hidden={i >= AUDIENCES.length}>
              <AudienceCard a={a} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
