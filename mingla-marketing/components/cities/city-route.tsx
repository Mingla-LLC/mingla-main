import type { CityHubRecord } from '@/content/cities/registry'
import type { CityWeekendModel } from '@/lib/city-weekend'
import type { CityHubCatalogue } from './city-lifecycle'
import { CityPage } from './city-page'

// #4339 speed fix — what app/cities/[city]/page.tsx renders in the release
// build: the redesigned city page and nothing else. It does not import the
// historical #2983 layout (city-hub.tsx), so the route's client bundle carries
// none of that layout's islands (the #2983 catalogue and detail, the Cutout
// nav, host bar and device CTA, the QR panel, framer-motion).
//
// The #2983 append-only build lane (MINGLA_HISTORICAL_2983_BUILD=1) still
// needs the historical layout: next.config.ts swaps this module for
// city-hub.tsx in that build only (CITY_ROUTE_MODULE). Same export, same props.

export function CityHub({
  record,
  catalogue,
  weekend,
}: {
  readonly record: CityHubRecord
  readonly catalogue?: CityHubCatalogue
  readonly weekend?: CityWeekendModel
}) {
  // The release page always supplies both (page.tsx); a missing one is a
  // build bug, so it fails the build loudly instead of rendering half a page.
  if (!catalogue || !weekend) {
    throw new Error(`city page ${record.slug}: the release layout needs the catalogue and the weekend`)
  }
  return <CityPage record={record} catalogue={catalogue} weekend={weekend} />
}
