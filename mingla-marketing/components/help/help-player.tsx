'use client'

import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'

/**
 * The help-centre player.
 *
 * Bamboo's own iframe would work, but it repaints the page in Bamboo's chrome
 * and gives the video no URL of ours. Bamboo exposes a public HLS ladder per
 * entry, so we play that in a plain <video> and keep the cutout surface.
 *
 * hls.js is loaded lazily, on first play, and ONLY where it is needed: Safari
 * and iOS play `application/vnd.apple.mpegurl` natively, so those browsers
 * never download it. It is ~150KB — this keeps it off the initial bundle for
 * every visitor, and off the wire entirely for roughly half of them.
 */
export function HelpPlayer({
  hlsUrl,
  poster,
  title,
  captionsUrl,
}: {
  hlsUrl: string
  poster: string
  title: string
  captionsUrl?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!started) return
    const video = videoRef.current
    if (!video) return

    // Native HLS — Safari, iOS, some Android. No library needed.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl
      video.play().catch(() => {})
      return
    }

    let destroyed = false
    let hls: { destroy: () => void } | null = null

    import('hls.js')
      .then(({ default: Hls }) => {
        if (destroyed) return
        if (!Hls.isSupported()) {
          setFailed(true)
          return
        }
        const instance = new Hls({ enableWorker: true })
        hls = instance
        instance.on(Hls.Events.ERROR, (_e, data) => {
          // Only a fatal error is worth surfacing; hls.js recovers from most.
          if (data.fatal) setFailed(true)
        })
        instance.loadSource(hlsUrl)
        instance.attachMedia(video)
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {})
        })
      })
      .catch(() => setFailed(true))

    return () => {
      destroyed = true
      hls?.destroy()
    }
  }, [started, hlsUrl])

  if (failed) {
    return (
      <div className="cut-media relative flex aspect-video w-full items-center justify-center bg-black/5 p-8 text-center">
        <p className="text-[0.9375rem] text-[var(--cut-body)]">
          This video would not play in your browser.{' '}
          <a className="underline" href={hlsUrl}>
            Open the stream directly
          </a>
          .
        </p>
      </div>
    )
  }

  return (
    <div className="cut-media relative aspect-video w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        className="h-full w-full"
        poster={poster}
        controls={started}
        playsInline
        preload="none"
        crossOrigin="anonymous"
      >
        {captionsUrl ? (
          <track kind="captions" src={captionsUrl} srcLang="en" label="English" default />
        ) : null}
      </video>

      {/*
        The poster is painted by <video> itself, so this overlay is only the
        affordance. It unmounts on play, which is what defers the whole HLS
        path — nothing at all is fetched until someone actually wants to watch.
      */}
      {!started ? (
        <button
          type="button"
          onClick={() => setStarted(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30"
          aria-label={`Play: ${title}`}
        >
          <span
            className="flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105"
            style={{ background: 'var(--cut-accent-ink)' }}
          >
            <Play className="ml-1 h-8 w-8" fill="currentColor" />
          </span>
        </button>
      ) : null}
    </div>
  )
}
