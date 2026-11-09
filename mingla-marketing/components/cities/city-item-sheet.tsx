'use client'

import type { ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { SheetFrame, StoreButtons } from '@/components/landing/handoff-sheet'
import { appHandoffHrefs, CITY_EXPLORER_ATTRIBUTION, siteTargetHrefs } from '@/lib/app-handoff'
import { listingDayKey, longDayLabel, timeLabel } from '@/lib/links-week'
import { CITY_LISTING_KIND_LABEL as KIND_LABEL, type CityItemTarget as ItemTarget } from '@/lib/city-weekend'

// #4339 round B (speed): the QR code renders only inside a sheet opened by a
// tap, so its library loads then, not with the page (first-load JS).
const QRCode = dynamic(() => import('react-qr-code'), { ssr: false })

// #4339 speed fix — the "This weekend" detail sheet (a listing or a place on a
// computer: photo, pill, QR and both Explorer stores), moved out of
// city-this-weekend.tsx so it loads on the tap that opens it. Every href comes
// from lib/app-handoff.ts → lib/cta-destination.ts.

export function CityItemSheet({ target, cityName, onClose }: { target: ItemTarget; cityName: string; onClose: () => void }) {
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

