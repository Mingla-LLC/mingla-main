// #4452 §2.2 — a named spot. One line of markup per spot on a page:
//   <Spot page="creators" id="after-steps" />
// It renders null unless live (or preview) content has a block for it, so a
// page with no blocks is byte-identical to before.
// Invariant I-4452-NO-BLOCKS-NO-CHANGE (declared in its test): with no published content a page's HTML is unchanged (Spot returns null; lib/__tests__/issue-4452-site-blocks.implementor.test.mjs).
import { editorMode, siteContent } from '@/lib/site-pages/content'
import { blockForSpot, destHref } from '@/lib/site-pages/model'
import { HOST_ICP_KEYS, SITE_PAGES } from '@/lib/site-pages/registry'
import { LazyAddHere as AddHere, LazyBannerBlock as BannerBlock, LazyBlockOutline as BlockOutline, LazyButtonRow as ButtonRow, LazyFormBlock as FormBlock } from './lazy'

export async function Spot({ page, id }: { page: string; id: string }) {
  const content = await siteContent()
  const host = HOST_ICP_KEYS.includes(page)
  const block = blockForSpot(content, page, id, host)
  // #4452 §7.6: in the editor's preview every spot is marked: "Add here" when
  // empty, an outline that opens the block when filled. Never on the live site.
  const editor = editorMode()
  if (editor && editor.pageKey === page) {
    const label = SITE_PAGES.find((p) => p.key === page)?.spots?.find((s) => s.key === id)?.label ?? id.replace(/-/g, ' ')
    if (!block) return <AddHere page={page} spot={id} label={label} />
    return <BlockOutline page={page} spot={id} block={block.id} label={label}>{await renderBlock(block, content, host)}</BlockOutline>
  }
  if (!block) return null
  return renderBlock(block, content, host)
}

export async function renderBlock(block: NonNullable<ReturnType<typeof blockForSpot>>, content: Awaited<ReturnType<typeof siteContent>>, host: boolean) {
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
