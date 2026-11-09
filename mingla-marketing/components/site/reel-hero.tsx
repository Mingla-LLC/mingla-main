import type { ReactNode } from 'react'
import { ReelStage, type ReelCard } from './reel-stage'

// #4339 — the "Reelmark" hero shared by Home (paper) and Mingla Host (dark):
// the headline, the subline, ONE call to action inside a dashed ring with ONE
// hand-drawn orange arrow running from the end of the headline down to it, and
// the curved card carousel (reel-stage.tsx). No badge, no notes, no icon strip.
//
// The arrow draws itself in once (stroke-dashoffset, 1.4s); under reduced
// motion it is simply drawn (site.css).

interface ReelHeroProps {
  dark?: boolean
  /** The h1's lines, each a <span> (set by the page). */
  title: ReactNode
  /** Fixed screen-reader text for the h1 when its visible text animates. */
  srTitle?: string
  sub: string
  cta: ReactNode
  cards: readonly ReelCard[]
}

export function ReelHero({ dark = false, title, srTitle, sub, cta, cards }: ReelHeroProps) {
  return (
    <section className={dark ? 'rm dark' : 'rm'} aria-labelledby="rm-title">
      <div className="rm-head wrap">
        <h1 id="rm-title">
          {srTitle ? <span className="sr-only">{srTitle}</span> : null}
          {srTitle ? <span aria-hidden="true" className="rm-lines">{title}</span> : <span className="rm-lines">{title}</span>}
        </h1>
        <p className="sub">{sub}</p>
        <div className="ring">
          {cta}
          <svg className="arr" viewBox="0 0 240 170" aria-hidden="true" focusable="false">
            <path d="M204 4 C 252 70, 190 150, 16 150" />
            <path d="M34 136 L14 150 L34 164" />
          </svg>
        </div>
      </div>
      <ReelStage cards={cards} />
      <div className="rm-foot" />
    </section>
  )
}
