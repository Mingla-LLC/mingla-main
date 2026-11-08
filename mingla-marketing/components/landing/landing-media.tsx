'use client'
import { useEffect, useRef } from 'react'
import { resolveLandingMedia, type LandingMediaRef } from '@/content/host-landing/icps'

// #4339 §11 — video-first media, fast-load rules:
//   - every clip is muted, inline, looping, with no audio and no controls;
//   - the poster JPG paints first; the server HTML carries NO video source, so
//     nothing downloads until this script decides it may;
//   - under prefers-reduced-motion or Save-Data the poster stays and the clip
//     is never requested;
//   - otherwise a clip loads only when it is on (or 120px from) the screen and
//     pauses when it leaves. The hero asks for `preload=auto` (it is the one
//     clip on first paint); every other clip stays `preload=none` until seen.
// A `p:` reference is a still and renders as a lazy image.

export function prefersStillMedia(): boolean {
  if (typeof window === 'undefined') return true
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return reduced || connection?.saveData === true
}

interface LandingMediaProps {
  media: LandingMediaRef
  /** The hero clip: the only one allowed to preload. */
  hero?: boolean
  /** Slow Ken Burns move for a still hero (design: art spaces). */
  kenBurns?: boolean
}

export function LandingMedia({ media, hero = false, kenBurns = false }: LandingMediaProps) {
  const resolved = resolveLandingMedia(media)
  if (resolved.kind === 'photo') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={resolved.poster}
        alt=""
        className={kenBurns ? 'kb' : undefined}
        loading={hero ? 'eager' : 'lazy'}
        decoding="async"
        {...(hero ? { fetchPriority: 'high' as const } : {})}
      />
    )
  }
  return <LandingClip src={resolved.src ?? ''} poster={resolved.poster} hero={hero} />
}

function LandingClip({ src, poster, hero }: { src: string; poster: string; hero: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video || src === '' || prefersStillMedia()) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          if (!video.getAttribute('src')) {
            video.muted = true
            video.preload = hero ? 'auto' : 'metadata'
            video.src = src
          }
          video.play().catch(() => {
            // Autoplay can be refused (low-power mode, a browser policy). The
            // poster is the designed fallback, so the page stays correct; mark
            // it so a browser check can see why the clip is still.
            video.dataset.autoplay = 'refused'
          })
        } else {
          video.pause()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [src, hero])

  return (
    <video
      ref={ref}
      poster={poster}
      muted
      loop
      playsInline
      preload="none"
      disablePictureInPicture
      aria-hidden="true"
      tabIndex={-1}
      data-landing-clip={src}
    />
  )
}
