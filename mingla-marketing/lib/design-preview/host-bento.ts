// ---------------------------------------------------------------
// #2902 — the six Host capability cards, as a bento grid.
//
// Seth's six, in his order and his emphasis. Copy stays succinct and punchy:
// a short title, one sentence, and the specifics as chips rather than prose —
// so a scanner gets the shape and a reader gets the detail.
//
// Every capability named here exists in shipped source. `source` is kept for
// our own audit and is never rendered.
// ---------------------------------------------------------------

export interface BentoCard {
  id: string
  title: string
  body: string
  /** The specifics, as short chips. */
  points: readonly string[]
  /** Bento placement. */
  span: string
  tone: 'ink' | 'brand' | 'raised'
  /** Which figure from tool-visuals to render. */
  visual: string
  /**
   * Whether this card renders a HostFigure. It lives here, in a server-safe
   * module, because the page is a Server Component and cannot call into the
   * 'use client' figure registry to ask.
   */
  figure?: boolean
  source: string
}

export const HOST_BENTO: readonly BentoCard[] = [
  {
    id: 'website',
    title: 'Prompt your website into existence',
    body: 'Describe your business. Get a state-of-the-art site, free, in seconds.',
    points: ['Written by Ari', 'Menu & ordering', 'Live site'],
    span: 'lg:col-span-4 lg:row-span-2',
    tone: 'brand',
    visual: 'site',
    source: 'mingla-sites/',
  },
  {
    id: 'events',
    title: 'Events',
    body: 'Create events with AI reading the demand before you price them.',
    points: ['Demand forecast', 'Weather', 'Ticket scanning', 'Guest lists'],
    span: 'lg:col-span-2 lg:row-span-2',
    figure: true,
    tone: 'ink',
    visual: 'orders',
    source: 'mingla-business/src/services/eventOrdersService.ts',
  },
  {
    id: 'trips',
    title: 'Trips',
    body: 'Host trips and let the group plan them together.',
    points: ['Group chat', 'Instalments', 'Itineraries'],
    span: 'lg:col-span-2 lg:row-span-2',
    figure: true,
    tone: 'ink',
    visual: 'host',
    source: 'mingla-business/src/utils/tripToLiveEvent.ts',
  },
  {
    id: 'venue',
    title: 'Venue management',
    body: 'Run a restaurant or a club from one place.',
    points: ['Reservations', 'Table ordering', 'Menu intelligence', 'Demand forecast'],
    span: 'lg:col-span-2 lg:row-span-2',
    figure: true,
    tone: 'raised',
    visual: 'venue',
    source: 'mingla-business/src/services/reservationMetricsService.ts',
  },
  {
    id: 'marketing',
    title: 'Marketing',
    body: 'Reach the people who already came, and the ones who should.',
    points: ['Email', 'SMS', 'CRM nurturing'],
    span: 'lg:col-span-2 lg:row-span-2',
    figure: true,
    tone: 'raised',
    visual: 'email',
    source: 'supabase/functions/marketing-send',
  },
  {
    id: 'brain',
    title: "Mingla's AI brain",
    body: 'Ari drives people to your door — performance advertising, local targeting, and most of the work you were going to do yourself.',
    points: ['Performance ads', 'Local targeting', 'Ask Ari anything'],
    span: 'lg:col-span-6',
    tone: 'ink',
    visual: 'discovery',
    source: 'supabase/functions/admin-ad-create-campaign',
  },
]
