// #4339 Creators and Locals calls (Seth approved, 9 Nov) — the "Your city"
// options on /schedule/creators and /schedule/locals.
//
// ALWAYS every live Mingla city: read at request time from
// `links_page_cities()` through the #4318 reader (lib/links-data.ts
// getLinksData: the same Data Cache, 5 minutes, and `links` tag as /links), so
// a city appears as soon as it goes live, with no code change or deploy. Never
// a literal list. Sorted by name with "Somewhere else" last
// (lib/booking-social.ts cityOptions). When the read fails, or no database is
// configured, it is "Somewhere else" alone and the form adds a free-text city,
// so nobody is blocked.
//
// Server-only and React-free, so the node tests run it with a stubbed fetch.

import { cityOptions } from './booking-social'
import { getLinksData } from './links-data'

export async function liveCityOptions(): Promise<string[]> {
  const data = await getLinksData()
  return cityOptions(data.failed.includes('cities') ? [] : data.cities)
}
