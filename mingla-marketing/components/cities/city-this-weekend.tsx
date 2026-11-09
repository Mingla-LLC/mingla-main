'use client'

import { orphanTile } from '@/components/site/orphan-tile'
import { useCallback, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import { SheetFrame, StoreButtons } from '@/components/landing/handoff-sheet'
import { FilterChips } from '@/components/site/filter-row'
import { detectClientPlatform } from '@/lib/device-platform'
import { appHandoffHrefs, CITY_EXPLORER_ATTRIBUTION, resolveSiteTargetHandoff, siteTargetHrefs } from '@/lib/app-handoff'
import type { LinksTarget } from '@/lib/links-handoff'
import { listingDayKey, listingWhen, longDayLabel, timeLabel, type LinksListing, type LinksPin, type LinksPlace } from '@/lib/links-week'
import { listingChip, type CityWeekendModel } from '@/lib/city-weekend'

// #4339 round B (speed): the QR code renders only inside a sheet opened by a
// tap, so its library loads then, not with the page (first-load JS).
const QRCode = dynamic(() => import('react-qr-code'), { ssr: false })

// #4339 phase 4a (§4) — "This weekend" on the city page, from live data.
//
// The model (lib/city-weekend.ts) is built on the server from #4318's readers
// (links_page_week, links_page_strips, links_page_places; 5-minute cache,
// `links` tag). This component only draws it:
//
//   1. every published admin strip first, in admin order, in the design's
//      .astrip style (dot, "FROM MINGLA · FRI 20", title, arrow). It opens per
//      its `opens`: a web address or a blog post as a link, the Explorer or Host
//      app through the hand-off seam;
//   2. the city's local Friday–Sunday listings, or this week's weekday plans
//      when the weekend is empty;
//   3. a quiet week: "A quiet week in <City>." with up to 3 real places, then
//      "Plans in <nearest live city> →" and "Host something in <City> →";
//   4. otherwise "Nothing is listed this week yet. Check back soon."
//
// The Events / Experiences / Places chips filter by kind (trips sit under
// Experiences). A listing or place on a phone goes straight to the Explorer
// OneLink (deep-linked to the listing); on a computer an event opens its public
// page on host web and anything else opens the detail sheet with the QR and both
// stores (lib/app-handoff.ts → lib/cta-destination.ts; no URL lives here).

const KINDS = ['All', 'Events', 'Experiences', 'Places'] as const
type Kind = (typeof KINDS)[number]
const KIND_LABEL: Record<LinksListing['kind'], string> = { event: 'Event', trip: 'Trip', experience: 'Experience' }

interface CityThisWeekendProps {
  readonly cityName: string
  readonly citySlug: string
  readonly countryCode: string
  readonly model: CityWeekendModel
}

function StripLink({ pin, when }: { pin: LinksPin; when: string }) {
  const body = (
    <>
      <span className="dot" aria-hidden="true" />
      <span className="txt">
        <span className="tag">{when}</span>
        <b>{pin.title}</b>
      </span>
      <ArrowRight aria-hidden="true" className="ic" />
    </>
  )
  switch (pin.opens) {
    case 'explorer':
      return (
        <ExplorerHandoffButton location="city_strip" className="astrip">
          {body}
        </ExplorerHandoffButton>
      )
    case 'host':
      return (
        <HostHandoffButton location="city_strip" className="astrip">
          {body}
        </HostHandoffButton>
      )
    case 'web': {
      const { computerHref } = siteTargetHrefs({ type: 'pin', pin })
      return (
        <a className="astrip" href={computerHref} target="_blank" rel="noopener">
          {body}
        </a>
      )
    }
    case 'blog': {
      const { computerHref } = siteTargetHrefs({ type: 'pin', pin })
      return (
        <a className="astrip" href={computerHref}>
          {body}
        </a>
      )
    }
    default: {
      const never: never = pin.opens
      return never
    }
  }
}

type ItemTarget = Extract<LinksTarget, { type: 'listing' } | { type: 'place' }>

/**
 * #4339 round B — an event cover on a "This weekend" card: fixed width and
 * height (no shift), the event title as its alt text, and Mingla's own
 * `event_covers` bucket through next/image (optimised on Vercel; never
 * Supabase's billed /render/image, hold #1643). A cover hosted anywhere else
 * keeps a plain lazy <img> with the same size and alt.
 */
const EVENT_COVERS = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/event_covers\//
export const EVENT_COVER_SIZE = { width: 640, height: 400 } as const

export function EventCover({ src, title }: { src: string; title: string }) {
  if (EVENT_COVERS.test(src)) {
    return <Image src={src} alt={title} {...EVENT_COVER_SIZE} sizes="(min-width: 1024px) 25vw, 50vw" loading="lazy" />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={title} {...EVENT_COVER_SIZE} loading="lazy" decoding="async" />
}

function ItemSheet({ target, cityName, onClose }: { target: ItemTarget; cityName: string; onClose: () => void }) {
  const hrefs = siteTargetHrefs(target)
  const stores = appHandoffHrefs('explorer', CITY_EXPLORER_ATTRIBUTION).stores
  const titleId = 'city-item-sheet-title'
  let photo: string | null
  let title: string
  let pill: string
  let meta: ReactNode = null
  let lead: string
  if (target.type === 'listing') {
    const l = target.listing
    photo = l.cover
    title = l.title
    pill = `${KIND_LABEL[l.kind]} · ${cityName}`
    meta = (
      <ul className="sheet-meta">
        <li>{longDayLabel(listingDayKey(l))}</li>
        <li>{timeLabel(l.startsAt, l.tz)}</li>
        {l.place ? <li>{l.place}</li> : null}
      </ul>
    )
    lead = `Scan to land on this ${KIND_LABEL[l.kind].toLowerCase()} in the Mingla app.`
  } else {
    const p = target.place
    photo = p.photo
    title = p.name
    pill = `${p.category ?? 'Place'} · ${cityName}`
    meta = p.area ? (
      <ul className="sheet-meta">
        <li>{p.area}</li>
      </ul>
    ) : null
    lead = 'Scan to get the Mingla app and explore places like this one.'
  }
  return (
    <SheetFrame kind="item" labelledBy={titleId} onClose={onClose}>
      {photo ? (
        <div className="gs-ph">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" decoding="async" />
        </div>
      ) : null}
      <span className="sheet-pill">{pill}</span>
      <h3 id={titleId}>{title}</h3>
      {meta}
      <p>{lead}</p>
      <div className="gs-row">
        <div className="qr">
          <QRCode value={hrefs.phoneHref} size={112} title={`QR code that opens ${title} in the Mingla app`} />
        </div>
        <StoreButtons stores={stores} />
      </div>
    </SheetFrame>
  )
}

export function CityThisWeekend({ cityName, citySlug, countryCode, model }: CityThisWeekendProps) {
  const [kind, setKind] = useState<Kind>('All')
  const [announcement, setAnnouncement] = useState('')
  const [sheet, setSheet] = useState<ItemTarget | null>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const listings = model.mode === 'weekend' || model.mode === 'weekday' ? model.listings : []
  const places = model.mode === 'quiet' ? model.places : []
  const shownListings = useMemo(
    () => (kind === 'All' ? listings : kind === 'Places' ? [] : listings.filter((l) => listingChip(l) === kind)),
    [kind, listings],
  )
  const shownPlaces = kind === 'All' || kind === 'Places' ? places : []

  function selectKind(next: string) {
    const value = (KINDS as readonly string[]).includes(next) ? (next as Kind) : 'All'
    setKind(value)
    const count =
      value === 'All'
        ? listings.length + places.length
        : value === 'Places'
          ? places.length
          : listings.filter((l) => listingChip(l) === value).length
    setAnnouncement(`Showing ${count} ${value === 'All' ? 'listings' : value.toLowerCase()}`)
  }

  const closeSheet = useCallback(() => {
    setSheet(null)
    const opener = openerRef.current
    window.requestAnimationFrame(() => opener?.focus({ preventScroll: true }))
  }, [])

  function open(target: ItemTarget, event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const handoff = resolveSiteTargetHandoff(target, detectClientPlatform())
    if (target.type === 'listing') {
      captureMarketing('city_hub_host_action', {
        city_slug: citySlug,
        country_code: countryCode,
        page_family: 'city_hub',
        destination_type: target.listing.kind,
      })
    } else {
      captureMarketing('city_hub_inventory_action', {
        city_slug: citySlug,
        country_code: countryCode,
        page_family: 'city_hub',
        destination_type: 'place',
      })
    }
    if (handoff.action === 'sheet') {
      event.preventDefault()
      openerRef.current = event.currentTarget
      setSheet(target)
      return
    }
    // A phone, or an event on a computer: the anchor navigates; carry the device href now.
    event.currentTarget.setAttribute('href', handoff.href)
    if (handoff.newTab) {
      event.currentTarget.setAttribute('target', '_blank')
      event.currentTarget.setAttribute('rel', 'noopener')
    } else {
      event.currentTarget.removeAttribute('target')
    }
  }

  const empty = (what: string) => <p className="filter-note">{`No ${what} listed in ${cityName} this week.`}</p>

  let body: ReactNode
  if (model.mode === 'weekend' || model.mode === 'weekday') {
    body = (
      <>
        {model.mode === 'weekday' ? (
          <p className="wk-note" data-weekend-mode="weekday">
            Nothing is on this weekend yet. Here’s what’s on in {cityName} this week.
          </p>
        ) : null}
        {shownListings.length ? (
          <ul className="wk-grid" data-weekend-listings="" data-filter={kind}>
            {shownListings.map((l, index) => {
              const hrefs = siteTargetHrefs({ type: 'listing', listing: l })
              const when = listingWhen(l, model.today)
              return (
                <li key={l.id} data-kind={listingChip(l)} data-orphan={orphanTile(index, shownListings.length) ? '' : undefined}>
                  <a
                    className="wk-card"
                    href={hrefs.computerHref}
                    data-cta-phone-href={hrefs.phoneHref}
                    data-weekend-listing={l.kind}
                    onClick={(event) => open({ type: 'listing', listing: l }, event)}
                  >
                    <div className={l.cover ? 'ph' : 'ph ph-empty'}>
                      {l.cover ? (
                        <EventCover src={l.cover} title={l.title} />
                      ) : (
                        <span aria-hidden="true">{KIND_LABEL[l.kind]}</span>
                      )}
                    </div>
                    <span className="kind">{when.tonight ? `${KIND_LABEL[l.kind]} · Tonight` : when.text}</span>
                    <h3>{l.title}</h3>
                    <p>{[timeLabel(l.startsAt, l.tz), l.place].filter(Boolean).join(' · ')}</p>
                  </a>
                </li>
              )
            })}
          </ul>
        ) : kind === 'Places' ? (
          <p className="filter-note">
            Places in {cityName} are listed <a href="#places">below</a>.
          </p>
        ) : (
          empty(kind === 'Events' ? 'events are' : 'experiences are')
        )}
      </>
    )
  } else if (model.mode === 'quiet') {
    body = (
      <div data-weekend-mode="quiet">
        <h3 className="quiet-h">
          A quiet week in <em>{cityName}.</em>
        </h3>
        {shownPlaces.length ? (
          <ul className="grid3 quiet-places" data-weekend-places="">
            {shownPlaces.map((p: LinksPlace) => {
              const hrefs = siteTargetHrefs({ type: 'place', place: p })
              return (
                <li key={p.id}>
                  <a
                    className="quiet-place"
                    href={hrefs.computerHref}
                    data-cta-phone-href={hrefs.phoneHref}
                    data-weekend-place=""
                    onClick={(event) => open({ type: 'place', place: p }, event)}
                  >
                    <div className="ph">
                      {p.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.photo} alt="" loading="lazy" decoding="async" />
                      ) : null}
                    </div>
                    <h4>{p.name}</h4>
                    <p className="muted">{[p.category, p.area].filter(Boolean).join(' · ')}</p>
                  </a>
                </li>
              )
            })}
          </ul>
        ) : places.length ? (
          empty(kind === 'Events' ? 'events are' : 'experiences are')
        ) : null}
        <div className="row quiet-row">
          {model.plansIn ? (
            <a className="btn soft" href={`/cities/${model.plansIn.slug}`} data-plans-in={model.plansIn.slug}>
              Plans in {model.plansIn.name} <ArrowRight aria-hidden="true" />
            </a>
          ) : null}
          <HostHandoffButton location="city_quiet" className="btn soft">
            Host something in {model.hostCity} <ArrowRight aria-hidden="true" />
          </HostHandoffButton>
        </div>
      </div>
    )
  } else {
    body = (
      <div data-weekend-mode="fallback">
        <p className="filter-note">{model.text}</p>
        <div className="row quiet-row">
          <HostHandoffButton location="city_quiet" className="btn soft">
            Host something in {model.hostCity} <ArrowRight aria-hidden="true" />
          </HostHandoffButton>
        </div>
      </div>
    )
  }

  return (
    <section className="sec" id="weekend" aria-labelledby="city-weekend-title" data-weekend={model.mode}>
      <div className="wrap">
        <div className="wk-head">
          <h2 className="h2" id="city-weekend-title">
            Things to do in {cityName} <em>this weekend.</em>
          </h2>
          <FilterChips label={`Filter ${cityName} listings`} options={KINDS} value={kind} onChange={selectKind} />
        </div>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {model.strips.length ? (
          <ul className="astrips" data-weekend-strips="">
            {model.strips.map(({ pin, when }) => (
              <li key={pin.id}>
                <StripLink pin={pin} when={when} />
              </li>
            ))}
          </ul>
        ) : null}
        {body}
      </div>
      {sheet ? <ItemSheet target={sheet} cityName={cityName} onClose={closeSheet} /> : null}
    </section>
  )
}
