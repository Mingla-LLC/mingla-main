'use client'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Reveal } from '@/components/ui/reveal'
import { SpotlightBand } from '@/components/ui/spotlight-band'
import { EarningsCard } from '@/components/sections/organiser-home/earnings-card'
import { VenueActivityFeed } from '@/components/sections/organiser-home/venue-activity-feed'
import { EventAttendeesCard } from '@/components/sections/organiser-home/event-attendees-card'
import { DiningDashboardCard } from '@/components/sections/organiser-home/dining-dashboard-card'
import { cn } from '@/lib/cn'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'

// ORCH-1010 — tabbed, audience-filterable section. Pick your world; the block
// re-skins to that audience: heading + intro + 3-step how-it-works + tailored
// feature cards. Copy from COPY_ORCH-1010_TABBED_AUDIENCES.md (mingla-product).
// On the dark SpotlightBand, accent reverts to text-warm.

const EASE = [0.16, 1, 0.3, 1] as const

interface Step {
  title: string
  body: string
}
interface Tab {
  id: string
  label: string
  heading: string
  intro: string
  steps: Step[]
  features: Step[]
}

const TABS: Tab[] = [
  {
    id: 'venues',
    label: 'Venues',
    heading: 'turn your room into the plan.',
    intro:
      "The room that feels perfect on a Friday night shouldn't be the city's best-kept secret. Mingla turns your space, your nights, and your energy into a plan people actively choose — and fills the room with the crowd that fits it.",
    steps: [
      { title: 'name your vibe', body: 'Tell Mingla the energy of your place in plain words — cozy, lively, late-night, high-energy — and Ari builds you a page that looks and feels like the room.' },
      { title: 'get matched', body: "Your place reaches people by vibe, taste, location, and timing — not just who's nearby, but who's looking for exactly this tonight." },
      { title: 'fill the room', body: 'They book a table, a spot, or a night right inside Mingla — and you watch the right crowd walk through the door.' },
    ],
    features: [
      { title: 'a page that feels like the room', body: 'Your colors, your photos and video, your story — the page people actually want to send to the group chat, not just another listing.' },
      { title: 'matched to the right crowd', body: "Reach the people already looking for a place like yours tonight, instead of paying to chase strangers who'll never come back." },
      { title: 'know which nights work', body: 'Your dashboard shows the guest list, check-ins, and what sold — so you finally know which nights, offers, and crowds are working.' },
      { title: 'bring them back', body: "Email the people who actually showed up — no list to build, no extra tool to learn. They're already there, and the slow nights are next." },
    ],
  },
  {
    id: 'dining',
    label: 'Dining',
    heading: 'make your menu the reason.',
    intro:
      'The handmade pasta. The patio at golden hour. The cocktail only your bartender can make. Mingla turns your menu, your room, and your best nights into something people book a table for — and matches you to the people already hungry for exactly this.',
    steps: [
      { title: 'show the dish', body: 'Put your menu, your room, and your golden-hour patio on a page that makes people taste it before they arrive — Ari helps you build it in minutes.' },
      { title: 'reach the hungry', body: 'Mingla matches your place to people planning a dinner, a date, or a long lunch nearby — by taste and timing, not just distance.' },
      { title: 'book the table', body: 'They reserve and pay one all-in price up front, right inside Mingla — no address typing, no checkout surprise, no third-party app skimming the night.' },
    ],
    features: [
      { title: 'a menu worth sharing', body: 'Your dishes, your photos, your story on a page built to be sent to the group chat — the reason someone picks you over the place next door.' },
      { title: 'matched by taste', body: "Reach diners by what they're actually craving and planning — the people looking for your kind of night, not a generic “restaurants near me” list." },
      { title: 'all-in checkout, built in', body: 'Sell tables, tasting menus, and prepaid experiences inside Mingla. Buyers see the full price before they pay — no surprises, fewer no-shows.' },
      { title: 'regulars, not one-timers', body: 'Email the diners who already booked with you and keep your slow nights full — your customer list, owned by you, ready to use.' },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    heading: 'sell the night, not just the ticket.',
    intro:
      "A flyer says what's happening. Mingla says why it matters — the lineup, the crowd, the culture, the timing — and lets the right people buy in seconds, before the plan dies in the group chat.",
    steps: [
      { title: 'build the night', body: 'Ari turns your event into a page that sells the experience — the lineup, the energy, the reason to be there — not just a date and a price.' },
      { title: 'find your crowd', body: "Mingla puts your night in front of the people already looking for exactly this — by vibe, scene, and timing — so you're not paying to chase strangers." },
      { title: 'sell in seconds', body: 'They buy their spot inside Mingla — one all-in price up front, no address typing, no abandoned cart, no checkout surprise.' },
    ],
    features: [
      { title: 'a page that sells the night', body: 'The lineup, the crowd, the culture, the timing — Mingla tells people why it matters, so the flyer becomes a reason to show up.' },
      { title: 'in front of the right people', body: 'Reach the scene already looking for a night like yours, instead of buying ads that chase the same paid strangers over and over.' },
      { title: 'all-in checkout, built in', body: 'Sell tickets and tables right inside Mingla, all-in price up front. Buyers see the full cost before they pay — fewer drop-offs, faster sell-through.' },
      { title: 'know who showed up', body: 'Guest list, check-ins, and what sold — all in your dashboard — so you know which nights, lineups, and crowds to run back.' },
    ],
  },
  {
    id: 'experiences',
    label: 'Experiences',
    heading: 'turn a thing-to-do into a must-do.',
    intro:
      'Cooking classes, horseback rides, tours, day trips, tastings, outdoor adventures. Mingla helps experience and trip organizers turn “that sounds fun” into a booking — matched to the people already looking for exactly this.',
    steps: [
      { title: 'tell the story', body: 'Ari helps you turn your experience, trip, or adventure into a page that makes people feel the day before they book it — no full-time marketer required.' },
      { title: 'match the planner', body: 'Mingla connects your experience to people planning a weekend, a date, or a day out nearby — matched by vibe, budget, and what they’re already after.' },
      { title: 'book it out', body: 'They reserve their spot inside Mingla, one all-in price up front — no address typing, no checkout surprise — so “I’ll think about it” becomes a confirmed seat.' },
    ],
    features: [
      { title: 'a page that sells the day', body: 'Your experience, your photos and video, your story — a page that turns “that sounds fun” into “we’re booking it,” built for the group chat.' },
      { title: 'matched to real intent', body: 'Reach the people already planning the kind of day you offer — by vibe, location, timing, and budget — not random clicks you pay for twice.' },
      { title: 'bookings, built in', body: 'Take prepaid bookings for classes, tours, and trips right inside Mingla. One all-in price up front means fewer no-shows and no checkout drop-off.' },
      { title: 'no marketing degree needed', body: "You shouldn't need to become a full-time marketer to be found. Ari names your vibe, builds your page, and helps you reach the right people from inside the app." },
    ],
  },
  {
    id: 'popups',
    label: 'Pop-ups',
    heading: 'land fast. land hard.',
    intro:
      "A pop-up has one shot. Mingla helps chefs, artists, makers, and curators turn concept, scarcity, and timing into something people feel they can't miss — and reach them before the window closes.",
    steps: [
      { title: 'spin it up', body: 'Ari builds your page in minutes — concept, drop, and timing — so you can go from idea to live before the moment passes.' },
      { title: 'reach fast', body: 'Mingla puts your pop-up in front of the people already hunting for something new nearby, matched by taste and timing, the moment you go live.' },
      { title: 'sell the drop', body: "They claim their spot inside Mingla, all-in price up front — scarcity does the rest, and you sell out the window you've got." },
    ],
    features: [
      { title: 'live in minutes', body: 'No website to build, no marketer to hire — Ari turns your concept into a page worth sharing before the moment passes.' },
      { title: 'found by the curious', body: 'Reach the people already looking for something new and worth talking about — matched by vibe and timing, not paid impressions.' },
      { title: 'scarcity that sells', body: 'All-in checkout built in, so a limited drop becomes a fast sell-out — one price up front, no friction between “I want in” and “I’m in.”' },
    ],
  },
]

export function OrganiserAudienceTabs() {
  const reduced = useMinglaReducedMotion()
  const [active, setActive] = useState(0)
  const tab = TABS[active]

  return (
    <SpotlightBand aria-label="How Mingla works for your kind of business" className="md:py-32">
      <div className="mx-auto max-w-6xl">
        {/* Header — desktop: title + tabs (left) beside the Earnings chart (right).
            Mobile order: title → chart → tabs, so the chart sits between the title
            and the tab picker and the tabs lead straight into the content. */}
        <div className="grid gap-x-16 gap-y-9 lg:grid-cols-[1fr_0.82fr]">
          {/* Title */}
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <Reveal as="span" className="block text-xs font-semibold uppercase tracking-[0.2em] text-warm">
              Built for your kind of place
            </Reveal>
            <Reveal>
              <h2 className="mt-4 max-w-xl font-display text-3xl leading-[1.05] tracking-[-0.02em] text-white md:text-5xl">
                pick your world. <span className="text-warm">see your Mingla.</span>
              </h2>
            </Reveal>
          </div>

          {/* Earnings chart (after the title on mobile; right column on desktop) */}
          <Reveal
            delay={0.1}
            className="flex justify-center lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:items-center lg:justify-end"
          >
            <div data-theme="light" className="w-full max-w-md">
              <EarningsCard />
            </div>
          </Reveal>

          {/* Tabs */}
          <div
            role="tablist"
            aria-label="Audience"
            className="flex flex-wrap gap-2.5 lg:col-start-1 lg:row-start-2 lg:self-start"
          >
            {TABS.map((t, i) => {
              const isActive = i === active
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActive(i)}
                  className={cn(
                    'rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ease-out-quart focus-ring',
                    isActive
                      ? 'bg-warm text-ink'
                      : 'bg-white/[0.07] text-white/75 ring-1 ring-white/10 hover:bg-white/[0.12] hover:text-white',
                  )}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content — per-tab heading + intro, then steps (left) + feature cards (right). */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab.id}
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.34, ease: EASE }}
            className="mt-16 grid gap-12 lg:grid-cols-2 lg:items-stretch lg:gap-16"
          >
            {/* LEFT — heading + intro + steps, distributed to fit the chart's height. */}
            <div className="flex flex-col lg:h-full">
              <h3 className="font-display text-3xl leading-tight tracking-[-0.01em] text-white md:text-4xl">
                {tab.heading}
              </h3>
              <p className="mt-4 text-base leading-relaxed text-white/70 md:text-lg">{tab.intro}</p>
              <ol className="mt-8 flex flex-1 flex-col justify-between gap-6">
                {tab.steps.map((s, i) => (
                  <li key={s.title} className="flex gap-5">
                    <span className="font-display text-2xl leading-none tabular-nums text-warm/45">
                      {i + 1}
                    </span>
                    <div>
                      <h4 className="font-display text-lg leading-tight text-white">{s.title}</h4>
                      <p className="mt-1.5 text-sm leading-relaxed text-white/60">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* RIGHT — per-tab chart (Venues = live feed; others coming) */}
            <div className="flex justify-center lg:justify-end">
              {tab.id === 'venues' ? (
                <VenueActivityFeed />
              ) : tab.id === 'events' ? (
                <EventAttendeesCard />
              ) : tab.id === 'dining' ? (
                <DiningDashboardCard />
              ) : null}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </SpotlightBand>
  )
}
