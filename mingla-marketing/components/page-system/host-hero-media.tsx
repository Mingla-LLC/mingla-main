'use client'

import { useEffect, useRef, useState } from 'react'

type MediaState = 'pending' | 'loaded' | 'failed'

const STATUS_COPY: Record<MediaState, string> = {
  pending: 'Loading the Mingla Host preview image.',
  loaded: 'The Mingla Host preview image loaded.',
  failed: 'The image could not load. A branded Mingla Host fallback is shown.',
}

export function HostHeroMedia() {
  const [mediaState, setMediaState] = useState<MediaState>('pending')
  const imageRef = useRef<HTMLImageElement>(null)

  function settleMedia(nextState: Exclude<MediaState, 'pending'>) {
    setMediaState((currentState) => currentState === nextState ? currentState : nextState)
  }

  useEffect(() => {
    const image = imageRef.current
    if (!image?.complete) return
    settleMedia(image.naturalWidth > 0 && image.naturalHeight > 0 ? 'loaded' : 'failed')
  }, [])

  return (
    <figure className="ps-host-hero-figure">
      <div className="ps-host-image-frame" data-media-state={mediaState}>
        <div
          className="ps-host-media-fallback"
          role="img"
          aria-label="Mingla Host event-planning preview"
          aria-hidden={mediaState !== 'failed'}
        >
          <img src="/brand/mingla-business-logo.svg" alt="" width="82" height="82" />
          <div>
            <small>Mingla Host</small>
            <strong>Make the event clear from launch to the door.</strong>
          </div>
          <span aria-hidden="true" className="ps-host-fallback-orbit ps-host-fallback-orbit-a" />
          <span aria-hidden="true" className="ps-host-fallback-orbit ps-host-fallback-orbit-b" />
        </div>
        <img
          ref={imageRef}
          className="ps-host-concept-image"
          src="/marketing/host-icp/events-hall.jpg"
          alt="An event hall prepared for guests"
          width="1600"
          height="1211"
          draggable="false"
          onLoad={() => settleMedia('loaded')}
          onError={() => settleMedia('failed')}
          aria-hidden={mediaState === 'failed'}
        />
        <div className="ps-host-image-overlay" aria-hidden="true">
          <span>page ready</span><span>action checked</span><span>door rehearsed</span>
        </div>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {STATUS_COPY[mediaState]}
        </span>
      </div>
    </figure>
  )
}
