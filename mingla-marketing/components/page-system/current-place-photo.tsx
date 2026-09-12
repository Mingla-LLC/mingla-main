'use client'

import { useEffect, useRef, useState } from 'react'

interface CurrentMedia {
  readonly status: 'current'
  readonly photoUri: string
  readonly googleMapsUri: string
  readonly author: Readonly<{ displayName: string; uri: string }>
}

export function CurrentPlacePhoto({
  googlePlaceId,
  name,
  cityName,
  eager = false,
  className,
}: {
  readonly googlePlaceId: string
  readonly name: string
  readonly cityName: string
  readonly eager?: boolean
  readonly className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const [media, setMedia] = useState<CurrentMedia | null>(null)
  const [requested, setRequested] = useState(eager)

  useEffect(() => {
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
  }, [requested])

  useEffect(() => {
    if (!requested) return
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
  }, [googlePlaceId, requested])

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
      ) : (
        <div className="ps-catalogue-image-fallback" role="img" aria-label={`Photo unavailable for ${name}`}>
          <img src="/brand/mingla-business-logo.svg" alt="" width="64" height="64" />
          <span>{name}</span>
        </div>
      )}
    </div>
  )
}
