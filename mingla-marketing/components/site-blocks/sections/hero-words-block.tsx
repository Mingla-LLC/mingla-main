// #4636 block `heroWords` — the Creators / Locals hero: headline with its
// italic end, lead and two buttons (the app hand-off or a link, then a link).
// Moved as-is (R1) out of components/site-blocks/hero-words.tsx, which still
// applies the #4452 staff words and renders this.
import Link from 'next/link'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { PageHero } from '@/components/site/site-page'
import type { BlockAction, BlockProps } from './shared'

export interface HeroWordsContent {
  title: string
  em?: string
  lead: string
  primary: BlockAction
  secondary: BlockAction
}

export function HeroWordsBlock({ content }: BlockProps<HeroWordsContent>) {
  const { title, em, lead, primary, secondary } = content
  return (
    <PageHero
      title={
        // One text node then the <em>, exactly as the coded hero renders (byte-identical HTML).
        em ? (
          <>
            {`${title} `}
            <em>{em}</em>
          </>
        ) : (
          <>{title}</>
        )
      }
      lead={lead}
    >
      <div className="row">
        {primary.to !== 'app:explorer' ? (
          <Link className="btn cta" href={primary.to}>
            {primary.label}
          </Link>
        ) : (
          <ExplorerHandoffButton location={primary.track ?? 'hero'} className="btn cta" withArrow>
            {primary.label}
          </ExplorerHandoffButton>
        )}
        <Link className="btn soft" href={secondary.to}>
          {secondary.label}
        </Link>
      </div>
    </PageHero>
  )
}
