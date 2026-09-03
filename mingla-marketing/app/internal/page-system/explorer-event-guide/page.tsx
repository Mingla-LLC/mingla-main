import { CityEditorialGuide } from '@/components/page-system/city-editorial-guide'
import { PageSystemShell } from '@/components/page-system/page-system-shell'
import { getLagosRankedPlaces } from '@/lib/page-system/city-catalogue.server'
import { publicNoindexMetadata } from '@/lib/search/metadata'

const CURRENT_PATH = '/internal/page-system/explorer-event-guide' as const
const FUTURE_PATH = '/guides/lagos-parties-dates-hangouts-and-culture'

export const metadata = publicNoindexMetadata('/internal/page-system/explorer-event-guide', {
  title: 'Things to do in Lagos for every mood — Mingla',
  description: 'A short, picture-led Mingla guide to Lagos parties, dates, group hangouts and culture.',
})

export default function ExplorerEventGuideReviewPage() {
  return (
    <PageSystemShell currentPath={CURRENT_PATH} futurePath={FUTURE_PATH} audience="explorer">
      <CityEditorialGuide places={getLagosRankedPlaces()} />
    </PageSystemShell>
  )
}
