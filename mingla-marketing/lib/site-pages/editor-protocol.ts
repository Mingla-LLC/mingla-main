// #4636 — THE message contract between Admin's Website pages canvas (build 3)
// and the page drawn inside it (/site-preview/<token>?editor=1&ao=<Admin origin>).
//
// Both directions are origin-checked:
//   page → Admin   window.parent.postMessage(msg, <the ?ao origin>) only, never '*';
//                  the ?ao origin must be an editor origin (lib/site-pages/editor.ts),
//                  which is also allowed to frame the page (next.config.ts).
//   Admin → page   the page acts on a message only when event.origin === that same
//                  origin AND event.source === window.parent AND isAdminMessage(data).
// Admin must likewise check event.origin === the site origin it framed and
// isPageMessage(data) before acting.
//
// Version 2 adds the block canvas to the #4452 spot messages (editor.ts):
//
//   page → Admin
//     editor-ready   { v: 2, page, mode, blocks: BlockBox[], height }   once, after first paint
//     editor-blocks  { page, blocks: BlockBox[], height }               after any layout change
//                    (resize, fonts, images, a draft re-render)
//     editor-click   { page, index, blockType, field, text }            a click inside block `index`;
//                    `field` is the content path of the clicked words when they match one
//                    (e.g. "items[1].title"), else null
//     editor-applied { page, seq, ok, errors }                          the answer to editor-draft
//     editor-scroll  { page, y }                                        (unchanged from #4452)
//
//   Admin → page
//     editor-draft     { page, seq, content }   re-render this page from `content` without a reload:
//                      { sections: Block[] } for a converted or staff page,
//                      { nav?, footer? } for 'site-settings'
//     editor-select    { page, index | null }   outline one block (null: none)
//     editor-scroll-to { page, index }          scroll block `index` into view
//
// BlockBox: { index, type, id, top, height } in CSS pixels of the page document
// (top from the page top, so Admin adds its own scroll offset).
//
// No imports: plain node tests load this file by stripping its types.

export const EDITOR_PROTOCOL_VERSION = 2

export type EditorMode = 'blocks' | 'coded' | 'settings'

export interface BlockBox {
  index: number
  type: string
  id: string | null
  top: number
  height: number
}

export type PageMessage =
  | { type: 'editor-ready'; v: 2; page: string; mode: EditorMode; blocks: BlockBox[]; height: number }
  | { type: 'editor-blocks'; page: string; blocks: BlockBox[]; height: number }
  | { type: 'editor-click'; page: string; index: number; blockType: string; field: string | null; text: string }
  | { type: 'editor-applied'; page: string; seq: number; ok: boolean; errors: string[] }
  | { type: 'editor-scroll'; page: string; y: number }

export type AdminMessage =
  | { type: 'editor-draft'; page: string; seq: number; content: Record<string, unknown> }
  | { type: 'editor-select'; page: string; index: number | null }
  | { type: 'editor-scroll-to'; page: string; index: number }

const PAGE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/
const isPage = (v: unknown): v is string => typeof v === 'string' && PAGE.test(v)
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 200
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function isBox(v: unknown): v is BlockBox {
  return isRecord(v) && isIndex(v.index) && typeof v.type === 'string' && v.type.length <= 40 && (v.id === null || typeof v.id === 'string') && isNum(v.top) && isNum(v.height)
}

/** A well-formed message from the page (Admin checks this AND the origin before acting). */
export function isPageMessage(data: unknown): data is PageMessage {
  if (!isRecord(data) || !isPage(data.page)) return false
  switch (data.type) {
    case 'editor-ready':
      return data.v === 2 && (data.mode === 'blocks' || data.mode === 'coded' || data.mode === 'settings') && Array.isArray(data.blocks) && data.blocks.every(isBox) && isNum(data.height)
    case 'editor-blocks':
      return Array.isArray(data.blocks) && data.blocks.length <= 60 && data.blocks.every(isBox) && isNum(data.height)
    case 'editor-click':
      return isIndex(data.index) && typeof data.blockType === 'string' && (data.field === null || (typeof data.field === 'string' && data.field.length <= 120)) && typeof data.text === 'string' && data.text.length <= 200
    case 'editor-applied':
      return isNum(data.seq) && typeof data.ok === 'boolean' && Array.isArray(data.errors) && data.errors.every((e) => typeof e === 'string')
    case 'editor-scroll':
      return isNum(data.y)
    default:
      return false
  }
}

/** A well-formed message from Admin (the page checks this AND event.origin / event.source first). */
export function isAdminMessage(data: unknown): data is AdminMessage {
  if (!isRecord(data) || !isPage(data.page)) return false
  switch (data.type) {
    case 'editor-draft':
      return isNum(data.seq) && Number.isInteger(data.seq) && isRecord(data.content) && JSON.stringify(data.content).length <= 400_000
    case 'editor-select':
      return data.index === null || isIndex(data.index)
    case 'editor-scroll-to':
      return isIndex(data.index)
    default:
      return false
  }
}

/** Whether an incoming message may be acted on: the one Admin origin, from the parent frame, well formed. */
export function acceptAdminMessage(event: { origin: string; source: unknown; data: unknown }, adminOrigin: string | null, parent: unknown): AdminMessage | null {
  if (!adminOrigin || event.origin !== adminOrigin || event.source !== parent) return null
  return isAdminMessage(event.data) ? event.data : null
}

/** The content path of the words a click landed on (`*italic*` marks ignored), or null. */
export function fieldForText(content: unknown, clicked: string): string | null {
  const want = clicked.replace(/\s+/g, ' ').trim()
  if (!want) return null
  let found: string | null = null
  const walk = (v: unknown, path: string): void => {
    if (found !== null) return
    if (typeof v === 'string') {
      if (v.replace(/\*/g, '').replace(/\s+/g, ' ').trim() === want) found = path
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`))
    } else if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k)
    }
  }
  walk(content, '')
  return found
}
