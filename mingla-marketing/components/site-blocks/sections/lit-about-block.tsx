// #4636 block `litAbout` — the host-type pages' cream "about" section over the
// hero by 25px: intro, "Talk to the team", "See what's inside", the wordmark,
// the before / after words and the paragraph that lights word by word on
// scroll (`data-lit`, driven by LandingRoot). Moved as-is (R1) from
// components/landing/icp-landing.tsx.
import Link from 'next/link'
import { Mail, Plus } from 'lucide-react'
import { litWords } from '@/content/host-landing/icps'
import type { BlockAction, BlockProps } from './shared'

export interface LitAboutContent {
  intro: string
  call: BlockAction
  insideLabel: string
  duoA: string
  duoB: string
  big: string
}

/** The features block's anchor (`#features`): "See what's inside" glides there. */
export const FEATURES_ID = 'features'

export function LitAboutBlock({ content: d }: BlockProps<LitAboutContent>) {
  const words = litWords(d.big)
  return (
    <section className="about">
      <div className="wrap">
        <p className="intro">{d.intro}</p>
        <div className="row">
          <Link className="btn ink talk" href={d.call.to} data-icp-event="icp_talk_to_team_clicked">
            <span className="circ" aria-hidden="true">
              <Mail />
            </span>
            {d.call.label}
          </Link>
          <a className="btn soft" href={`#${FEATURES_ID}`} data-see-inside="" data-icp-event="icp_see_inside_clicked">
            <Plus aria-hidden="true" /> {d.insideLabel}
          </a>
        </div>
        <div className="divider" aria-hidden="true">
          <i />
          <b />
          <i />
        </div>
        {/* Every Mingla logo goes Home (Seth, 8 Nov). */}
        <Link className="wm-link" href="/" aria-label="Mingla home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="wm" src="/brand/mingla-wordmark.svg" alt="" width={85} height={30} />
        </Link>
        <div className="duo">
          <span className="a">{d.duoA}</span> / {d.duoB}
        </div>
        <p className="big" data-lit="">
          {words.map((w, i) => (
            <span key={i}>
              <span className={w.em ? 'w em' : 'w'}>{w.word}</span>
              {i < words.length - 1 ? ' ' : null}
            </span>
          ))}
        </p>
      </div>
    </section>
  )
}
