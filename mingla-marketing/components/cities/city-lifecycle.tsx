import { cityHubEffectiveLifecycle, type CityHubRecord } from '@/content/cities/registry'
import type { CataloguePlace, CataloguePlan, ExplorerCategorySlug } from '@/content/page-system/shared'
import { historicalCityBuildEnabled } from '@/lib/search/historical-city-build'

// #4339 speed fix — the pieces the redesigned city page (city-page.tsx) and
// the historical #2983 layout (city-hub.tsx) share. They live here, not in
// city-hub.tsx, so the release city route never imports the historical layout
// and its client islands (the #2983 catalogue, the Cutout nav and host bar,
// framer-motion).

export interface CityHubCatalogue {
  readonly places: readonly CataloguePlace[]
  readonly plans: readonly CataloguePlan[]
  readonly initialType: 'places' | 'plans'
  readonly initialCategories: readonly ExplorerCategorySlug[]
  readonly initialIntents: readonly string[]
  readonly initialDetail: string | null
}

export function CityLifecycleNotice({ record }: { readonly record: CityHubRecord }) {
  const lifecycle = cityHubEffectiveLifecycle(record)
  const historical = historicalCityBuildEnabled()
  if (lifecycle === 'search_ready') return null
  if (lifecycle === 'public_noindex' && !historical) return null
  const content = lifecycle === 'public_noindex'
    ? ['City guide in review', 'Local details are being verified; some sections may be withheld.']
    : lifecycle === 'stale'
      ? ['This city guide is being refreshed.', 'Current details are being checked before this guide returns to search.']
      : ['This city guide is no longer actively updated.', 'Current events and availability are not shown.']
  return (
    <div className="city-lifecycle-notice" role="status">
      <strong>{content[0]}</strong><span>{content[1]}</span>
    </div>
  )
}
