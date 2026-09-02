import { type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CutReveal } from './motion'
import { CutoutHeroVideo } from './hero-video'
import { ScrollMore } from './hero-graphic'

// ---------------------------------------------------------------
// #2902 — AIgocy's hero, ported faithfully.
//
// The template's composition, which the first pass replaced with a left-aligned
// text column and lost most of the drama:
//
//   .section-hero   padding 16px, min-height 100vh, position relative
//   .hero-image     absolute inset 16px, radius 40, a real PHOTOGRAPH,
//                   background-attachment: fixed  (parallax for free)
//   .content-wrap   CENTRED
//     .sub          a badge pill with a sparkle
//     .title        96/96/-0.03em, gradient fill, TWO lines, the second of
//                   which is a flex row ending in the floating-shapes graphic
//     .text         a centred paragraph
//     .bot-btns     dark pill + light pill
//   .scroll-more    a 320x56 pill pinned bottom-centre, top corners only
//
// The photograph matters: AIgocy's hero is a full-bleed image behind a light
// scrim, not a flat colour. A flat ground is most of why the first pass looked
// bland.
// ---------------------------------------------------------------

interface CutoutHeroProps {
  /** Badge above the headline. Omit to lead straight with the headline. */
  eyebrow?: string
  /** First headline line. */
  line1: ReactNode
  /** Second line. Nothing sits inside it now — the atmosphere is behind. */
  line2: ReactNode
  lede: ReactNode
  /** Exactly ONE action, and it is always the device-aware app CTA. */
  action: ReactNode
  /** Background photograph. Illustrative is fine; it is atmosphere. */
  image: string
  /** Optional video plate layered over the photo. */
  video?: string
  scrollTo?: string
  footnote?: ReactNode
  className?: string
}

export function CutoutHero({
  eyebrow,
  line1,
  line2,
  lede,
  action,
  image,
  video,
  scrollTo,
  footnote,
  className,
}: CutoutHeroProps) {
  return (
    <section
      aria-label="Introduction"
      className={cn(
        'relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-5 pb-[26vh] pt-36 sm:px-8 sm:pt-40',
        className,
      )}
    >
      {/* The photographic plate. */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        {video ? (
          <CutoutHeroVideo src={video} poster={image} />
        ) : (
          <div
            className="absolute inset-0 scale-105 bg-cover bg-center"
            style={{ backgroundImage: `url(${image})` }}
          />
        )}
        {/* Scrim, matched to the live host hero: the photograph is atmosphere
            and never carries contrast, but it is still a photograph. The old
            radial ran to 0.97 and then to solid, which washed the plate out
            entirely and left grey type on near-white. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(250,248,244,0.34) 0%, rgba(250,248,244,0.16) 48%, rgba(250,248,244,0.02) 78%)',
          }}
        />
        {/* and the live hero's hand-off to the page below it */}
        <div
          className="absolute inset-x-0 bottom-0 h-36"
          style={{
            background: 'linear-gradient(180deg, rgba(247,244,239,0) 0%, rgba(247,244,239,0.7) 100%)',
          }}
        />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center text-center">
        {eyebrow ? (
        <CutReveal variant="rise">
          <span className="cut-btn-light inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[0.75rem] font-bold uppercase tracking-[0.14em] text-[var(--cut-accent-ink)]">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M11.4 0.67c.33-.9 1.6-.9 1.92 0l1.46 3.94c.1.28.33.5.61.61l3.94 1.46c.9.33.9 1.6 0 1.92l-3.94 1.46c-.28.1-.5.33-.61.61l-1.46 3.94c-.33.9-1.6.9-1.92 0l-1.46-3.94a1.06 1.06 0 0 0-.61-.61L5.4 8.6c-.9-.33-.9-1.6 0-1.92l3.94-1.46c.28-.1.5-.33.61-.61L11.4.67Z"
                fill="currentColor"
              />
              <path
                d="M3.53 12.1c.22-.6 1.06-.6 1.29 0l.72 1.96c.07.18.22.33.4.4l1.96.72c.6.22.6 1.06 0 1.29l-1.96.72c-.18.07-.33.22-.4.4l-.72 1.96c-.22.6-1.06.6-1.29 0l-.72-1.96a.66.66 0 0 0-.4-.4l-1.96-.72c-.6-.22-.6-1.06 0-1.29l1.96-.72c.18-.07.33-.22.4-.4l.72-1.96Z"
                fill="currentColor"
              />
            </svg>
            {eyebrow}
          </span>
        </CutReveal>
        ) : null}

        <CutReveal variant="headline" delay={0.08}>
          <h1 className={cn('cut-display font-display', eyebrow && 'mt-7')}>
            <span className="cut-gradient-text block">{line1}</span>
            <span className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:mt-4 sm:flex-nowrap">
              {line2}
            </span>
          </h1>
        </CutReveal>

        <CutReveal delay={0.2}>
          <p className="mt-8 max-w-2xl text-[1.0625rem] font-semibold leading-relaxed text-[var(--cut-ink)]/75 sm:text-lg">
            {lede}
          </p>
        </CutReveal>

        <CutReveal delay={0.3}>
          <div className="mt-10 flex justify-center">{action}</div>
        </CutReveal>

        {footnote ? (
          <CutReveal delay={0.4}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-[0.8125rem] text-[var(--cut-muted)]">
              {footnote}
            </div>
          </CutReveal>
        ) : null}
      </div>

      {scrollTo ? <ScrollMore href={scrollTo} /> : null}
    </section>
  )
}
