// ---------------------------------------------------------------
// #2902 — the CHART BANK.
//
// Every figure Mingla has, catalogued in one place so a page can pull the
// right one instead of a new one being drawn each time. Two origins:
//
//   'live'   — already shipped on usemingla.com/host and the design previews.
//              These are PRODUCTION components pinned by tests
//              (organiser-redesign.test.ts, issue-2083-*.test.ts and the copy
//              fidelity suite). The bank REFERENCES them; it does not move,
//              rename or re-style them. Adapting one means adapting it where
//              it lives, with those tests as the gate.
//
//   'cutout' — built during this pass for the bento cards.
//
// `tone` matters: the live cards are drawn for the parchment background and
// the cutout figures for dark tiles. Rendering either on the wrong ground is
// the fastest way to make a good figure look broken.
//
// This module is server-safe on purpose -- it is only data, so a Server
// Component page can read it without pulling every chart into its bundle.
// The components themselves live in components/ui/chart-bank.tsx.
// ---------------------------------------------------------------

export type ChartOrigin = 'live' | 'cutout'
export type ChartTone = 'light' | 'dark'

export interface BankedChart {
  id: string
  title: string
  /** One line: what a reader learns from it. */
  shows: string
  origin: ChartOrigin
  tone: ChartTone
  /** Where the component actually lives. */
  source: string
  /** Surfaces it suits, for picking one per page. */
  surfaces: readonly string[]
  /**
   * Whether the figure carries real data or is an illustration. Everything
   * here is illustrative today; the field exists so that stays a deliberate
   * choice rather than an assumption.
   */
  data: 'illustrative'
  /** Set where the numbers or copy are market-dependent. */
  marketAware?: boolean
  /**
   * Why this one cannot be dropped onto a new page as-is. A bank exists to be
   * copied from, so anything a figure asserts that is not true gets copied
   * with it. #2902 forbids invented social proof and performance claims;
   * several shipped figures carry both, and that is recorded here rather than
   * discovered again later.
   */
  caution?: string
}

export const CHART_BANK: readonly BankedChart[] = [
  // — from this pass ————————————————————————————————
  {
    id: 'event-demand',
    title: 'Event demand curve',
    shows: 'Demand across the hours of a night, the weather it reacts to, and the door price it lands on.',
    origin: 'cutout', tone: 'dark', data: 'illustrative', marketAware: true,
    source: 'components/ui/event-demand-card.tsx',
    surfaces: ['host', 'events', 'clubs'],
  },
  {
    id: 'trip-plan',
    title: 'Trip plan card',
    shows: 'A hosted trip: route, dates, group size and the instalments it is paid in.',
    origin: 'cutout', tone: 'dark', data: 'illustrative', marketAware: true,
    source: 'components/ui/trip-plan-card.tsx',
    surfaces: ['host', 'trips'],
  },
  {
    id: 'venue-floor',
    title: 'Venue floor',
    shows: "Tonight's tables, booked against open, as a room rather than a number.",
    origin: 'cutout', tone: 'dark', data: 'illustrative',
    source: 'components/ui/host-figures.tsx',
    surfaces: ['host', 'restaurants', 'venues'],
  },
  {
    id: 'audience-split',
    title: 'Audience split',
    shows: 'Who one send reaches, as proportions. Carries no counts or rates on purpose.',
    origin: 'cutout', tone: 'dark', data: 'illustrative',
    source: 'components/ui/host-figures.tsx',
    surfaces: ['host', 'marketing'],
  },
  {
    id: 'reach-mix',
    title: 'Reach mix, with and without',
    shows: 'Paid, earned, shared and owned stacked over a year, against a flat baseline.',
    origin: 'cutout', tone: 'dark', data: 'illustrative',
    source: 'components/ui/reach-mix-card.tsx',
    surfaces: ['host', 'marketing', 'about'],
  },
  {
    id: 'ari-site',
    title: 'Ari builds a site',
    shows: 'A brief typed to Ari, drafted, and the finished site scrolling in the same box.',
    origin: 'cutout', tone: 'dark', data: 'illustrative',
    source: 'components/ui/ari-creative-card.tsx',
    surfaces: ['host', 'restaurants'],
  },

  // — already shipped ————————————————————————————————
  {
    id: 'sell-through',
    title: 'Ticket sell-through',
    shows: 'Tiers selling down over time, one selected at a time.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/design-preview/host/host-sellthrough-chart.tsx',
    surfaces: ['host', 'events'],
  },
  {
    id: 'lagos-venues',
    title: 'Lagos venue comparison',
    shows: 'Real Lagos venues compared on reviews and other modes.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/design-preview/explorer/lagos-venue-chart.tsx',
    surfaces: ['explorer'],
  },
  {
    id: 'earnings',
    title: 'Earnings card',
    shows: 'What a host takes, over time.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/sections/organiser-home/earnings-card.tsx',
    surfaces: ['host'],
  },
  {
    id: 'trip-planner',
    title: 'Trip planner card',
    shows: 'A trip being planned by the group.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/sections/organiser-home/trip-planner-card.tsx',
    surfaces: ['host', 'trips'],
  },
  {
    id: 'dining-dashboard',
    title: 'Dining dashboard',
    shows: 'Covers and service for a restaurant.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/sections/organiser-home/dining-dashboard-card.tsx',
    surfaces: ['host', 'restaurants'],
  },
  {
    id: 'growth-os',
    title: 'Growth OS dashboard',
    shows: 'The growth surface, tab by tab.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/sections/organiser-home/growth-os-dashboard.tsx',
    surfaces: ['host', 'marketing'],
    caution:
      'Carries campaign metrics ("3,200 reached · 31% opened") that no one measured.',
  },
  {
    id: 'venue-activity',
    title: 'Venue activity feed',
    shows: 'Orders and arrivals scrolling as they land.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/sections/organiser-home/venue-activity-feed.tsx',
    surfaces: ['host', 'venues'],
    caution:
      'Hard-coded USD amounts (+$45, +$240). Not market aware, so it shows dollars in Lagos and London.',
  },
  {
    id: 'event-attendees',
    title: 'Event attendees',
    shows: 'Buyers arriving on a ticketed night.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/sections/organiser-home/event-attendees-card.tsx',
    surfaces: ['host', 'events'],
    caution:
      'Invented named buyers (Maya R., Deji O., Sara K., Noah W.) — the same list as the pop-up card.',
  },
  {
    id: 'popup-claims',
    title: 'Pop-up claims',
    shows: 'Spots being claimed on a drop.',
    origin: 'live', tone: 'light', data: 'illustrative',
    source: 'components/sections/organiser-home/popup-card.tsx',
    surfaces: ['host', 'popups'],
    caution:
      'Invented named people ("Sara K. grabbed one of the last 4"). Reads as live social proof on a marketing page.',
  },
]

export function chartsForSurface(surface: string): readonly BankedChart[] {
  return CHART_BANK.filter((c) => c.surfaces.includes(surface))
}

export function chartById(id: string): BankedChart | undefined {
  return CHART_BANK.find((c) => c.id === id)
}
