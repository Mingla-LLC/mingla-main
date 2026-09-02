export const PAGE_SYSTEM_PATHS = [
  '/internal/page-system/city-lagos',
  '/internal/page-system/explorer-event-guide',
  '/internal/page-system/host-event-promoter-guide',
] as const

export type PageSystemPath = (typeof PAGE_SYSTEM_PATHS)[number]

export const EXPLORER_CATEGORIES = [
  { slug: 'nature', label: 'Nature & Views' },
  { slug: 'icebreakers', label: 'Icebreakers' },
  { slug: 'drinks', label: 'Drinks & Music' },
  { slug: 'brunch', label: 'Brunch' },
  { slug: 'casual_food', label: 'Casual' },
  { slug: 'fine_dining', label: 'Fine Dining' },
  { slug: 'movies', label: 'Movies' },
  { slug: 'theatre', label: 'Theatre' },
  { slug: 'creative_arts', label: 'Creative & Arts' },
  { slug: 'play', label: 'Play' },
] as const

export type ExplorerCategorySlug = (typeof EXPLORER_CATEGORIES)[number]['slug']

export interface CataloguePlace {
  readonly kind: 'place'
  readonly placePoolId: string
  readonly name: string
  readonly categorySlug: ExplorerCategorySlug
  readonly categoryLabel: string
  readonly signalScore: number
  readonly aiBlended: boolean
  readonly photoUrls: readonly string[]
  readonly rating: number | null
  readonly reviewCount: number | null
  readonly oneLiner: string | null
  readonly address: string | null
  readonly scoredAt: string
  readonly sourceUpdatedAt: string
  readonly detailHref: string
}

export interface CataloguePlanStop {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly photoUrl: string
  readonly address: string | null
}

export interface CataloguePlan {
  readonly kind: 'plan'
  readonly generatedCardId: string
  readonly title: string
  readonly intentLabel: string
  readonly sellLine: string
  readonly itineraryLabel: string
  readonly photoUrls: readonly string[]
  readonly stops: readonly CataloguePlanStop[]
  readonly duration: string | null
  readonly price: string | null
  readonly generatedAt: string
  readonly detailHref: string
}

export type HostGuideKind = 'event' | 'trip' | 'venue' | 'experience'

export interface HostGuideRecord {
  readonly kind: HostGuideKind
  readonly eyebrow: string
  readonly title: string
  readonly subhead: string
  readonly tips: readonly [
    { readonly title: string; readonly detail: string },
    { readonly title: string; readonly detail: string },
    { readonly title: string; readonly detail: string },
  ]
  readonly toolKey: HostGuideKind
  readonly toolLabel: string
  readonly heroMedia: {
    readonly src: string
    readonly alt: string
    readonly caption: string
  }
  readonly creationNoun: string
  readonly hostUrl: string
  readonly hostAction: string
  readonly limitation: string
}

export interface FaqEntry {
  readonly question: string
  readonly answer: string
}

export interface SourceEntry {
  readonly label: string
  readonly publisher: string
  readonly href: string
}

export const LAUNCH_CITIES = [
  'Lagos',
  'Durham',
  'Cary',
  'Raleigh',
  'New York City',
  'Brussels',
  'Paris',
  'London',
  'Fort Lauderdale',
  'Washington DC',
] as const

export const REVIEW_STATUS = {
  label: 'Evidence review pending',
  detail:
    'This private fixture is a content and interaction review. Publication evidence, current product captures and media rights remain gated.',
} as const
