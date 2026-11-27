// #4636 block `quickLinks` — Support's quick link cards and the in-app
// deletion note, moved as-is (R1) from app/support/page.tsx.
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import type { BlockAction, BlockProps } from './shared'

export interface QuickLinksContent {
  /** Screen-reader heading. */
  heading: string
  items: readonly { action: BlockAction }[]
  note?: string
}

export function QuickLinksBlock({ content, blockId }: BlockProps<QuickLinksContent>) {
  return (
    <section className="pb-100" aria-labelledby={blockId}>
      <div className="wrap">
        <h2 className="sr-only" id={blockId}>
          {content.heading}
        </h2>
        <ul className="grid4">
          {content.items.map(({ action }) => (
            <li key={action.to}>
              <Link className="card pad quick reveal" href={action.to}>
                <span>{action.label}</span>
                <ArrowRight aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
        {content.note ? <p className="filter-note">{content.note}</p> : null}
      </div>
    </section>
  )
}
