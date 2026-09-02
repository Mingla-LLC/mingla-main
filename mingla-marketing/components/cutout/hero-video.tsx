'use client'

// ---------------------------------------------------------------
// #2902 — the hero's moving plate.
//
// This exists because the declarative `<video autoPlay muted loop playsInline>`
// in the hero did NOT reliably start. When autoplay is denied the browser falls
// back to the poster and paints a play affordance over it -- which is both the
// play button on the Host hero and the "colour offset" on reload, since the
// poster is a single still and the video's own frames are graded differently.
//
// So it follows the shipped pattern from components/sections/organiser-home/
// hero.tsx rather than inventing a second one: autoPlay is OFF, the effect
// calls play() and swallows the rejection, the element is aria-hidden and
// unfocusable so it is never a control, and it pauses off-screen instead of
// decoding behind the rest of the page.
//
// `loop` is declared AND re-asserted on the element, because a paused-then-
// resumed video that lost its loop flag stops at the end of one pass, which is
// the other half of "it should loop indefinitely".
// ---------------------------------------------------------------

import { useEffect } from 'react'

import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'

export function CutoutHeroVideo({ src, poster }: { src: string; poster?: string }) {
  const reduced = useMinglaReducedMotion()
  const { ref: videoRef, active: visible } = useActiveInViewport<HTMLVideoElement>()

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.loop = true
    if (reduced || !visible) {
      video.pause()
      return
    }
    void video.play().catch(() => {
      // Autoplay can be denied by browser policy; the poster stays as fallback.
    })
  }, [reduced, videoRef, visible])

  return (
    <video
      ref={videoRef}
      aria-hidden="true"
      tabIndex={-1}
      autoPlay={false}
      muted
      loop
      playsInline
      preload="metadata"
      poster={poster}
      className="absolute inset-0 h-full w-full scale-105 object-cover"
    >
      <source src={src} type="video/mp4" />
    </video>
  )
}
