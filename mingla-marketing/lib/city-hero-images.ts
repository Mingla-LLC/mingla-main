// #4137 wave 2 — the city page hero photos.
//
// Each entry is the licensed city photo already live on /cities, recorded with
// its source, author and licence in public/marketing/cities/asset-manifest.json
// (Unsplash licence: no credit required, so the page shows no caption). Never a
// place-pool or Google photo. Dimensions are read from the files.

import type { CityHubSlug } from '@/content/cities/registry'

export const CITY_HERO_IMAGE: Readonly<Record<CityHubSlug, { readonly src: string; readonly width: number; readonly height: number }>> = {
  lagos: { src: '/marketing/cities/cards/lagos.jpg', width: 1400, height: 788 },
  'durham-nc': { src: '/marketing/cities/cards/durham-nc.jpg', width: 1400, height: 933 },
  'cary-nc': { src: '/marketing/cities/cards/cary-nc.jpg', width: 1400, height: 977 },
  'raleigh-nc': { src: '/marketing/cities/cards/raleigh-nc.jpg', width: 1400, height: 933 },
  'new-york-city': { src: '/marketing/cities/cards/new-york-city.jpg', width: 1400, height: 933 },
  brussels: { src: '/marketing/cities/cards/brussels.jpg', width: 1400, height: 1050 },
  paris: { src: '/marketing/cities/cards/paris.jpg', width: 1400, height: 2100 },
  london: { src: '/marketing/cities/cards/london.jpg', width: 1400, height: 933 },
  'fort-lauderdale': { src: '/marketing/cities/cards/fort-lauderdale.jpg', width: 1400, height: 2100 },
  'washington-dc': { src: '/marketing/cities/cards/washington-dc.jpg', width: 1400, height: 2100 },
}
