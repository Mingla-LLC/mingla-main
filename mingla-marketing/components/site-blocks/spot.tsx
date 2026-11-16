// #4452 §2.2 — a named spot. One line of markup per spot on a page:
//   <Spot page="creators" id="after-steps" />
// It renders null unless live (or preview) content has a block for it, so a
// page with no blocks is byte-identical to before.
// MINGLA-INVARIANT: I-4452-NO-BLOCKS-NO-CHANGE | issue #4452 | with no published content a page's HTML is unchanged (Spot returns null; lib/__tests__/issue-4452-site-blocks.implementor.test.mjs).
import { siteContent } from '@/lib/site-pages/content'
import { blockForSpot, destHref } from '@/lib/site-pages/model'
import { HOST_ICP_KEYS } from '@/lib/site-pages/registry'
import { BannerBlock } from './banner'
import { ButtonRow } from './button-row'
import { FormBlock } from './form-block'

export async function Spot({ page, id }: { page: string; id: string }) {
  const content = await siteContent()
  const host = HOST_ICP_KEYS.includes(page)
  const block = blockForSpot(content, page, id, host)
  if (!block) return null
  if (block.type === 'form' && block.form_id) {
    const form = content.forms[block.form_id]
    return <FormBlock form={form} block={block} pagePath={null} />
  }
  if (block.type === 'buttons') {
    const buttons: Array<{ text: string; href: string; kind: string }> = []
    for (const b of block.buttons ?? []) {
      const href = destHref(b.to, content, host)
      if (href) buttons.push({ text: b.text, href, kind: b.to?.kind ?? 'url' })
    }
    return buttons.length ? <ButtonRow buttons={buttons} /> : null
  }
  if (block.type === 'banner') {
    const href = destHref(block.to, content, host)
    return href ? <BannerBlock text={block.text ?? ''} btn={block.btn ?? ''} href={href} showUntil={block.show_until ?? null} kind={block.to?.kind ?? 'url'} /> : null
  }
  return null
}
