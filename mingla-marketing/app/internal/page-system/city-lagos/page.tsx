import { CityCatalogue } from '@/components/page-system/city-catalogue'
import { PageSystemShell } from '@/components/page-system/page-system-shell'
import { EXPLORER_CATEGORIES, type ExplorerCategorySlug } from '@/content/page-system/shared'
import { getLagosCatalogueSnapshot } from '@/lib/page-system/city-catalogue.server'
import { publicNoindexMetadata } from '@/lib/search/metadata'

const CURRENT_PATH = '/internal/page-system/city-lagos' as const
const FUTURE_PATH = '/cities/lagos'

export const metadata = publicNoindexMetadata('/internal/page-system/city-lagos', {
  title: 'Things to do in Lagos, ranked by Mingla',
  description: 'A private review of 50 real places and Mingla editorial plans for exploring Lagos.',
})

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function LagosCityReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const snapshot = getLagosCatalogueSnapshot()
  const detail = first(query.detail) ?? null
  const initialType = first(query.type) === 'plans' || detail?.startsWith('plan:') ? 'plans' : 'places'
  const requestedCategories = first(query.categories)?.split(',') ?? []
  const initialCategories = [...new Set(requestedCategories.filter(
    (candidate): candidate is ExplorerCategorySlug => EXPLORER_CATEGORIES.some((category) => category.slug === candidate),
  ))]
  const validIntents = new Set(snapshot.plans.map((plan) => plan.generatedCardId.replace('lagos-editorial-', '')))
  const initialIntents = [...new Set((first(query.intents)?.split(',') ?? []).filter((intent) => validIntents.has(intent)))]

  return (
    <PageSystemShell currentPath={CURRENT_PATH} futurePath={FUTURE_PATH} audience="city" hostAcquisition>
      <header className="ps-city-hero">
        <p className="ps-eyebrow">Mingla Explorer · Lagos</p>
        <h1>Things to do in Lagos, ranked by Mingla</h1>
        <p>Browse 50 real picks across all ten Explorer categories, or open a ready-made plan.</p>
      </header>

      <CityCatalogue
        places={snapshot.places}
        plans={snapshot.plans}
        initialType={initialType}
        initialCategories={initialCategories}
        initialIntents={initialIntents}
        initialDetail={detail}
      />
    </PageSystemShell>
  )
}
