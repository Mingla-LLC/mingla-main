'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CataloguePlace, CataloguePlan, ExplorerCategorySlug } from '@/content/page-system/shared'
import { EXPLORER_CATEGORIES } from '@/content/page-system/shared'
import { CatalogueDetail } from './catalogue-detail'
import { ExplorerCatalogueCard } from './explorer-catalogue-card'

type CatalogueType = 'places' | 'plans'

interface CityCatalogueProps {
  readonly places: readonly CataloguePlace[]
  readonly plans: readonly CataloguePlan[]
  readonly initialType: CatalogueType
  readonly initialCategories: readonly ExplorerCategorySlug[]
  readonly initialIntents: readonly string[]
  readonly initialDetail: string | null
}

const CITY_PATH = '/internal/page-system/city-lagos'

function planIntent(plan: CataloguePlan): string {
  return plan.generatedCardId.replace('lagos-editorial-', '')
}

function catalogueHref(type: CatalogueType, categories: readonly ExplorerCategorySlug[], intents: readonly string[], detail?: string): string {
  const query = new URLSearchParams({ type })
  if (type === 'places' && categories.length > 0) query.set('categories', categories.join(','))
  if (type === 'plans' && intents.length > 0) query.set('intents', intents.join(','))
  if (detail) query.set('detail', detail)
  return `${CITY_PATH}?${query.toString()}`
}

function interleavePlaces(places: readonly CataloguePlace[], categories: readonly ExplorerCategorySlug[]): readonly CataloguePlace[] {
  if (categories.length === 0) return places
  const buckets = categories.map((category) => places
    .filter((place) => place.categorySlug === category)
    .sort((left, right) => right.signalScore - left.signalScore))
  const result: CataloguePlace[] = []
  for (let round = 0; round < Math.max(...buckets.map((bucket) => bucket.length), 0); round += 1) {
    for (const bucket of buckets) {
      if (bucket[round]) result.push(bucket[round])
    }
  }
  return result
}

export function CityCatalogue({ places, plans, initialType, initialCategories, initialIntents, initialDetail }: CityCatalogueProps) {
  const [type, setType] = useState<CatalogueType>(initialType)
  const [categories, setCategories] = useState<readonly ExplorerCategorySlug[]>(initialCategories)
  const [intents, setIntents] = useState<readonly string[]>(initialIntents)
  const [detail, setDetail] = useState(initialDetail)
  const openerRef = useRef<HTMLAnchorElement | null>(null)

  const visiblePlaces = useMemo(() => interleavePlaces(places, categories), [categories, places])
  const visiblePlans = useMemo(
    () => intents.length === 0 ? plans : intents.flatMap((intent) => plans.filter((plan) => planIntent(plan) === intent)),
    [intents, plans],
  )
  const visibleItems = type === 'places' ? visiblePlaces : visiblePlans
  const backHref = catalogueHref(type, categories, intents)
  const selectedItem = detail?.startsWith('place:')
    ? places.find((place) => `place:${place.placePoolId}` === detail)
    : detail?.startsWith('plan:')
      ? plans.find((plan) => `plan:${plan.generatedCardId}` === detail)
      : undefined

  useEffect(() => {
    function onPopState() {
      const query = new URLSearchParams(window.location.search)
      const nextType = query.get('type') === 'plans' ? 'plans' : 'places'
      const nextCategories = (query.get('categories')?.split(',') ?? [])
        .filter((candidate): candidate is ExplorerCategorySlug => EXPLORER_CATEGORIES.some((category) => category.slug === candidate))
      const validIntents = new Set(plans.map(planIntent))
      const nextIntents = (query.get('intents')?.split(',') ?? []).filter((intent) => validIntents.has(intent))
      setType(nextType)
      setCategories(nextCategories)
      setIntents(nextIntents)
      setDetail(query.get('detail'))
      if (!query.get('detail') && openerRef.current) {
        window.requestAnimationFrame(() => openerRef.current?.focus())
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [plans])

  function navigate(nextHref: string, next: { type?: CatalogueType; categories?: readonly ExplorerCategorySlug[]; intents?: readonly string[]; detail?: string | null }) {
    window.history.pushState({ ...window.history.state, pageSystemDetail: Boolean(next.detail) }, '', nextHref)
    if (next.type) setType(next.type)
    if (next.categories) setCategories(next.categories)
    if (next.intents) setIntents(next.intents)
    if ('detail' in next) setDetail(next.detail ?? null)
  }

  function setCatalogueType(nextType: CatalogueType, href: string) {
    navigate(href, { type: nextType, categories: [], intents: [], detail: null })
  }

  function toggleCategory(slug: ExplorerCategorySlug, href: string) {
    const next = categories.length === 0
      ? [slug]
      : categories.includes(slug)
        ? categories.filter((category) => category !== slug)
        : [...categories, slug]
    navigate(href, { categories: next, detail: null })
  }

  function toggleIntent(intent: string, href: string) {
    const next = intents.length === 0
      ? [intent]
      : intents.includes(intent)
        ? intents.filter((candidate) => candidate !== intent)
        : [...intents, intent]
    navigate(href, { intents: next, detail: null })
  }

  function openDetail(href: string, opener: HTMLAnchorElement) {
    openerRef.current = opener
    const nextDetail = new URL(href, window.location.href).searchParams.get('detail')
    navigate(href, { detail: nextDetail })
  }

  const closeDetail = useCallback(() => {
    if (window.history.state?.pageSystemDetail) {
      window.history.back()
      return
    }
    window.history.replaceState({ ...window.history.state, pageSystemDetail: false }, '', backHref)
    setDetail(null)
    window.requestAnimationFrame(() => openerRef.current?.focus())
  }, [backHref])

  return (
    <section className="ps-catalogue" aria-labelledby="catalogue-results-heading">
      <div className="ps-catalogue-controls" data-print-hide>
        <div className="ps-type-toggle" aria-label="Choose catalogue type">
          {(['places', 'plans'] as const).map((candidate) => {
            const href = catalogueHref(candidate, [], [])
            return (
              <a
                key={candidate}
                href={href}
                aria-current={type === candidate ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault()
                  setCatalogueType(candidate, href)
                }}
              >
                {candidate === 'places' ? 'Places' : 'Plans'}
              </a>
            )
          })}
        </div>

        <div className="ps-filter-rail" aria-label={type === 'places' ? 'Filter places by category' : 'Filter plans by intent'}>
          <a
            href={catalogueHref(type, [], [])}
            aria-current={(type === 'places' ? categories.length : intents.length) === 0 ? 'true' : undefined}
            onClick={(event) => {
              event.preventDefault()
              navigate(catalogueHref(type, [], []), type === 'places' ? { categories: [], detail: null } : { intents: [], detail: null })
            }}
          >
            {type === 'places' ? 'All 10' : 'All plans'}
          </a>
          {type === 'places' ? EXPLORER_CATEGORIES.map((category) => {
            const selected = categories.includes(category.slug)
            const next = categories.length === 0
              ? [category.slug]
              : selected
                ? categories.filter((candidate) => candidate !== category.slug)
                : [...categories, category.slug]
            const href = catalogueHref(type, next, [])
            return <a key={category.slug} href={href} aria-pressed={selected} onClick={(event) => { event.preventDefault(); toggleCategory(category.slug, href) }}>{category.label}</a>
          }) : plans.map((plan) => {
            const intent = planIntent(plan)
            const selected = intents.includes(intent)
            const next = intents.length === 0 ? [intent] : selected ? intents.filter((candidate) => candidate !== intent) : [...intents, intent]
            const href = catalogueHref(type, [], next)
            return <a key={intent} href={href} aria-pressed={selected} onClick={(event) => { event.preventDefault(); toggleIntent(intent, href) }}>{plan.intentLabel}</a>
          })}
        </div>
      </div>

      <header className="ps-catalogue-result-heading">
        <div><p className="ps-eyebrow">{type === 'places' ? 'Explorer-ranked places' : 'Mingla ready-made plans'}</p><h2 id="catalogue-results-heading">{type === 'places' ? `${visiblePlaces.length} Lagos places` : `${visiblePlans.length} Lagos plans`}</h2></div>
        <p aria-live="polite" aria-atomic="true">{type === 'places' ? 'Each category keeps its own score order.' : 'Plans are shown as curated compositions, not ranked against places.'}</p>
      </header>

      {visibleItems.length > 0 ? (
        <div className="ps-catalogue-grid">
          {visibleItems.map((item, index) => {
            const detailValue = item.kind === 'place' ? `place:${item.placePoolId}` : `plan:${item.generatedCardId}`
            const href = catalogueHref(type, categories, intents, detailValue)
            return <ExplorerCatalogueCard key={detailValue} item={item} href={href} featured={index < 4} onOpen={openDetail} />
          })}
        </div>
      ) : (
        <div className="ps-catalogue-empty" role="status">
          <h3>{type === 'places' ? 'No Lagos places are ready in this category yet.' : 'No ready-made Lagos plans came back this time.'}</h3>
          <p>{type === 'places' ? 'Try another category.' : 'Try another plan intent.'}</p>
        </div>
      )}

      {detail ? selectedItem ? <CatalogueDetail item={selectedItem} backHref={backHref} onClose={closeDetail} /> : (
        <aside className="ps-detail-missing" role="alert"><h2>That pick is no longer available.</h2><a href={backHref} onClick={(event) => { event.preventDefault(); closeDetail() }}>Back to Lagos picks</a></aside>
      ) : null}
    </section>
  )
}
