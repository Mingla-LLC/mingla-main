// #4339 round B — the social share image of each page (og:image and
// twitter:image, 1200×630, public/og/<name>.jpg). Each is a frame of the
// page's own hero clip, made by scripts/generate-og-images.mjs from this table
// (name: clip). Pages not listed share the site default.

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const

export const OG_IMAGES = {
  default: 'a-friends',
  host: 'hostess',
  'host-events': 'crowd',
  'host-trips': 'hikers',
  'host-experiences': 'pottery',
  'host-restaurants': 'cafe',
  'host-hotels': 'lp-hotel',
  'host-art': 'lp-art',
  'host-play': 'nightlife',
  'city-lagos': 'c-lagos',
  'city-raleigh-nc': 'c-raleigh',
  'city-durham-nc': 'c-durham',
  'city-cary-nc': 'c-cary',
  'city-brussels': 'c-brussels',
  'city-washington-dc': 'c-dc',
  'city-new-york-city': 'c-nyc',
  'city-london': 'c-london',
  'city-paris': 'c-paris',
  'city-fort-lauderdale': 'c-ftl',
} as const

export type OgImageName = keyof typeof OG_IMAGES

/** The image for a page path: a Host landing page, a city page, /host, else the default. */
export function ogImageNameForPath(pathname: string): OgImageName {
  const landing = /^\/host\/([a-z]+)$/.exec(pathname)
  if (landing && `host-${landing[1]}` in OG_IMAGES) return `host-${landing[1]}` as OgImageName
  const city = /^\/cities\/([a-z0-9-]+)$/.exec(pathname)
  if (city && `city-${city[1]}` in OG_IMAGES) return `city-${city[1]}` as OgImageName
  if (pathname === '/host') return 'host'
  return 'default'
}

export function ogImageUrl(name: OgImageName): string {
  return `/og/${name}.jpg`
}
