// #4452 §2.2 — the editable hero of /creators and /locals. With no published
// `hero` content it renders the coded words exactly; with one it uses the
// staff words (limits enforced by site_validate_content). "Reset to the
// designed words" deletes the hero key.
// #4636: the markup is the registry block `heroWords`
// (components/site-blocks/sections/hero-words-block.tsx); this file picks the
// words (coded or #4452 staff words) and the outline in the editor's preview.
import { HeroWordsBlock } from '@/components/site-blocks/sections/hero-words-block'
import { editorMode, siteContent } from '@/lib/site-pages/content'
import { LazyHeroOutline as HeroOutline } from './lazy'
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
    <HeroWordsBlock
      blockId={`${page}-hero`}
      content={{
        title,
        em,
        lead,
        primary: b0Href ? { label: b0?.text, to: b0Href } : { label: b0?.text ?? coded.app.text, to: 'app:explorer', track: coded.app.location },
        secondary: { label: b1?.text ?? coded.call.text, to: b1Href ?? coded.call.href },
      }}
    />
  )
  // #4452 §7.6: the editor's preview outlines the hero so a click opens the hero editor.
  return editorMode()?.pageKey === page ? <HeroOutline page={page}>{hero}</HeroOutline> : hero
}
