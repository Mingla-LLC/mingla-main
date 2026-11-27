'use client'

// #4452 §7.6 — the page side of the Website pages editor (only inside
// /site-preview/<token>?editor=1). It tells Admin it is ready, keeps Admin told
// where the page is scrolled (so a reload after an edit lands in the same
// place), and gives the markers a way to post their clicks. Every message goes
// to the one allowlisted Admin origin (lib/site-pages/editor.ts), never "*".
import { useEffect, type ReactNode } from 'react'
import type { EditorMessage } from '@/lib/site-pages/editor'
import type { PageMessage } from '@/lib/site-pages/editor-protocol'

let ORIGIN: string | null = null

/** The one Admin origin this page talks to (null outside the editor). */
export function editorOriginNow(): string | null {
  return ORIGIN
}

/** #4636: the #4452 spot messages and the block canvas messages (lib/site-pages/editor-protocol.ts). */
export function postToEditor(msg: EditorMessage | PageMessage): void {
  if (!ORIGIN || window.parent === window) return
  window.parent.postMessage(msg, ORIGIN)
}

export function EditorBridge({ origin, page }: { origin: string; page: string }) {
  useEffect(() => {
    ORIGIN = origin
    const y = Number(new URLSearchParams(window.location.search).get('y') ?? '')
    if (Number.isFinite(y) && y > 0) window.scrollTo({ top: y })
    postToEditor({ type: 'editor-ready', page })
    let t: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (t) return
      t = setTimeout(() => { t = null; postToEditor({ type: 'editor-scroll', page, y: Math.round(window.scrollY) }) }, 250)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    // Links and forms inside the editor preview do nothing: the editor is for placing blocks.
    const stop = (e: Event) => {
      const el = e.target as HTMLElement | null
      if (el?.closest('a[href]') && !el.closest('[data-editor-marker]')) e.preventDefault()
    }
    document.addEventListener('click', stop, true)
    return () => { window.removeEventListener('scroll', onScroll); document.removeEventListener('click', stop, true) }
  }, [origin, page])
  return null
}

/** An empty spot: the orange "Add here · <label>" marker. */
export function AddHere({ page, spot, label }: { page: string; spot: string; label: string }) {
  return (
    <div className="ed-spot" data-editor-spot={spot}>
      <button type="button" className="ed-add" data-editor-marker="" onClick={() => postToEditor({ type: 'spot-click', page, spot })}>
        + Add here · {label}
      </button>
    </div>
  )
}

/** A spot that holds a block: outlined; a click opens the block in the editor. */
export function BlockOutline({ page, spot, block, label, children }: { page: string; spot: string; block: string; label: string; children: ReactNode }) {
  return (
    <div className="ed-block" data-editor-spot={spot} data-editor-block={block}>
      <button type="button" className="ed-tag" data-editor-marker="" onClick={() => postToEditor({ type: 'block-click', page, spot, block })}>
        Edit · {label}
      </button>
      {children}
    </div>
  )
}

/** The editable hero (/creators, /locals): outlined and clickable. */
export function HeroOutline({ page, children }: { page: string; children: ReactNode }) {
  return (
    <div className="ed-hero" data-editor-hero={page}>
      <button type="button" className="ed-tag" data-editor-marker="" onClick={() => postToEditor({ type: 'hero-click', page })}>
        Edit the hero words
      </button>
      {children}
    </div>
  )
}
