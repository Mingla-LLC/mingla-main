'use client'

import { Reveal } from '@/components/ui/reveal'

interface Audience {
  eyebrow: string
  shortEyebrow: string
  title: string
  body: string
  image: string
  capabilities: readonly string[]
  placement: string
  emphasis: 'feature' | 'compact'
}

const IMG = (id: string): string =>
  `https://images.unsplash.com/photo-${id}?w=1400&q=78&auto=format&fit=crop`

const AUDIENCES: Audience[] = [
  {
    eyebrow: 'Venues & activity spaces',
    title: 'be the plan, not the afterthought.',
    body: 'Shape your space, packages, and group moments into plans people actively choose.',
    image: IMG('1492684223066-81342ee5ff30'),
    capabilities: ['Packages', 'Bookings', 'People'],
    shortEyebrow: 'Venues',
    placement: 'md:col-start-1 md:row-start-1 md:row-span-2',
    emphasis: 'feature',
  },
  {
    eyebrow: 'Restaurants & cafés',
    shortEyebrow: 'Dining',
    title: 'make your menu the reason.',
    body: 'Turn your menu, your room, and your best nights into plans people can discover and book.',
    image: IMG('1517248135467-4c7edcad34c4'),
    capabilities: ['Pages', 'Reservations', 'AI reach'],
    placement: 'md:col-start-2 md:col-span-2 md:row-start-1',
    emphasis: 'feature',
  },
  {
    eyebrow: 'Bars, clubs & nightlife',
    shortEyebrow: 'Nightlife',
    title: 'give people a night they brag about.',
    body: 'Package your energy into the kind of night the right crowd wants to join — and return to.',
    image: IMG('1545128485-c400e7702796'),
    capabilities: ['Events', 'Guest lists', 'Blasts'],
    placement: 'md:col-start-4 md:row-start-1',
    emphasis: 'compact',
  },
  {
    eyebrow: 'Events & promoters',
    shortEyebrow: 'Events',
    title: 'sell the night, not just the ticket.',
    body: 'Show people why the lineup, crowd, culture, and timing make your event worth joining.',
    image: IMG('1459749411175-04bf5292ceea'),
    capabilities: ['Tickets', 'QR entry', 'Campaigns'],
    placement: 'md:col-start-2 md:row-start-2',
    emphasis: 'compact',
  },
  {
    eyebrow: 'Experiences, trips & adventures',
    shortEyebrow: 'Experiences',
    title: 'turn a thing-to-do into a must-do.',
    body: 'Transform tours, classes, tastings, and adventures into experiences people can find and book.',
    image: IMG('1556910103-1c02745aae4d'),
    capabilities: ['Itineraries', 'Packages', 'Payments'],
    placement: 'md:col-start-3 md:row-start-2',
    emphasis: 'compact',
  },
  {
    eyebrow: 'Pop-ups & independent creators',
    shortEyebrow: 'Pop-ups',
    title: 'land fast. land hard.',
    body: 'Turn concept, scarcity, and timing into a launch people understand before the moment passes.',
    image: IMG('1555396273-367ea4eb4db5'),
    capabilities: ['Launch pages', 'Tickets', 'Reach'],
    placement: 'md:col-start-4 md:row-start-2',
    emphasis: 'compact',
  },
]

function AudienceCard({ audience }: { audience: Audience }) {
  const isFeature = audience.emphasis === 'feature'

  return (
    <article
      aria-label={audience.eyebrow}
      className="group relative h-full min-h-[390px] w-full overflow-hidden rounded-[28px] border border-black/[0.06] bg-[#111114] shadow-[var(--elev-2)] motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:ease-out motion-safe:hover:-translate-y-1.5 motion-safe:hover:shadow-[0_24px_58px_rgba(48,22,6,0.2)] md:min-h-0"
    >
      {/* The photograph is atmospheric; the category and value remain real text. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={audience.image}
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute inset-0 h-full w-full select-none object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out-quart motion-safe:group-hover:scale-[1.045]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset ring-warm/0 motion-safe:transition-[box-shadow] motion-safe:duration-300 motion-safe:group-hover:ring-warm/55"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(8,9,12,0.08) 0%, rgba(8,9,12,0.18) 42%, rgba(8,9,12,0.82) 100%)',
        }}
      />

      <span className="absolute left-5 top-5 inline-flex rounded-full bg-warm px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white shadow-sm md:hidden xl:inline-flex">
        {audience.eyebrow}
      </span>
      <span className="absolute left-4 top-4 hidden rounded-full bg-warm px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white shadow-sm md:inline-flex xl:hidden">
        {audience.shortEyebrow}
      </span>

      <div className="absolute inset-x-3 bottom-3 rounded-[22px] border border-white/15 bg-[#0c0e12]/72 p-4 shadow-[0_12px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl motion-safe:transition-[transform,background-color,border-color] motion-safe:duration-300 motion-safe:ease-out motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:border-white/25 motion-safe:group-hover:bg-[#0c0e12]/82 md:inset-x-4 md:bottom-4 md:p-5">
        <h3
          className={
            isFeature
              ? 'max-w-[22ch] font-display text-2xl leading-[1.08] tracking-[-0.01em] text-white md:text-[1.75rem]'
              : 'max-w-[22ch] font-display text-xl leading-[1.08] tracking-[-0.01em] text-white'
          }
        >
          {audience.title}
        </h3>
        <p
          className={`mt-2.5 max-w-[52ch] text-[13px] leading-relaxed text-white/78 md:text-sm ${isFeature ? '' : 'md:hidden xl:block'}`}
        >
          {audience.body}
        </p>
        <div
          className={
            isFeature
              ? 'mt-5 flex flex-wrap gap-2'
              : 'mt-3 flex flex-wrap gap-1.5 md:hidden xl:flex'
          }
          aria-label={`${audience.eyebrow} capabilities`}
        >
          {audience.capabilities.map((capability) => (
            <span
              key={capability}
              className="rounded-full border border-white/12 bg-white/[0.08] px-2.5 py-1 text-[10px] font-semibold text-white/72"
            >
              {capability}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}

export function OrganiserAudiences() {
  return (
    <section className="seam-top relative overflow-hidden px-6 py-24 md:px-10 md:py-32 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]">
      <div className="mx-auto max-w-6xl">
        <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:gap-16">
          <Reveal>
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-warm-ink">
              Built for how you host
            </span>
            <h2 className="mt-4 max-w-3xl font-display text-4xl leading-[1.05] tracking-[-0.02em] text-text-primary md:text-6xl">
              whatever you create,{' '}
              <span className="text-warm-ink">Mingla makes it the plan.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.08}>
            <p className="max-w-xl text-base leading-relaxed text-text-secondary md:text-lg lg:pb-1">
              Six ways to host. One connected system for creating, reaching the right people,
              selling, and growing.
            </p>
          </Reveal>
        </div>

        <div
          className="mt-12 grid gap-5 md:mt-16 md:grid-cols-4 md:grid-rows-[repeat(2,320px)]"
          aria-label="Host types Mingla is built for"
        >
          {AUDIENCES.map((audience, index) => (
            <Reveal
              key={audience.eyebrow}
              delay={Math.min(index * 0.06, 0.3)}
              className={`min-w-0 ${audience.placement}`}
            >
              <AudienceCard audience={audience} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
