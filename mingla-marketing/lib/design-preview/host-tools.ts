// ---------------------------------------------------------------
// #2902 — the Host story, in Seth's words (2026-09-01).
//
//   "For hosts, Mingla gives you all the tools to be a successful host: AI for
//    getting your website ready in a second, host your events, trips,
//    experiences, manage your venue, take orders, reservations and much more,
//    let your community find you, email marketing, sms marketing, paid
//    advertisement, and crm nurturing."
//
// Copy rule for this file: succinct, clear, punchy. A title of two to four
// words, one sentence under it. No paragraphs, no hedging, no explanation of
// the explanation.
//
// `source` is kept for OUR audit trail and is deliberately NOT rendered — the
// evidence paths on the previous pass were review scaffolding and read as
// clutter on a marketing page.
// ---------------------------------------------------------------

export interface HostTool {
  id: string
  /** Subtitle line on the card — which part of the story this tool serves. */
  group: 'Build' | 'Sell' | 'Grow'
  /** Two to four words. The promise, not the feature name. */
  title: string
  /** One sentence. What it does, plainly. */
  body: string
  /** Repo path proving it ships. Audit only — never rendered. */
  source: string
}

/** Build — get a presence and something to sell. */
export const TOOLS_BUILD: readonly HostTool[] = [
  {
    id: 'site',
    group: 'Build',
    title: 'A site in seconds',
    body: 'Describe your business. Ari writes it, designs it and publishes it.',
    source: 'mingla-sites/',
  },
  {
    id: 'host',
    group: 'Build',
    title: 'Host anything',
    body: 'Events, trips, experiences and stays all publish from one place.',
    source: 'mingla-business/src/services/eventOrdersService.ts',
  },
  {
    id: 'venue',
    group: 'Build',
    title: 'Run your venue',
    body: 'Spaces, hours, capacity and staff, managed from your phone.',
    source: 'mingla-business/src/services/reservationMetricsService.ts',
  },
]

/** Sell — turn interest into money. */
export const TOOLS_SELL: readonly HostTool[] = [
  {
    id: 'orders',
    group: 'Sell',
    title: 'Take the money',
    body: 'Tickets, tables, bookings and deposits, at one all-in price.',
    source: 'mingla-business/src/services/eventOrdersService.ts',
  },
  {
    id: 'reservations',
    group: 'Sell',
    title: 'Fill the calendar',
    body: 'Reservations and stays, with the no-shows designed out.',
    source: 'mingla-business/src/services/stayReservationService.ts',
  },
  {
    id: 'discovery',
    group: 'Sell',
    title: 'Get found',
    body: 'Your community finds you by vibe, place and timing — not just by name.',
    source: 'mingla-marketing/components/sections/explorer-home/event-card.tsx',
  },
]

/** Grow — bring them back. */
export const TOOLS_GROW: readonly HostTool[] = [
  {
    id: 'email',
    group: 'Grow',
    title: 'Email marketing',
    body: 'Campaigns to your own list, with tracking and one-tap unsubscribe.',
    source: 'supabase/functions/marketing-send',
  },
  {
    id: 'sms',
    group: 'Grow',
    title: 'SMS marketing',
    body: 'Text the people who actually read their messages.',
    source: 'supabase/functions/send-venue-sms',
  },
  {
    id: 'ads',
    group: 'Grow',
    title: 'Paid ads, no agency',
    body: 'Launch, target and measure paid campaigns from inside Mingla.',
    source: 'supabase/functions/admin-ad-create-campaign',
  },
  {
    id: 'crm',
    group: 'Grow',
    title: 'CRM that nurtures',
    body: 'Every guest becomes a contact you own, and a reason to return.',
    source: 'mingla-business/src/features/people',
  },
]

export const ALL_TOOLS: readonly HostTool[] = [
  ...TOOLS_BUILD,
  ...TOOLS_SELL,
  ...TOOLS_GROW,
]

/** The three-step story. Verb, one line. */
export const HOST_STEPS = [
  {
    id: 'build',
    label: 'Build it',
    caption: 'A site and a listing, live in minutes.',
    tools: TOOLS_BUILD,
  },
  {
    id: 'sell',
    label: 'Sell it',
    caption: 'Tickets, tables and bookings at one honest price.',
    tools: TOOLS_SELL,
  },
  {
    id: 'grow',
    label: 'Grow it',
    caption: 'Email, SMS, ads and a guest list that compounds.',
    tools: TOOLS_GROW,
  },
] as const

/** Before / after. Six words a side, not six lines. */
export const HOST_SWAP = [
  { job: 'Your website', before: 'A link in bio', after: 'A real site, built by Ari' },
  { job: 'Selling', before: 'Three checkout tools', after: 'One all-in price' },
  { job: 'Getting found', before: 'Fighting the algorithm', after: 'Matched to people already looking' },
  { job: 'Marketing', before: 'Post and hope', after: 'Email, SMS and paid ads in one place' },
  { job: 'Your guests', before: 'Followers you rent', after: 'A contact list you own' },
] as const

/** Straight answers. Two lines each. */
export const HOST_LIMITS = [
  {
    title: 'SMS is US and UK only',
    body: 'Nigerian hosts use email and the in-app guest list until the local route opens.',
  },
  {
    title: 'Discovery is not placement',
    body: 'Publishing makes you eligible to be matched. It does not buy you a position.',
  },
  {
    title: 'Your site lives on Mingla',
    body: 'You get a real site fast. You do not get your own hosted domain.',
  },
] as const
