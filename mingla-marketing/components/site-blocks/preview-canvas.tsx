'use client'

// #4636 — the page side of the Admin block canvas (only inside
// /site-preview/<token>?editor=1&ao=<Admin origin>). The contract is
// lib/site-pages/editor-protocol.ts:
//
//   - tells Admin where every block is (editor-ready, then editor-blocks on
//     any layout change) and which block / words a click landed on;
//   - takes draft updates (editor-draft) and re-renders the page from them
//     through a server action, with no reload; answers editor-applied;
//   - outlines a selected block and scrolls one into view on request.
//
// Messages are acted on only from the one allowlisted Admin origin, from the
// parent frame, and well formed (acceptAdminMessage); everything posted goes
// to that origin only (postToEditor), never '*'.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { acceptAdminMessage, EDITOR_PROTOCOL_VERSION, fieldForText, type BlockBox, type EditorMode } from '@/lib/site-pages/editor-protocol'
import { postToEditor } from './editor-bridge'

export interface DraftRenderResult {
  ok: boolean
  errors: string[]
  node: ReactNode
  sections: unknown[]
}

interface PreviewCanvasProps {
  token: string
  page: string
  origin: string
  sample: string | null
  mode: EditorMode
  sections: unknown[]
  renderDraft: (token: string, pageKey: string, content: unknown, sample: string | null, ao: string | null) => Promise<DraftRenderResult>
  children: ReactNode
}

/** Where each block is, in document pixels (a block wrapper is display: contents, so its children are measured). */
function measure(root: HTMLElement): BlockBox[] {
  const boxes: BlockBox[] = []
  root.querySelectorAll<HTMLElement>('[data-ed-block]').forEach((el) => {
    let top = Infinity
    let bottom = -Infinity
    for (const child of Array.from(el.children)) {
      const r = child.getBoundingClientRect()
      if (r.height === 0 && r.width === 0) continue
      top = Math.min(top, r.top)
      bottom = Math.max(bottom, r.bottom)
    }
    if (!Number.isFinite(top)) return
    boxes.push({
      index: Number(el.dataset.edBlock),
      type: el.dataset.edType ?? '',
      id: el.dataset.edId ?? null,
      top: Math.max(0, Math.round(top + window.scrollY)),
      height: Math.max(0, Math.round(bottom - top)),
    })
  })
  return boxes
}

export function PreviewCanvas({ token, page, origin, sample, mode, sections: initialSections, renderDraft, children }: PreviewCanvasProps) {
  const [body, setBody] = useState<ReactNode>(children)
  const [selected, setSelected] = useState<number | null>(null)
  const sections = useRef<unknown[]>(initialSections)
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(0)

  const report = useCallback(
    (first: boolean) => {
      const el = root.current
      if (!el) return
      const blocks = measure(el)
      const height = Math.round(document.documentElement.scrollHeight)
      if (first) postToEditor({ type: 'editor-ready', v: EDITOR_PROTOCOL_VERSION, page, mode, blocks, height })
      else postToEditor({ type: 'editor-blocks', page, blocks, height })
    },
    [page, mode],
  )

  // First paint, then every layout change (resize, fonts, images, a new draft).
  useEffect(() => {
    report(true)
    let t: ReturnType<typeof setTimeout> | null = null
    const later = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => report(false), 150)
    }
    const ro = new ResizeObserver(later)
    if (root.current) ro.observe(root.current)
    window.addEventListener('resize', later)
    document.fonts?.ready.then(later).catch(() => undefined)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', later)
      if (t) clearTimeout(t)
    }
  }, [report])
  useEffect(() => report(false), [body, report])

  // Admin → page.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = acceptAdminMessage(event, origin, window.parent)
      if (!msg || msg.page !== page) return
      if (msg.type === 'editor-select') setSelected(msg.index)
      if (msg.type === 'editor-scroll-to') {
        const box = root.current ? measure(root.current).find((b) => b.index === msg.index) : undefined
        if (box) window.scrollTo({ top: Math.max(0, box.top - 80), behavior: 'smooth' })
      }
      if (msg.type === 'editor-draft') {
        latest.current = msg.seq
        renderDraft(token, page, msg.content, sample, origin)
          .then((res) => {
            if (msg.seq !== latest.current) return // a newer draft is on its way
            if (res.node !== null) {
              setBody(res.node)
              sections.current = res.sections
            }
            postToEditor({ type: 'editor-applied', page, seq: msg.seq, ok: res.ok, errors: res.errors })
          })
          .catch(() => postToEditor({ type: 'editor-applied', page, seq: msg.seq, ok: false, errors: ['The preview could not update. Reload it.'] }))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, page, sample, token, renderDraft])

  // Clicks inside a block → which block, and which words (when they are one field).
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const block = target?.closest<HTMLElement>('[data-ed-block]')
      if (!target || !block || target.closest('[data-editor-marker]')) return
      event.preventDefault()
      const index = Number(block.dataset.edBlock)
      const words = (target.closest<HTMLElement>('h1,h2,h3,h4,p,li,a,button,figcaption,span,em') ?? target).innerText ?? ''
      const text = words.replace(/\s+/g, ' ').trim().slice(0, 200)
      const item = sections.current[index] as { content?: unknown } | undefined
      postToEditor({ type: 'editor-click', page, index, blockType: block.dataset.edType ?? '', field: fieldForText(item?.content, text), text })
      setSelected(index)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [page])

  const box = selected !== null && root.current ? measure(root.current).find((b) => b.index === selected) : undefined
  return (
    <div ref={root} data-editor-canvas="">
      {body}
      {box ? <div className="ed-select" data-editor-chrome="" style={{ top: box.top, height: box.height }} aria-hidden="true" /> : null}
    </div>
  )
}
