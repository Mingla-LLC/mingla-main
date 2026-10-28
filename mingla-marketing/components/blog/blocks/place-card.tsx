import { MapPin } from 'lucide-react'
import { DeviceCta } from '@/components/cutout/device-cta'
import { CurrentPlacePhoto } from '@/components/page-system/current-place-photo'
import { storedPlaceThumbSrc, storedThumbFromPhotoUrl } from '@/lib/city-place-photo'
import { ratingLine } from '@/lib/city-place-rank'
import type { BlogPlaceFacts } from '@/lib/blog/data'

// #4137 — a live place card.
//
// PHOTO RULE (Seth, 27 Oct 2026, overriding the spec's live-Google plan): the
// card shows the place's STORED place-pool thumbnail (`<placeId>/<n>_thumb.jpg`
// from the public object endpoint) exactly as city pages do. No live Google
// fetch, no credit or "Google Maps" line, never /render/image (hold #1643) and
// never next/image. If the thumbnail fails, a map-pin tile shows instead.
// The rating line is the city pages' own ("4.7 · 4,940 Google reviews").
// A closed, inactive or missing place renders nothing (no broken card).

export function placeThumbSrc(place: BlogPlaceFacts): string | null {
  return storedThumbFromPhotoUrl(place.stored_photo_url) ?? (place.google_place_id ? storedPlaceThumbSrc(place.google_place_id) : null)
}

export function PlacePhoto({ place }: { readonly place: BlogPlaceFacts }) {
  const src = placeThumbSrc(place)
  return (
    <div className="blog-embed-media">
      <MapPin aria-hidden="true" size={32} strokeWidth={1.6} />
      {src && place.google_place_id ? (
        <CurrentPlacePhoto googlePlaceId={place.google_place_id} name={place.name} cityName={place.city ?? ''} storedPhotoSrc={src} />
      ) : null}
    </div>
  )
}

function isGoogleMapsUri(value: string | null): value is string {
  return typeof value === 'string' && /^https:\/\/(maps\.google\.com|www\.google\.com\/maps)(\/|\?|$)/.test(value)
}

export function placeMetaLine(place: BlogPlaceFacts): string {
  const rating = ratingLine({ rating: place.rating, reviewCount: place.review_count }, 'en-US')
  return [place.primary_type_display_name, rating].filter(Boolean).join(' · ')
}

export function PlaceCard({ place, style, note }: {
  readonly place: BlogPlaceFacts | undefined
  readonly style: 'card' | 'compact'
  readonly note?: string
}) {
  if (!place || !place.open) return null
  const meta = placeMetaLine(place)
  return (
    <div className={style === 'compact' ? 'blog-embed blog-embed-compact' : 'blog-embed'} data-blog-block="place">
      <PlacePhoto place={place} />
      <div>
        {place.city ? <div className="blog-eyebrow">Place · {place.city.toUpperCase()}</div> : <div className="blog-eyebrow">Place</div>}
        <h3>{place.name}</h3>
        {meta ? <p className="blog-embed-sub">{meta}</p> : null}
        {note ? <p className="blog-embed-note">{note}</p> : null}
        {style === 'card' ? (
          <div className="blog-actions">
            <DeviceCta surface="explorer" location="blog_place_card" label="Open in Mingla" variant="ink" size="md" />
            {isGoogleMapsUri(place.google_maps_uri) ? (
              <a href={place.google_maps_uri} target="_blank" rel="noopener noreferrer" className="cut-btn cut-btn-light h-[2.625rem] px-5 text-[0.9375rem] focus-ring">
                Directions
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
