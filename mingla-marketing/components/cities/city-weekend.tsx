'use client'

import { orphanTile } from '@/components/site/orphan-tile'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { CurrentPlacePhoto } from '@/components/page-system/current-place-photo'
import type { CataloguePlaceView } from '@/content/page-system/shared'
import { storedPlaceThumbSrc } from '@/lib/city-place-photo'
import { categoryRank, rankLabel, ratingLine } from '@/lib/city-place-rank'

// #4339 phase 2b — the city's ranked places, in the approved design's card
// style.
//
// #4339 phase 4a — "This weekend" moved to the live readers
// (city-this-weekend.tsx, which owns the Events / Experiences / Places chips),
// so this section is now the page's existing places, below it, under its own
// heading, "Places in <City>." (id="places", the target of the weekend's
// Places chip when the weekend has listings).
//
// DATA: the page's EXISTING source, unchanged (the #4137 catalogue snapshot:
// the city's ranked places).
//
// A card opens the place detail exactly as before (#4137): the URL gains the
// place's detail path, the sheet opens, Escape or Back closes it and focus
// returns to the card. The sheet is portalled into the page-system root so its
// own styles apply.

const COLLAPSED_COUNT = 12

// #4339 speed fix: the place detail sheet (and the device CTA, QR panel and
// motion it carries) loads only when a place is opened — a tap, or a shared
// ?detail= link — never with the page. The card's pointer-down starts the
// download so the sheet is usually ready by the click.
const loadCatalogueDetail = () => import('@/components/page-system/catalogue-detail')
const CatalogueDetail = lazy(() => loadCatalogueDetail().then((module) => ({ default: module.CatalogueDetail })))

interface CityWeekendProps {
  readonly cityName: string
  readonly citySlug: string
  readonly countryCode: string
  readonly locale: string
  readonly cityPath: string
  readonly places: readonly CataloguePlaceView[]
}

export function CityWeekend({ cityName, citySlug, countryCode, locale, cityPath, places }: CityWeekendProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [detail, setDetail] = useState<string | null>(null)
  const [portal, setPortal] = useState<Element | null>(null)
  const openerRef = useRef<HTMLAnchorElement | null>(null)
  const gridRef = useRef<HTMLUListElement>(null)
  const focusAfterExpand = useRef(false)

  const ranks = useMemo(() => categoryRank(places), [places])
  const visible = places
  // The tiles on screen: 12 while collapsed, all once expanded (no-orphan rule).
  const shownCount = collapsed ? Math.min(COLLAPSED_COUNT, visible.length) : visible.length
  const selected = detail?.startsWith('place:') ? places.find((place) => `place:${place.placePoolId}` === detail) : undefined

  useEffect(() => {
    setPortal(document.querySelector('[data-city-detail-host]'))
    function syncFromLocation() {
      const nextDetail = new URLSearchParams(window.location.search).get('detail')
      setDetail(nextDetail?.startsWith('place:') ? nextDetail : null)
      if (!nextDetail && openerRef.current) window.requestAnimationFrame(() => openerRef.current?.focus())
    }
    syncFromLocation()
    window.addEventListener('popstate', syncFromLocation)
    return () => window.removeEventListener('popstate', syncFromLocation)
  }, [])

  useEffect(() => {
    if (!focusAfterExpand.current || collapsed) return
    focusAfterExpand.current = false
    gridRef.current?.querySelectorAll<HTMLAnchorElement>('.wk-card')[COLLAPSED_COUNT]?.focus()
  }, [collapsed])

  function openPlace(event: MouseEvent<HTMLAnchorElement>, place: CataloguePlaceView) {
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
    window.history.replaceState({ ...window.history.state, cityPlaceDetail: false }, '', cityPath)
    setDetail(null)
    window.requestAnimationFrame(() => openerRef.current?.focus())
  }, [cityPath])

  const sheet = detail ? (
    selected ? (
      <CatalogueDetail
        item={selected}
        cityName={cityName}
        backHref={cityPath}
        onClose={closeDetail}
        rankLabel={rankLabel(selected, ranks)}
        placePhoto={{ src: storedPlaceThumbSrc(selected.googlePlaceId), categorySlug: selected.categorySlug }}
      />
    ) : (
      <aside className="ps-detail-missing" role="alert">
        <h2>That pick is no longer available.</h2>
        <a href={cityPath} onClick={(event) => { event.preventDefault(); closeDetail() }}>Back to {cityName} picks</a>
      </aside>
    )
  ) : null

  return (
    <section className="sec places-sec" id="places" aria-labelledby="city-places-title">
      <div className="wrap">
        <div className="wk-head">
          <h2 className="h2" id="city-places-title">
            Top places <em>in {cityName}.</em>
          </h2>
        </div>

        {visible.length ? (
          <>
            <noscript><style>{'.wk-grid[data-collapsed] > li{display:list-item!important}.wk-more{display:none!important}'}</style></noscript>
            <ul ref={gridRef} id="city-places-grid" className="wk-grid" data-collapsed={collapsed && visible.length > COLLAPSED_COUNT ? 'true' : 'false'}>
              {visible.map((place, index) => {
                const label = rankLabel(place, ranks)
                const rating = ratingLine(place, locale)
                return (
                  <li key={place.placePoolId} data-tags="Places" data-orphan={orphanTile(index, shownCount) ? '' : undefined}>
                    <a
                      href={place.detailHref}
                      // #4339 round B: the detail URL is a query-string view of
                      // this page; nofollow keeps ~500 parameter URLs out of crawls.
                      rel="nofollow"
                      className="wk-card"
                      data-city-place-card=""
                      data-category={place.categorySlug}
                      aria-label={`${place.name}, ${label}${rating ? `, ${rating}` : ''}. View place`}
                      onPointerDown={() => void loadCatalogueDetail()}
                      onClick={(event) => openPlace(event, place)}
                    >
                      <div className="ph">
                        <CurrentPlacePhoto
                          googlePlaceId={place.googlePlaceId}
                          name={place.name}
                          cityName={cityName}
                          eager={false}
                          storedPhotoSrc={storedPlaceThumbSrc(place.googlePlaceId)}
                          fallback="category"
                          categorySlug={place.categorySlug}
                          className="city-v2-place-media"
                        />
                      </div>
                      <span className="kind">Place · {label}</span>
                      <h3>{place.name}</h3>
                      {rating ? <p>{rating}</p> : null}
                    </a>
                  </li>
                )
              })}
            </ul>
            {collapsed && visible.length > COLLAPSED_COUNT ? (
              <div className="wk-more">
                <button
                  type="button"
                  className="btn soft"
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
          </>
        ) : (
          <p className="filter-note">{`No places are listed in ${cityName} yet. Check back soon.`}</p>
        )}
      </div>
      {sheet && portal ? createPortal(<Suspense fallback={null}>{sheet}</Suspense>, portal) : null}
    </section>
  )
}
