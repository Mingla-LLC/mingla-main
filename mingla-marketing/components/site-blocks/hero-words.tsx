// #4452 §2.2 — the editable hero of /creators and /locals. With no published
// `hero` content it renders the coded words exactly; with one it uses the
// staff words (limits enforced by site_validate_content). "Reset to the
// designed words" deletes the hero key.
import Link from 'next/link'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { PageHero } from '@/components/site/site-page'
import { editorMode, siteContent } from '@/lib/site-pages/content'
import { HeroOutline } from './editor-bridge'
import { destHref } from '@/lib/site-pages/model'

export interface CodedHero {
  h1: string
  em: string
  lead: string
  app: { text: string; location: string }
  call: { text: string; href: string }
}

export async function HeroWords({ page, coded }: { page: 'creators' | 'locals'; coded: CodedHero }) {
  const content = await siteContent()
  const edit = content.pages[page]?.hero ?? null
  const title = edit ? edit.h1 : coded.h1
  const em = edit ? edit.em ?? '' : coded.em
  const lead = edit ? edit.lead ?? coded.lead : coded.lead
  const b0 = edit?.buttons?.[0]
  const b1 = edit?.buttons?.[1]
  const b0Href = b0 && b0.to.kind !== 'app' ? destHref(b0.to, content) : null
  const b1Href = b1 ? destHref(b1.to, content) : null
  const hero = (
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
        {b0Href ? (
          <Link className="btn cta" href={b0Href}>{b0?.text}</Link>
        ) : (
          <ExplorerHandoffButton location={coded.app.location} className="btn cta" withArrow>
            {b0?.text ?? coded.app.text}
          </ExplorerHandoffButton>
        )}
        <Link className="btn soft" href={b1Href ?? coded.call.href}>
          {b1?.text ?? coded.call.text}
        </Link>
      </div>
    </PageHero>
  )
  // #4452 §7.6: the editor's preview outlines the hero so a click opens the hero editor.
  return editorMode()?.pageKey === page ? <HeroOutline page={page}>{hero}</HeroOutline> : hero
}
