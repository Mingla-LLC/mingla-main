// #4636 block `toolkit` — For hosts' numbered rows ("Run it all from one
// place."), moved as-is (R1). A row that opens a page on this site says
// "Explore" (decoration); a row that goes to Mingla Host (the hand-off) says
// so in its pill, and the pill is part of its accessible name (#4339, Seth).
import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import { Em, secClass, type BlockAction, type BlockProps } from './shared'

export interface ToolkitItem {
  title: string
  line: string
  action: BlockAction
}

export interface ToolkitContent {
  heading: string
  items: readonly ToolkitItem[]
}

function ToolkitRow({ index, title, line, toHost = false }: { index: number; title: string; line: string; toHost?: boolean }) {
  return (
    <>
      <span className="n" aria-hidden="true">
        0{index + 1}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{line}</p>
      </div>
      {toHost ? (
        <span className="btn soft go to-host">
          Use Mingla Host <ArrowRight aria-hidden="true" />
        </span>
      ) : (
        <span className="btn soft go" aria-hidden="true">
          Explore <ArrowRight />
        </span>
      )}
    </>
  )
}

export function ToolkitBlock({ content, colour, blockId }: BlockProps<ToolkitContent>) {
  return (
    <section className={secClass(colour)} aria-labelledby={blockId}>
      <div className="wrap">
        <h2 className="h2 reveal" id={blockId}>
          <Em text={content.heading} />
        </h2>
        <ul className="list">
          {content.items.map((t, i) => (
            <li key={t.title} className="reveal">
              {t.action.to.startsWith('/') ? (
                <Link className="list-item" href={t.action.to}>
                  <ToolkitRow index={i} title={t.title} line={t.line} />
                </Link>
              ) : (
                <HostHandoffButton location={t.action.track ?? 'toolkit'} className="list-item">
                  <ToolkitRow index={i} title={t.title} line={t.line} toHost />
                </HostHandoffButton>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
