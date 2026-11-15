import { LandingMedia } from '@/components/landing/landing-media'
import type { CityHubSlug } from '@/content/cities/registry'
import type { LandingMediaRef } from '@/content/host-landing/icps'

// #4339 phase 2b — one picture per city, shared by the city tiles (/cities)
// and the city page hero, so a tile and its page always match (§11: the city
// page hero shares the city tile clip).
//
// Every city has its own picked loop (#4339 §11 picking board, Seth 8 Nov):
// `c-<city>` in public/marketing/site/m/, a 7 s web loop with its poster. The
// Home cities row reads this same map, so a tile, its page hero and the Home
// row always show the same clip. The Cary clip is a Hillsborough NC aerial,
// approved by Seth for now.
export const CITY_MEDIA: Readonly<Record<CityHubSlug, LandingMediaRef>> = {
  lagos: 'v:c-lagos',
  'raleigh-nc': 'v:c-raleigh',
  'durham-nc': 'v:c-durham',
  'cary-nc': 'v:c-cary',
  brussels: 'v:c-brussels',
  'washington-dc': 'v:c-dc',
  'new-york-city': 'v:c-nyc',
  london: 'v:c-london',
  paris: 'v:c-paris',
  'fort-lauderdale': 'v:c-ftl',
}

// #4339 — live cities with no hand-made guide (Abuja, Ibadan, Kaduna, Kano).
// Same `c-<city>` loop format. Keyed by the city's slug as /cities/<slug> shows
// it. A live city that is in neither map shows a brand-colour card (below), so
// a newly switched-on city never renders a broken video.
export const LIVE_CITY_MEDIA: Readonly<Record<string, LandingMediaRef>> = {
  abuja: 'v:c-abuja',
  ibadan: 'v:c-ibadan',
  kaduna: 'v:c-kaduna',
  kano: 'v:c-kano',
}

/** The picked clip for any city key, or null when it has none yet. */
export function cityMediaFor(slug: string): LandingMediaRef | null {
  if (Object.prototype.hasOwnProperty.call(CITY_MEDIA, slug)) return CITY_MEDIA[slug as CityHubSlug]
  if (Object.prototype.hasOwnProperty.call(LIVE_CITY_MEDIA, slug)) return LIVE_CITY_MEDIA[slug]
  return null
}

const BRAND_FIELDS = ['moss', 'night', 'clay', 'sand'] as const

/** A stable brand field (Moss / Night / Clay / Sand) for a city key. */
export function cityBrandField(slug: string): (typeof BRAND_FIELDS)[number] {
  let sum = 0
  for (let i = 0; i < slug.length; i += 1) sum = (sum * 31 + slug.charCodeAt(i)) % 997
  return BRAND_FIELDS[sum % BRAND_FIELDS.length]
}

interface CityMediaProps {
  /** Any city key: a registry slug or a live city's slug. */
  slug: string
  /** The page hero: the one picture allowed to load on first paint. */
  hero?: boolean
}

export function CityMedia({ slug, hero = false }: CityMediaProps) {
  const media = cityMediaFor(slug)
  if (media === null) return <div className={`city-field city-field-${cityBrandField(slug)}`} aria-hidden="true" />
  return <LandingMedia media={media} hero={hero} />
}
