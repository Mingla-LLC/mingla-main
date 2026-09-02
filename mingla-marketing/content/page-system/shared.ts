export const PAGE_SYSTEM_PATHS = [
  '/internal/page-system/city-lagos',
  '/internal/page-system/explorer-event-guide',
  '/internal/page-system/host-event-promoter-guide',
] as const

export type PageSystemPath = (typeof PAGE_SYSTEM_PATHS)[number]

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
