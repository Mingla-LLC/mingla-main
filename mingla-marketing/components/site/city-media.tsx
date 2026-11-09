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

interface CityMediaProps {
  slug: CityHubSlug
  /** The page hero: the one picture allowed to load on first paint. */
  hero?: boolean
}

export function CityMedia({ slug, hero = false }: CityMediaProps) {
  return <LandingMedia media={CITY_MEDIA[slug]} hero={hero} />
}
