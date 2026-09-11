import type { RouteLifecycle } from '@/lib/search/route-registry'

export type CorePageSlug = 'about' | 'explorer' | 'cities' | 'editorial-standards'

export interface CorePageRecord {
  readonly slug: CorePageSlug
  readonly pathname: `/${CorePageSlug}`
  readonly lifecycle: Extract<RouteLifecycle, 'public_noindex' | 'search_ready'>
  readonly title: string
  readonly description: string
  readonly eyebrow: string
  readonly h1: string
  readonly directQuestion: string
  readonly directAnswer: string
  readonly reviewedAt: `${number}-${number}-${number}`
}

// These four records are the only owner of core-page metadata and lifecycle.
// Publication is deliberately fail-closed until the release evidence named on
// #3176 exists; deploy time must never impersonate an editorial review date.
export const CORE_PAGES: Readonly<Record<CorePageSlug, CorePageRecord>> = {
  about: {
    slug: 'about', pathname: '/about', lifecycle: 'public_noindex',
    title: 'About Mingla: One Platform for Plans and Hosts | Mingla',
    description: 'Learn what Mingla is, how Explorer and Mingla Host work together, where Mingla is launching, and how each product helps people show up.',
    eyebrow: 'About Mingla',
    h1: 'Mingla helps people make plans—and helps Hosts make those plans possible.',
    directQuestion: 'What is Mingla?',
    directAnswer: 'Mingla is one platform with an Explorer experience for people choosing what to do and a Host experience for businesses and organisers creating, promoting and running the places, events and experiences they can choose.',
    reviewedAt: '2026-09-10',
  },
  explorer: {
    slug: 'explorer', pathname: '/explorer', lifecycle: 'public_noindex',
    title: 'Mingla Explorer: Date Plans, Events & City Gems | Mingla',
    description: 'Use Mingla to discover date ideas, events, restaurants, activities and city gems, compare what fits, and turn an idea into a shared plan.',
    eyebrow: 'Mingla Explorer',
    h1: 'Find a plan that fits the moment.',
    directQuestion: 'What does Mingla Explorer help you do?',
    directAnswer: 'Mingla helps you move from “what should we do?” to a plan that fits the people, timing, budget, location and mood—then save it, share it and take the real booking, RSVP or ticket action when one is available.',
    reviewedAt: '2026-09-10',
  },
  cities: {
    slug: 'cities', pathname: '/cities', lifecycle: 'public_noindex',
    title: 'Mingla Cities: Local Plans and Host Tools | Mingla',
    description: 'Explore Mingla’s ten launch cities for local plans, events, experiences and matched tools for Hosts and organisers.',
    eyebrow: 'Ten launch cities',
    h1: 'Explore Mingla city by city.',
    directQuestion: 'How does Mingla organise cities?',
    directAnswer: 'Each Mingla city has its own evidence, boundaries, local context and Explorer and Host paths. Choose the city you mean; Mingla does not merge neighbouring cities into one generic page.',
    reviewedAt: '2026-09-10',
  },
  'editorial-standards': {
    slug: 'editorial-standards', pathname: '/editorial-standards', lifecycle: 'public_noindex',
    title: 'Mingla Editorial Standards, Sources & Corrections',
    description: 'See how Mingla selects, verifies, labels, updates and corrects city, event, venue and guide content—including AI and sponsored material.',
    eyebrow: 'Editorial Standards',
    h1: 'How Mingla chooses, verifies and updates content.',
    directQuestion: 'How does Mingla decide what to publish?',
    directAnswer: 'Mingla publishes decision-helpful information only when the city, source, date, action and media can be explained. Commercial relationships are labelled; stale or unsupported claims do not stay search-ready.',
    reviewedAt: '2026-09-10',
  },
}

export function allCoreTrustPagesSearchReady(): boolean {
  return CORE_PAGES.about.lifecycle === 'search_ready' &&
    CORE_PAGES.explorer.lifecycle === 'search_ready' &&
    CORE_PAGES['editorial-standards'].lifecycle === 'search_ready'
}
