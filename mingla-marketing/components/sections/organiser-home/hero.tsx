'use client'
import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useMinglaReducedMotion } from '@/lib/reduced-motion'
import { useActiveInViewport } from '@/lib/use-active-in-viewport'

// #2083 keeps the generated loop decorative and the message in semantic HTML.
// The fixed navigation owns the page's single app/web action.

const EASE = [0.16, 1, 0.3, 1] as const

const HERO_MEDIA = {
  video: '/marketing/host-hero/world-hosts-create-preview.mp4',
  poster: '/marketing/host-hero/world-hosts-create-poster.jpg',
}

export function OrganiserHero() {
  const reduced = useMinglaReducedMotion()
  const { ref: videoRef, active: videoVisible } = useActiveInViewport<HTMLVideoElement>()

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (reduced || !videoVisible) {
      video.pause()
      return
    }
    void video.play().catch(() => {
      // Autoplay can be denied by browser policy; the poster remains the fallback.
    })
  }, [reduced, videoRef, videoVisible])

  return (
    <section
      data-host-hero="world-hosts-create"
      className="relative flex min-h-[100svh] overflow-hidden bg-parchment px-6 pb-24 pt-32 md:px-10 md:pb-32 md:pt-40 [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))] md:[padding-left:max(2.5rem,env(safe-area-inset-left))] md:[padding-right:max(2.5rem,env(safe-area-inset-right))]"
    >
      <video
        ref={videoRef}
        aria-hidden="true"
        tabIndex={-1}
        autoPlay={false}
        muted
        loop
        playsInline
        preload="metadata"
        poster={HERO_MEDIA.poster}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-bottom"
      >
        <source src={HERO_MEDIA.video} type="video/mp4" />
      </video>

      {/* The video carries atmosphere, never contrast responsibility. The fixed
          parchment veil keeps live copy readable through every generated frame. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(250,248,244,0.34) 0%, rgba(250,248,244,0.16) 48%, rgba(250,248,244,0.02) 78%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-b from-transparent to-parchment/70"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl justify-center">
        <div className="flex max-w-4xl flex-col items-center text-center">
          <motion.h1
            initial={reduced ? false : { opacity: 0, y: 12, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.72, delay: reduced ? 0 : 0.1, ease: EASE }}
            className="search-primary-answer max-w-[15ch] font-display text-[clamp(2.75rem,7vw,5.75rem)] leading-[1.02] tracking-[-0.035em] text-ink"
          >
            Your place deserves to be found.
          </motion.h1>

          <motion.p
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: reduced ? 0 : 0.35, ease: EASE }}
            className="search-primary-answer mt-6 max-w-2xl text-base font-semibold leading-relaxed text-ink/68 sm:text-lg md:text-xl"
          >
            Create what makes your place, event, trip or experience worth showing up
            for. Mingla helps the right people discover it, book it and arrive.
          </motion.p>
        </div>
      </div>
    </section>
  )
}
