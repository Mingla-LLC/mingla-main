// #4636 block `tiles` — a heading and lead over clip tiles that open pages,
// moved as-is (R1) from Home ("Not a dating app", night) and For hosts
// ("Built for every kind of host", paper, with the Free tools tile).
import { ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import { LandingMedia } from '@/components/landing/landing-media'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import { Em, secClass, type BlockAction, type BlockProps } from './shared'

export interface TileItem {
  media: LandingMediaRef
  title: string
  line: string
  /** A second half of the line, kept as its own text run (the host-type tiles' two lines). */
  lineEnd?: string
  action: BlockAction
  look?: 'plain' | 'tools'
}

export interface TilesContent {
  heading: string
  lead?: string
  items: readonly TileItem[]
}

export function TilesBlock({ content, colour, blockId }: BlockProps<TilesContent>) {
  return (
    <section className={secClass(colour)} aria-labelledby={blockId}>
      <div className="wrap">
        <div className="split reveal">
          <h2 className="h2" id={blockId}>
            <Em text={content.heading} />
          </h2>
          {content.lead ? <p className="lead">{content.lead}</p> : null}
        </div>
        <div className="grid4 mt-56">
          {content.items.map((tile) => (
            <Link className={tile.look === 'tools' ? 'tile tools reveal' : 'tile reveal'} href={tile.action.to} key={`${tile.title}-${tile.action.to}`}>
              <div className="ph scrim">
                <LandingMedia media={tile.media} />
              </div>
              <div className="ov">
                <h3>{tile.title}</h3>
                <p>
                  {tile.line}
                  {tile.lineEnd !== undefined ? ' ' : null}
                  {tile.lineEnd}
                </p>
              </div>
              <span className="go" aria-hidden="true">
                <ArrowUpRight />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
