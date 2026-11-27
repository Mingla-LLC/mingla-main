// #4636 — the pure half of the block renderer: which blocks of a page render,
// in which frames, and what gets reported. No React, no I/O (unit tested).
//
//   - a block the registry rejects (unknown type, newer version, bad content,
//     a colour the section has no style for, a missing media reference) is
//     skipped and reported; the rest of the page still renders;
//   - a block over its per-page limit is skipped and reported;
//   - a hidden block is skipped silently;
//   - consecutive `programme` blocks share one frame;
//   - the page needs the city wrapper when any rendered block does.
import { blockDef, blockFrame, validateBlock, validatePage, type PageBlock } from './registry'

export type BlockReporter = (message: string) => void

export interface PlannedBlock {
  block: PageBlock
  /** Position in the stored list (stable ids, error messages). */
  index: number
}

export interface BlockPlan {
  groups: { frame: 'own' | 'programme'; items: PlannedBlock[] }[]
  city: boolean
  skipped: number
}

export function planBlocks(blocks: unknown, report: BlockReporter, renderable: (type: string) => boolean = () => true): BlockPlan {
  const list: unknown[] = Array.isArray(blocks) ? blocks : []
  if (!Array.isArray(blocks)) report('page: blocks must be a list')
  const page = validatePage(list)
  for (const e of page.errors) report(e)
  const seen = new Map<string, number>()
  const items: PlannedBlock[] = []
  let skipped = 0
  list.forEach((raw, index) => {
    if (index >= 40) {
      skipped += 1
      return
    }
    const check = page.results[index] ?? validateBlock(raw)
    if (!check.ok) {
      skipped += 1
      report(`block ${index} skipped: ${check.errors.join('; ')}`)
      return
    }
    const block = raw as PageBlock
    const def = blockDef(block.type)
    if (!def || !renderable(block.type)) {
      skipped += 1
      report(`block ${index} skipped: no renderer for "${block.type}"`)
      return
    }
    const n = (seen.get(block.type) ?? 0) + 1
    seen.set(block.type, n)
    if (def.maxPerPage !== undefined && n > def.maxPerPage) {
      skipped += 1
      report(`block ${index} skipped: ${block.type} at most ${def.maxPerPage} per page`)
      return
    }
    if (block.hidden === true) return
    items.push({ block, index })
  })
  const groups: BlockPlan['groups'] = []
  for (const item of items) {
    const def = blockDef(item.block.type)
    const frame = def ? blockFrame(def, item.block.content) : 'own'
    const last = groups[groups.length - 1]
    if (frame === 'programme' && last?.frame === 'programme') last.items.push(item)
    else groups.push({ frame, items: [item] })
  }
  const city = items.some(({ block }) => blockDef(block.type)?.wrapper.city === true)
  return { groups, city, skipped }
}
