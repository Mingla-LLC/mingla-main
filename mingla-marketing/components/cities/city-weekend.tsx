'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { CatalogueDetail } from '@/components/page-system/catalogue-detail'
import { CurrentPlacePhoto } from '@/components/page-system/current-place-photo'
import { FilterChips } from '@/components/site/filter-row'
import type { CataloguePlace } from '@/content/page-system/shared'
import { storedPlaceThumbSrc } from '@/lib/city-place-photo'
import { categoryRank, rankLabel, ratingLine } from '@/lib/city-place-rank'

// #4339 phase 2b — the city page's "This weekend" section, in the approved
// design: the heading, the Events / Experiences / Places chips (one row that
// swipes on a phone; each chip is a button that filters the cards) and the
// cards in the new style.
//
// DATA: the page's EXISTING source, unchanged (the #4137 catalogue snapshot:
// the city's ranked places). The live weekly listings (links_page_week /
// links_page_strips, §4) arrive in phase 4. Until then the city has no event
// or experience listings on this page, so those chips say so honestly instead
// of showing anything invented (Constitution #9).
//
// A card opens the place detail exactly as before (#4137): the URL gains the
// place's detail path, the sheet opens, Escape or Back closes it and focus
// returns to the card. The sheet is portalled into the page-system root so its
// own styles apply.

const COLLAPSED_COUNT = 12
const KINDS = ['All', 'Events', 'Experiences', 'Places'] as const
type Kind = (typeof KINDS)[number]

interface CityWeekendProps {
  readonly cityName: string
  readonly citySlug: string
  readonly countryCode: string
  readonly locale: string
  readonly cityPath: string
  readonly places: readonly CataloguePlace[]
}

export function CityWeekend({ cityName, citySlug, countryCode, locale, cityPath, places }: CityWeekendProps) {
  const [kind, setKind] = useState<Kind>('All')
  const [collapsed, setCollapsed] = useState(true)
  const [detail, setDetail] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [portal, setPortal] = useState<Element | null>(null)
  const openerRef = useRef<HTMLAnchorElement | null>(null)
  const gridRef = useRef<HTMLUListElement>(null)
  const focusAfterExpand = useRef(false)

  const ranks = useMemo(() => categoryRank(places), [places])
  // Every listing on this page today is a place (see the header).
  const visible = useMemo(() => (kind === 'All' || kind === 'Places' ? places : []), [kind, places])
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

  function selectKind(next: string) {
    const value = (KINDS as readonly string[]).includes(next) ? (next as Kind) : 'All'
    setKind(value)
    setCollapsed(true)
    const count = value === 'All' || value === 'Places' ? places.length : 0
    setAnnouncement(value === 'All' ? `Showing all ${count} listings` : `Showing ${count} ${value.toLowerCase()}`)
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
    <section className="sec" id="weekend" aria-labelledby="city-weekend-title">
      <div className="wrap">
        <div className="wk-head">
          <h2 className="h2" id="city-weekend-title">
            This <em>weekend.</em>
          </h2>
          <FilterChips label={`Filter ${cityName} listings`} options={KINDS} value={kind} onChange={selectKind} />
        </div>
        <p className="sr-only" aria-live="polite">{announcement}</p>

        {visible.length ? (
          <>
            <noscript><style>{'.wk-grid[data-collapsed] > li{display:list-item!important}.wk-more{display:none!important}'}</style></noscript>
            <ul ref={gridRef} id="city-weekend-grid" className="wk-grid" data-filter-grid="" data-filter={kind} data-collapsed={collapsed && visible.length > COLLAPSED_COUNT ? 'true' : 'false'}>
              {visible.map((place, index) => {
                const label = rankLabel(place, ranks)
                const rating = ratingLine(place, locale)
                return (
                  <li key={place.placePoolId} data-tags="Places">
                    <a
                      href={place.detailHref}
                      className="wk-card"
                      data-city-place-card=""
                      data-category={place.categorySlug}
                      aria-label={`${place.name}, ${label}${rating ? `, ${rating}` : ''}. View place`}
                      onClick={(event) => openPlace(event, place)}
                    >
                      <div className="ph">
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
                  aria-controls="city-weekend-grid"
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
          <p className="filter-note">
            {kind === 'All' || kind === 'Places'
              ? `Nothing is listed in ${cityName} yet. Check back soon.`
              : `No ${kind.toLowerCase()} are listed in ${cityName} yet. Places are under All.`}
          </p>
        )}
      </div>
      {sheet && portal ? createPortal(sheet, portal) : null}
    </section>
  )
}
