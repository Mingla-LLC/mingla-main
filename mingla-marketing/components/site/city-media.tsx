import { LandingMedia } from '@/components/landing/landing-media'
import type { CityHubSlug } from '@/content/cities/registry'
import type { LandingMediaRef } from '@/content/host-landing/icps'
import { CITY_HERO_IMAGE } from '@/lib/city-hero-images'

// #4339 phase 2b — one picture per city, shared by the city tiles (/cities)
// and the city page hero, so a tile and its page always match (§11: the city
// page hero shares the city tile clip).
//
// A city with a picked clip or redesign photo uses it (the same picks as the
// home page's city row). The rest use the licensed city photo that is already
// live (lib/city-hero-images.ts) until Seth picks their clips (§11 picking
// board): a photo where no clip exists yet, never a blank tile.

export const CITY_MEDIA: Readonly<Partial<Record<CityHubSlug, LandingMediaRef>>> = {
  lagos: 'p:weekend-lagos-cover',
  'raleigh-nc': 'v:raleigh',
  'durham-nc': 'p:weekend-durham-cover',
  'cary-nc': 'p:weekend-cary-cover',
  brussels: 'v:grandplace',
}

interface CityMediaProps {
  slug: CityHubSlug
  /** The page hero: the one picture allowed to load on first paint. */
  hero?: boolean
}

export function CityMedia({ slug, hero = false }: CityMediaProps) {
  const media = CITY_MEDIA[slug]
  if (media) return <LandingMedia media={media} hero={hero} kenBurns={hero && media.startsWith('p:')} />
  const photo = CITY_HERO_IMAGE[slug]
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.src}
      width={photo.width}
      height={photo.height}
      alt=""
      className={hero ? 'kb' : undefined}
      loading={hero ? 'eager' : 'lazy'}
      decoding="async"
      {...(hero ? { fetchPriority: 'high' as const } : {})}
    />
  )
}
