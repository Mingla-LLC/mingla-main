// #4636 block `vcards` — clip cards with the wordmark over the ink wash,
// moved as-is (R1). Variant = the page it came from:
//   about  About's two app cards (cream, each a link or the Explorer hand-off);
//   ari    For hosts' Ari cards (night, heading + lead, numbered pills).
import { LandingMedia } from '@/components/landing/landing-media'
import { Wordmark } from '@/components/site/wordmark'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import Link from 'next/link'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import { Em, secClass, type BlockAction, type BlockProps } from './shared'

export interface VCardItem {
  media: LandingMediaRef
  wordmark?: string
  title: string
  line: string
  action?: BlockAction
}

export interface VCardsContent {
  variant: 'about' | 'ari'
  heading?: string
  lead?: string
  items: readonly VCardItem[]
}

function AboutCard({ card }: { card: VCardItem }) {
  // The two cards keep their own markup (the wordmark inside the card element).
  if (card.action?.to === 'app:explorer') {
    return (
      <ExplorerHandoffButton location={card.action.track ?? 'about_explorer'} className="vcard text-card reveal">
        <LandingMedia media={card.media} />
        <span className="vc-top">
          <Wordmark height={26} title={card.wordmark ?? null} />
        </span>
        <span className="h2">
          <Em text={card.title} />
        </span>
        <span className="card-line">{card.line}</span>
      </ExplorerHandoffButton>
    )
  }
  return (
    <Link className="vcard text-card reveal" href={card.action?.to ?? '/'}>
      <LandingMedia media={card.media} />
      <span className="vc-top">
        <Wordmark height={26} title={card.wordmark ?? null} />
      </span>
      <span className="h2">
        <Em text={card.title} />
      </span>
      <span className="card-line">{card.line}</span>
    </Link>
  )
}

export function VCardsBlock({ content, colour, blockId }: BlockProps<VCardsContent>) {
  if (content.variant === 'about') {
    return (
      <section className={secClass(colour, 'cream')} aria-label="Mingla and Mingla Host">
        <div className="wrap grid2">
          {content.items.map((card) => (
            <AboutCard card={card} key={card.title} />
          ))}
        </div>
      </section>
    )
  }
  return (
    <section className={secClass(colour, 'night')} aria-labelledby={blockId}>
      <div className="wrap">
        <div className="split reveal">
          <h2 className="h2" id={blockId}>
            <Em text={content.heading ?? ''} />
          </h2>
          <p className="lead">{content.lead}</p>
        </div>
        <div className="grid4 mt-56">
          {content.items.map((c, i) => (
            <article className="vcard ari-card reveal" key={c.title}>
              <LandingMedia media={c.media} />
              <div className="vc-top">
                <Wordmark height={18} title={null} />
                <span className="pill glass">0{i + 1}</span>
              </div>
              <h3>{c.title}</h3>
              <p>{c.line}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
