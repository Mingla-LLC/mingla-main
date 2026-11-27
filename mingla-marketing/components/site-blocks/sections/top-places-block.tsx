// #4636 live block `topPlaces` — the guide city's ranked places with their
// detail sheet. The view is components/cities/city-weekend.tsx, unchanged; the
// places stay the #4137 catalogue snapshot (R7). The editor sets only the
// city, which must have a hand-made guide. Needs the city wrapper.
import { CityWeekend } from '@/components/cities/city-weekend'
import type { CityHubCatalogue } from '@/components/cities/city-lifecycle'
import { cityHubPath, type CityHubRecord } from '@/content/cities/registry'
import { cataloguePlaceView } from '@/content/page-system/shared'
import { getCityCatalogueSnapshot } from '@/lib/page-system/city-catalogue.server'
import { guideCity, type CityParams } from './city-data'
import type { BlockProps } from './shared'

export type TopPlacesContent = CityParams

export function TopPlacesBlock({ content, record, catalogue }: BlockProps<TopPlacesContent> & { record?: CityHubRecord; catalogue?: Pick<CityHubCatalogue, 'places'> }) {
  const guide = record ?? guideCity(content.city)
  if (!guide) {
    console.error(`[site-blocks] topPlaces: "${content.city}" has no city guide`)
    return null
  }
  const places = (catalogue ?? getCityCatalogueSnapshot(guide.slug, cityHubPath(guide))).places
  return (
    <CityWeekend
      cityName={guide.city}
      citySlug={guide.slug}
      countryCode={guide.countryCode}
      locale={guide.locale}
      cityPath={cityHubPath(guide)}
      // #4339 speed fix: the card/detail view of each place, not the full
      // catalogue record (its receipts stay on the server).
      places={places.map(cataloguePlaceView)}
    />
  )
}
