'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChefHat,
  Clapperboard,
  Coffee,
  Drama,
  Gamepad2,
  MessagesSquare,
  Palette,
  Trees,
  Utensils,
  Wine,
  type LucideIcon,
} from 'lucide-react'
import type { ExplorerCategorySlug } from '@/content/page-system/shared'
import { CATEGORY_TILE_ICON } from '@/lib/city-place-rank'

interface CurrentMedia {
  readonly status: 'current'
  readonly photoUri: string
  readonly googleMapsUri: string
  readonly author: Readonly<{ displayName: string; uri: string }>
}

const TILE_ICONS: Readonly<Record<string, LucideIcon>> = {
  ChefHat, Clapperboard, Coffee, Drama, Gamepad2, MessagesSquare, Palette, Trees, Utensils, Wine,
}

function CategoryTile({ name, categorySlug }: { readonly name: string; readonly categorySlug: ExplorerCategorySlug }) {
  const Icon = TILE_ICONS[CATEGORY_TILE_ICON[categorySlug]] ?? Trees
  return (
    <div className="city-v2-photo-fallback" data-category={categorySlug} role="img" aria-label={`${name}, no photo available`}>
      <Icon aria-hidden="true" size={40} strokeWidth={1.6} />
    </div>
  )
}

/**
 * A place photo.
 *
 * Two sources:
 *  - `storedPhotoSrc` (#4137, Seth 27 Oct 2026): Mingla's stored place-pool
 *    thumbnail, rendered straight into the server HTML with no fetch and no
 *    credit line. If the image fails to load, the category tile replaces it.
 *  - otherwise the live `/api/city-place-media` answer (internal routes), with
 *    full author and Google Maps attribution.
 *
 * `fallback="category"` swaps today's brand-logo placeholder for a neutral
 * category tile; the default keeps the old markup so internal-route tests stay
 * byte-stable. The tile and the photo share one box, so swapping causes no
 * layout shift.
 */
export function CurrentPlacePhoto({
  googlePlaceId,
  name,
  cityName,
  eager = false,
  className,
  storedPhotoSrc,
  fallback = 'brand',
  categorySlug,
}: {
  readonly googlePlaceId: string
  readonly name: string
  readonly cityName: string
  readonly eager?: boolean
  readonly className?: string
  readonly storedPhotoSrc?: string | null
  readonly fallback?: 'brand' | 'category'
  readonly categorySlug?: ExplorerCategorySlug
}) {
  const root = useRef<HTMLDivElement>(null)
  const storedImage = useRef<HTMLImageElement>(null)
  const [media, setMedia] = useState<CurrentMedia | null>(null)
  const [storedFailed, setStoredFailed] = useState(false)
  const stored = Boolean(storedPhotoSrc)
  const [requested, setRequested] = useState(eager)

  // An image that failed before hydration never reaches React's onError.
  useEffect(() => {
    const image = storedImage.current
    if (image?.complete && image.naturalWidth === 0) setStoredFailed(true)
  }, [storedPhotoSrc])

  useEffect(() => {
    if (stored) return
    if (requested || !root.current || typeof IntersectionObserver === 'undefined') {
      if (!requested) setRequested(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRequested(true)
        observer.disconnect()
      }
    }, { rootMargin: '320px' })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [requested, stored])

  useEffect(() => {
    if (stored || !requested) return
    const controller = new AbortController()
    fetch(`/api/city-place-media?placeId=${encodeURIComponent(googlePlaceId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((value: unknown) => {
        if (!value || typeof value !== 'object') return
        const candidate = value as Partial<CurrentMedia>
        if (candidate.status === 'current' && candidate.photoUri?.startsWith('https://') && candidate.googleMapsUri?.startsWith('https://') && candidate.author?.displayName && candidate.author.uri?.startsWith('https://')) {
          setMedia(candidate as CurrentMedia)
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setMedia(null)
      })
    return () => controller.abort()
  }, [googlePlaceId, requested, stored])

  if (storedPhotoSrc) {
    const showPhoto = !storedFailed
    return (
      <div ref={root} className={className} data-place-media={showPhoto ? 'stored' : 'no-photo'}>
        {showPhoto ? (
          <img
            ref={storedImage}
            src={storedPhotoSrc}
            alt={`${name} in ${cityName}`}
            width="384"
            height="384"
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onError={() => setStoredFailed(true)}
          />
        ) : categorySlug ? <CategoryTile name={name} categorySlug={categorySlug} /> : null}
      </div>
    )
  }

  return (
    <div ref={root} className={className} data-place-media={media ? 'current' : 'no-photo'}>
      {media ? (
        <>
          <img src={media.photoUri} alt={`${name} in ${cityName}`} width="720" height="900" loading={eager ? 'eager' : 'lazy'} />
          <span className="ps-place-photo-attribution">
            Photo by <a href={media.author.uri} target="_blank" rel="noopener noreferrer">{media.author.displayName}</a> on Google
            {' · '}<a href={media.googleMapsUri} target="_blank" rel="noopener noreferrer">Google Maps</a>
          </span>
        </>
      ) : fallback === 'category' && categorySlug ? (
        <CategoryTile name={name} categorySlug={categorySlug} />
      ) : (
        <div className="ps-catalogue-image-fallback" role="img" aria-label={`Photo unavailable for ${name}`}>
          <img src="/brand/mingla-business-logo.svg" alt="" width="64" height="64" />
          <span>{name}</span>
        </div>
      )}
    </div>
  )
}
