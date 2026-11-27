// #4636 blocks `form`, `buttons`, `banner` — the #4452 site blocks placed as
// ordinary page blocks. The markup is the #4452 components (form-block.tsx,
// button-row.tsx, banner.tsx) through spot.tsx's renderBlock, unchanged; this
// only maps registry content to the #4452 block shape.
import type { Block, Dest } from '@/lib/site-pages/model'
import { siteContent } from '@/lib/site-pages/content'
import { renderBlock } from '../spot'
import type { BlockAction, BlockProps } from './shared'

export interface SpotBlockContent {
  formId?: string
  heading?: string
  em?: string
  sub?: string
  items?: readonly { action: BlockAction }[]
  text?: string
  button?: string
  action?: BlockAction
  showUntil?: string
}

/** A registry action as a #4452 destination. */
export function actionDest(action: BlockAction): Dest {
  if (action.to === 'app:explorer' || action.to === 'app:host') return { kind: 'app' }
  if (action.to === '/schedule') return { kind: 'schedule' }
  if (action.to === '/schedule/creators') return { kind: 'schedule_creators' }
  if (action.to === '/schedule/locals') return { kind: 'schedule_locals' }
  return { kind: 'url', href: action.to.startsWith('/') ? `https://usemingla.com${action.to}` : action.to }
}

export async function SpotBlock({ content, blockId, type }: BlockProps<SpotBlockContent> & { type?: 'form' | 'buttons' | 'banner' }) {
  const kind = type ?? (content.formId ? 'form' : content.items ? 'buttons' : 'banner')
  const block: Block =
    kind === 'form'
      ? { id: blockId, type: 'form', spot: blockId, form_id: content.formId, head: content.heading, em: content.em, sub: content.sub }
      : kind === 'buttons'
        ? { id: blockId, type: 'buttons', spot: blockId, buttons: (content.items ?? []).map(({ action }) => ({ text: action.label ?? '', to: actionDest(action) })) }
        : { id: blockId, type: 'banner', spot: blockId, text: content.text, btn: content.button, to: content.action ? actionDest(content.action) : undefined, show_until: content.showUntil ?? null }
  const site = await siteContent()
  if (block.type === 'form' && (!block.form_id || !site.forms[block.form_id])) {
    console.error(`[site-blocks] form: form "${block.form_id ?? ''}" is not live`)
    return null
  }
  return renderBlock(block, site, false)
}
