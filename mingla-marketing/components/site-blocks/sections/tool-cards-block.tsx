// #4636 block `toolCards` — the /tools hub's four tool cards, each with its
// clip and opening its live tool page. Moved as-is (R1) from app/tools/page.tsx.
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { LandingMedia } from '@/components/landing/landing-media'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import type { BlockProps } from './shared'

export interface ToolCardItem {
  tool: '/tools/venues' | '/tools/events' | '/tools/trips' | '/tools/pricing'
  title: string
  body: string
  forWho: string
  cta: string
  media: LandingMediaRef
}

export interface ToolCardsContent {
  items: readonly ToolCardItem[]
}

export function ToolCardsBlock({ content }: BlockProps<ToolCardsContent>) {
  return (
    <section className="pb-100" aria-label="Free tools">
      <div className="wrap">
        <ul className="grid2">
          {content.items.map((tool) => (
            <li key={tool.tool}>
              <Link className="card tool-card reveal" href={tool.tool}>
                <div className="ph">
                  <LandingMedia media={tool.media} />
                </div>
                <div className="body">
                  <h2 className="h3">{tool.title}</h2>
                  <p className="muted">{tool.body}</p>
                  <span className="for">{tool.forWho}</span>
                  <span className="btn ink">
                    {tool.cta} <ArrowRight aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
