// #4636 live block `cityWeekend` — "This weekend" from the #4318 live readers
// (admin strips, the city's Friday–Sunday listings, the empty-week rule and the
// Events / Experiences / Places chips). The view is
// components/cities/city-this-weekend.tsx, unchanged; the editor sets only the
// city (R7). Needs the city wrapper.
import { LazyCityThisWeekend as CityThisWeekend } from '../lazy-islands'  // #4636: own chunk (first-load budget)
import type { CityWeekendModel } from '@/lib/city-weekend'
import { cityIdentity, cityWeekendFor, type CityIdentity, type CityParams } from './city-data'
import type { BlockProps } from './shared'

export type CityWeekendContent = CityParams

export async function CityWeekendBlock({ content, identity, model }: BlockProps<CityWeekendContent> & { identity?: CityIdentity; model?: CityWeekendModel }) {
  const record = identity ?? (await cityIdentity(content.city))
  const weekend = model ?? (record ? await cityWeekendFor(record.slug) : null)
  if (!record || !weekend) {
    console.error(`[site-blocks] cityWeekend: no weekend for city "${content.city}"`)
    return null
  }
  return <CityThisWeekend cityName={record.city} citySlug={record.slug} countryCode={record.countryCode} model={weekend} />
}
