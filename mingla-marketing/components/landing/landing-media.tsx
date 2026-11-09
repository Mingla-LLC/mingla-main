'use client'
import { useEffect, useRef } from 'react'
import { preload } from 'react-dom'
import { resolveLandingMedia, type LandingMediaRef } from '@/lib/landing-media-ref'
import { afterFirstPaint, afterLoadAndIdle, clipEnvironment, clipSourceFor, webpPoster } from '@/lib/clip-sources'

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
//
// #4339 round B (speed): the poster is a small WebP (the page's LCP image;
// the hero's is preloaded at high priority). The hero clip starts after first
// paint and load; every other clip waits for load and an idle moment before
// it may start on screen. Phones get the phone-size copy, and browsers that
// play AV1 get the WebM (lib/clip-sources.ts).

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
  /**
   * #4339 round B: this clip's poster is the page's LCP image although it is
   * not the hero (the first tile of a grid page): preload it at high priority.
   */
  priority?: boolean
  /**
   * #4339 round B: a clip far below the first screen: its poster is requested
   * only when it comes near the screen, so it never competes with the LCP.
   */
  lazyPoster?: boolean
}

export function LandingMedia({ media, hero = false, kenBurns = false, priority = false, lazyPoster = false }: LandingMediaProps) {
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
  const poster = webpPoster(resolved.poster)
  // The hero poster is the LCP image: fetch it first.
  if (hero || priority) preload(poster, { as: 'image', fetchPriority: 'high' })
  return <LandingClip src={resolved.src ?? ''} poster={poster} hero={hero} lazyPoster={lazyPoster && !hero && !priority} />
}

function LandingClip({ src, poster, hero, lazyPoster }: { src: string; poster: string; hero: boolean; lazyPoster: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)

  // A lazy poster is set when the clip comes within 600px of the screen.
  useEffect(() => {
    const video = ref.current
    if (!video || !lazyPoster) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        video.poster = poster
        observer.disconnect()
      },
      { rootMargin: '600px' },
    )
    observer.observe(video)
    return () => observer.disconnect()
  }, [poster, lazyPoster])

  useEffect(() => {
    const video = ref.current
    if (!video || src === '' || prefersStillMedia()) return
    let cancelled = false
    let observer: IntersectionObserver | null = null
    const watch = () => {
      if (cancelled) return
      observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          if (!video.getAttribute('src')) {
            video.muted = true
            video.preload = hero ? 'auto' : 'metadata'
            video.src = clipSourceFor(src, clipEnvironment())
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
    }
    void (hero ? afterFirstPaint() : afterLoadAndIdle()).then(watch)
    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [src, hero])

  return (
    <video
      ref={ref}
      poster={lazyPoster ? undefined : poster}
      data-poster={lazyPoster ? poster : undefined}
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
