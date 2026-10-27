'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { CatalogueDetail } from '@/components/page-system/catalogue-detail'
import { CurrentPlacePhoto } from '@/components/page-system/current-place-photo'
import { EXPLORER_CATEGORIES, type CataloguePlace, type ExplorerCategorySlug } from '@/content/page-system/shared'
import { storedPlaceThumbSrc } from '@/lib/city-place-photo'
import { categoryRank, rankLabel, ratingLine } from '@/lib/city-place-rank'

// #4137 wave 2 — the top places grid.
//
// WHY NO PER-CARD CTA AND NO SCORE: the old catalogue put a "Get the app"
// button on all 50 cards and showed a "Mingla score" that was 194 for 47 of
// Raleigh's 50 places, so it told a visitor nothing. The page now has ONE
// Explorer CTA (the hero), each card says what it is ("#1 · Brunch"), and the
// card opens the place detail, which carries its own single CTA.
//
// Photos are Mingla's stored place-pool thumbnails (Seth, 27 Oct 2026), shown
// without a credit line; a category tile replaces any that fail to load.

const COLLAPSED_COUNT = 12

interface CityTopPlacesProps {
  readonly cityName: string
  readonly citySlug: string
  readonly countryCode: string
  readonly locale: string
  readonly cityPath: string
  readonly places: readonly CataloguePlace[]
}

function isCategory(value: string | null | undefined): value is ExplorerCategorySlug {
  return EXPLORER_CATEGORIES.some((category) => category.slug === value)
}

function categoryFromQuery(query: URLSearchParams): ExplorerCategorySlug | null {
  const single = query.get('category')
  if (isCategory(single)) return single
  return (query.get('categories')?.split(',') ?? []).find(isCategory) ?? null
}

export function CityTopPlaces({ cityName, citySlug, countryCode, locale, cityPath, places }: CityTopPlacesProps) {
  const [category, setCategory] = useState<ExplorerCategorySlug | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [detail, setDetail] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const openerRef = useRef<HTMLAnchorElement | null>(null)
  const gridRef = useRef<HTMLUListElement>(null)
  const focusAfterExpand = useRef(false)

  const ranks = useMemo(() => categoryRank(places), [places])
  const chips = useMemo(
    () => EXPLORER_CATEGORIES.filter((entry) => places.some((place) => place.categorySlug === entry.slug)),
    [places],
  )
  const visible = useMemo(
    () => category ? places.filter((place) => place.categorySlug === category) : places,
    [category, places],
  )
  const listHref = category ? `${cityPath}?category=${category}` : cityPath
  const selected = detail?.startsWith('place:') ? places.find((place) => `place:${place.placePoolId}` === detail) : undefined

  useEffect(() => {
    function syncFromLocation() {
      const query = new URLSearchParams(window.location.search)
      setCategory(categoryFromQuery(query))
      const nextDetail = query.get('detail')
      setDetail(nextDetail?.startsWith('place:') ? nextDetail : null)
      if (!nextDetail && openerRef.current) window.requestAnimationFrame(() => openerRef.current?.focus())
    }
    syncFromLocation()
    if (new URLSearchParams(window.location.search).get('type') === 'plans') document.getElementById('plans')?.scrollIntoView()
    window.addEventListener('popstate', syncFromLocation)
    return () => window.removeEventListener('popstate', syncFromLocation)
  }, [])

  useEffect(() => {
    if (!focusAfterExpand.current || collapsed) return
    focusAfterExpand.current = false
    gridRef.current?.querySelectorAll<HTMLAnchorElement>('.city-v2-place-link')[COLLAPSED_COUNT]?.focus()
  }, [collapsed])

  function selectCategory(next: ExplorerCategorySlug | null) {
    setCategory(next)
    setCollapsed(true)
    window.history.replaceState({ ...window.history.state, cityPlaceDetail: false }, '', next ? `${cityPath}?category=${next}` : cityPath)
    const count = next ? places.filter((place) => place.categorySlug === next).length : places.length
    const label = next ? EXPLORER_CATEGORIES.find((entry) => entry.slug === next)?.label : null
    setAnnouncement(label ? `Showing ${count} ${label} places` : `Showing all ${count} places`)
  }

  function openPlace(event: MouseEvent<HTMLAnchorElement>, place: CataloguePlace) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openerRef.current = event.currentTarget
    window.history.pushState({ ...window.history.state, cityPlaceDetail: true }, '', place.detailHref)
    setDetail(`place:${place.placePoolId}`)
    captureMarketing('city_hub_inventory_action', {
      city_slug: citySlug,
      country_code: countryCode,
      page_family: 'city_hub',
      destination_type: 'place',
    })
  }

  const closeDetail = useCallback(() => {
    if (window.history.state?.cityPlaceDetail) {
      window.history.back()
      return
    }
    window.history.replaceState({ ...window.history.state, cityPlaceDetail: false }, '', listHref)
    setDetail(null)
    window.requestAnimationFrame(() => openerRef.current?.focus())
  }, [listHref])

  return (
    <section className="city-v2-places" id="places" aria-labelledby="city-places-title">
      <div className="city-v2-places-heading">
        <span className="city-v2-pill city-v2-pill-ink">Top {places.length} places</span>
        <h2 id="city-places-title">{cityName}&apos;s best, by mood.</h2>
      </div>

      <div role="group" aria-label="Filter places by category" className="city-v2-chips">
        <button type="button" aria-pressed={category === null} onClick={() => selectCategory(null)}>All {places.length}</button>
        {chips.map((chip) => (
          <button key={chip.slug} type="button" aria-pressed={category === chip.slug} onClick={() => selectCategory(chip.slug)}>{chip.label}</button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>

      <noscript><style>{'.city-v2-grid[data-collapsed] > li{display:list-item!important}.city-v2-show-all{display:none!important}'}</style></noscript>
      <ul ref={gridRef} id="city-places-grid" className="city-v2-grid" data-collapsed={collapsed && visible.length > COLLAPSED_COUNT ? 'true' : 'false'}>
        {visible.map((place, index) => {
          const label = rankLabel(place, ranks)
          const rating = ratingLine(place, locale)
          return (
            <li key={place.placePoolId}>
              <article className="city-v2-place" data-city-place-card data-category={place.categorySlug}>
                <a
                  href={place.detailHref}
                  className="city-v2-place-link"
                  aria-label={`${place.name}, ${label}${rating ? `, ${rating}` : ''}. View place`}
                  onClick={(event) => openPlace(event, place)}
                >
                  <div className="city-v2-place-photo">
                    <CurrentPlacePhoto
                      googlePlaceId={place.googlePlaceId}
                      name={place.name}
                      cityName={cityName}
                      eager={index < 4}
                      storedPhotoSrc={storedPlaceThumbSrc(place.googlePlaceId)}
                      fallback="category"
                      categorySlug={place.categorySlug}
                      className="city-v2-place-media"
                    />
                    <span className="city-v2-rank" aria-hidden="true">{label}</span>
                  </div>
                  <h3>{place.name}</h3>
                  {rating ? <p className="city-v2-place-rating">{rating}</p> : null}
                </a>
              </article>
            </li>
          )
        })}
      </ul>
      {collapsed && visible.length > COLLAPSED_COUNT ? (
        <div className="city-v2-show-all-row">
          <button
            type="button"
            className="city-v2-show-all"
            aria-controls="city-places-grid"
            aria-expanded="false"
            onClick={() => {
              focusAfterExpand.current = true
              setCollapsed(false)
            }}
          >
            Show all {visible.length} places
          </button>
        </div>
      ) : null}

      {detail ? (
        selected ? (
          <CatalogueDetail
            item={selected}
            cityName={cityName}
            backHref={listHref}
            onClose={closeDetail}
            rankLabel={rankLabel(selected, ranks)}
            placePhoto={{ src: storedPlaceThumbSrc(selected.googlePlaceId), categorySlug: selected.categorySlug }}
          />
        ) : (
          <aside className="ps-detail-missing" role="alert">
            <h2>That pick is no longer available.</h2>
            <a href={listHref} onClick={(event) => { event.preventDefault(); closeDetail() }}>Back to {cityName} picks</a>
          </aside>
        )
      ) : null}
    </section>
  )
}
