import { canonicalMarketingUrl } from '../site'

export const ROUTE_LIFECYCLE_STATES = [
  'draft',
  'public_noindex',
  'search_ready',
  'stale',
  'expired_archived',
  'redirected',
  'gone',
] as const

export type RouteLifecycle = (typeof ROUTE_LIFECYCLE_STATES)[number]
export type RouteMatch =
  | Readonly<{ type: 'exact'; pathname: string }>
  | Readonly<{ type: 'prefix'; pathname: string }>

interface RouteContractBase {
  readonly id: string
  readonly match: RouteMatch
  readonly lifecycle: RouteLifecycle
}

export interface SearchReadyRouteContract extends RouteContractBase {
  readonly lifecycle: 'search_ready'
  readonly match: Readonly<{ type: 'exact'; pathname: string }>
  readonly title: string
  readonly description: string
  readonly lastModified: `${number}-${number}-${number}`
}

export interface RedirectedRouteContract extends RouteContractBase {
  readonly lifecycle: 'redirected'
  readonly source: string
  readonly destination: string
}

export type RouteContract =
  | SearchReadyRouteContract
  | RedirectedRouteContract
  | (RouteContractBase & {
      readonly lifecycle:
        | 'draft'
        | 'public_noindex'
        | 'stale'
        | 'expired_archived'
        | 'gone'
    })

const SEARCH_READY_ROUTES = [
  {
    id: 'explorer-home',
    match: { type: 'exact', pathname: '/' },
    lifecycle: 'search_ready',
    title: 'Mingla — Find a vibe, not a venue.',
    description:
      'Mingla helps you find date plans, city gems, events, and experiences that fit the vibe — then turn them into plans with your people.',
    lastModified: '2026-09-01',
  },
  {
    id: 'host-home',
    match: { type: 'exact', pathname: '/host' },
    lifecycle: 'search_ready',
    title: 'Mingla Host — help the right people discover and book you',
    description:
      'Mingla Host helps restaurants, venues, promoters, and experience brands turn what makes them special into pages, offers, discovery, bookings, and guest relationships.',
    lastModified: '2026-09-01',
  },
  {
    id: 'tools-home',
    match: { type: 'exact', pathname: '/tools' },
    lifecycle: 'search_ready',
    title: 'Free AI tools for venues, events & experiences',
    description:
      'Free AI tools for people who run real places — grade your website, predict event turnout, quote a trip, and audit experience pricing. Built by Mingla.',
    lastModified: '2026-09-01',
  },
  {
    id: 'event-turnout-tool',
    match: { type: 'exact', pathname: '/tools/events' },
    lifecycle: 'search_ready',
    title: 'Event Turnout Predictor — free AI turnout & ad-spend forecast',
    description:
      'Get a free event-turnout forecast grounded in current research on your date, city, and competition, plus a practical view of what your promotion budget can buy.',
    lastModified: '2026-09-01',
  },
  {
    id: 'venue-grader-tool',
    match: { type: 'exact', pathname: '/tools/venues' },
    lifecycle: 'search_ready',
    title: 'Venue Website Grader — free AI website report',
    description:
      'See what your venue website communicates to a first-time visitor and get a practical improvement report for your restaurant, bar, café, club, or activity space.',
    lastModified: '2026-09-01',
  },
  {
    id: 'trip-quote-tool',
    match: { type: 'exact', pathname: '/tools/trips' },
    lifecycle: 'search_ready',
    title: 'Quote Any Trip — free costed itinerary for travel organisers',
    description:
      'Build a costed group-trip quote with named hotels and activities, a line-item cost sheet, and a per-person price for your target margin.',
    lastModified: '2026-09-01',
  },
  {
    id: 'pricing-audit-tool',
    match: { type: 'exact', pathname: '/tools/pricing' },
    lifecycle: 'search_ready',
    title: 'The Undercharging Audit — free pricing report for experience hosts',
    description:
      'Calculate your true cost per guest, including your time, compare the market, and see a practical price range for your workshop, class, club, or hosted experience.',
    lastModified: '2026-09-01',
  },
  {
    id: 'support',
    match: { type: 'exact', pathname: '/support' },
    lifecycle: 'search_ready',
    title: 'Mingla Support',
    description:
      'Get help with Mingla, report a problem, manage your account, or contact the support team.',
    lastModified: '2026-09-01',
  },
  {
    id: 'privacy-policy',
    match: { type: 'exact', pathname: '/privacy-policy' },
    lifecycle: 'search_ready',
    title: 'Mingla Privacy Policy',
    description:
      'Read how Mingla collects, uses, discloses, and safeguards information across its apps, website, and related services.',
    lastModified: '2026-09-01',
  },
  {
    id: 'terms-of-service',
    match: { type: 'exact', pathname: '/terms-of-service' },
    lifecycle: 'search_ready',
    title: 'Mingla Terms of Service',
    description:
      'Read the terms governing access to and use of Mingla, including acceptable use, liability limits, and dispute terms.',
    lastModified: '2026-09-01',
  },
] as const satisfies readonly SearchReadyRouteContract[]

const PUBLIC_NOINDEX_ROUTES = [
  ['/links', 'links'],
  ['/download', 'explorer-download'],
  ['/host/download', 'host-download'],
  ['/unsubscribe', 'unsubscribe'],
  ['/schedule', 'schedule'],
  ['/sms-terms', 'sms-terms'],
  ['/delete-account', 'delete-account'],
  ['/event-preview', 'event-preview'],
  ['/trip-preview', 'trip-preview'],
  ['/venue-preview', 'venue-preview'],
  ['/venue-preview/lookbook', 'venue-preview-lookbook'],
  ['/intent-preview', 'intent-preview'],
  ['/tools/events/report', 'event-report'],
  ['/tools/venues/report', 'venue-report'],
  ['/tools/trips/report', 'trip-report'],
  ['/tools/pricing/report', 'pricing-report'],
] as const

const PUBLIC_NOINDEX_FAMILIES = [
  ['/orders', 'orders-family'],
  ['/chat', 'chat-family'],
  ['/board', 'board-family'],
  ['/invite', 'invite-family'],
] as const

const REDIRECTED_ROUTES = [
  {
    id: 'organisers-redirect',
    match: { type: 'exact', pathname: '/organisers' },
    lifecycle: 'redirected',
    source: '/organisers',
    destination: '/host',
  },
  {
    id: 'organisers-family-redirect',
    match: { type: 'prefix', pathname: '/organisers' },
    lifecycle: 'redirected',
    source: '/organisers/:path*',
    destination: '/host/:path*',
  },
  {
    id: 'business-redirect',
    match: { type: 'exact', pathname: '/business' },
    lifecycle: 'redirected',
    source: '/business',
    destination: '/host',
  },
  {
    id: 'business-family-redirect',
    match: { type: 'prefix', pathname: '/business' },
    lifecycle: 'redirected',
    source: '/business/:path*',
    destination: '/host/:path*',
  },
  {
    id: 'tools-book-redirect',
    match: { type: 'exact', pathname: '/tools/book' },
    lifecycle: 'redirected',
    source: '/tools/book',
    destination: '/schedule',
  },
] as const satisfies readonly RedirectedRouteContract[]

export const ROUTE_REGISTRY: readonly RouteContract[] = [
  ...SEARCH_READY_ROUTES,
  ...PUBLIC_NOINDEX_ROUTES.map(([pathname, id]) => ({
    id,
    match: { type: 'exact' as const, pathname },
    lifecycle: 'public_noindex' as const,
  })),
  ...PUBLIC_NOINDEX_FAMILIES.map(([pathname, id]) => ({
    id,
    match: { type: 'prefix' as const, pathname },
    lifecycle: 'public_noindex' as const,
  })),
  ...REDIRECTED_ROUTES,
]

export const ROUTE_OWNER_EXCLUSIONS = [
  { id: 'careers-host', owner: 'career.usemingla.com', match: 'host' },
  { id: 'well-known', owner: 'static association files', match: '/.well-known/**' },
  { id: 'public-share-pages', owner: 'share proxy', match: '/p/** and /s/**' },
  { id: 'public-share-assets', owner: 'share proxy', match: '/share/** and /og/**' },
  { id: 'public-share-apis', owner: 'share proxy', match: '/api/content-share/** and /api/shared-card/**' },
  { id: 'public-share-analytics', owner: 'share analytics API', match: '/api/content-share-analytics' },
  { id: 'internal-share-apis', owner: 'server-only share proxy', match: '/api/internal-share-proxy/**' },
] as const

export const NOINDEX_LIFECYCLES: ReadonlySet<RouteLifecycle> = new Set([
  'draft',
  'public_noindex',
  'stale',
  'expired_archived',
])

function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || '/'
  if (pathOnly === '/') return '/'
  const withLeadingSlash = pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`
  return withLeadingSlash.replace(/\/+$/, '')
}

function matches(contract: RouteContract, pathname: string): boolean {
  const candidate = normalizePathname(pathname)
  const registered = normalizePathname(contract.match.pathname)
  return contract.match.type === 'exact'
    ? candidate === registered
    : candidate === registered || candidate.startsWith(`${registered}/`)
}

export function routeContractForPath(pathname: string): RouteContract | null {
  const exact = ROUTE_REGISTRY.find(
    (contract) => contract.match.type === 'exact' && matches(contract, pathname),
  )
  return exact ?? ROUTE_REGISTRY.find((contract) => matches(contract, pathname)) ?? null
}

export function requireRouteContract(
  pathname: string,
  expectedLifecycle?: RouteLifecycle,
): RouteContract {
  const contract = routeContractForPath(pathname)
  if (!contract) throw new Error(`No search lifecycle owner is registered for ${pathname}`)
  if (expectedLifecycle && contract.lifecycle !== expectedLifecycle) {
    throw new Error(
      `${pathname} is ${contract.lifecycle}; expected ${expectedLifecycle}`,
    )
  }
  return contract
}

export function searchReadyRoutes(): readonly SearchReadyRouteContract[] {
  return ROUTE_REGISTRY.filter(
    (contract): contract is SearchReadyRouteContract => contract.lifecycle === 'search_ready',
  )
}

export function canonicalUrlForSearchRoute(pathname: string): string {
  requireRouteContract(pathname, 'search_ready')
  return canonicalMarketingUrl(pathname)
}

export function nextRedirectsFromRegistry(): ReadonlyArray<{
  source: string
  destination: string
  permanent: true
}> {
  return ROUTE_REGISTRY.filter(
    (contract): contract is RedirectedRouteContract => contract.lifecycle === 'redirected',
  ).map(({ source, destination }) => ({ source, destination, permanent: true as const }))
}
