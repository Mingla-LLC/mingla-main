'use client'

// #4452 §2.9 / §7.6 — the pop-up inside a draft preview (/site-preview/<token>):
// it opens straight away as a visitor would see it (whatever its trigger, since
// the reviewer came to see it) and can be opened again with "See the pop-up".
// It is the real PopupDialog with the preview form, so Send never submits.
import { useEffect, useRef, useState } from 'react'
import { PopupDialog } from './popup-dialog'
import { FIRST_FIELD_SELECTOR, focusablesIn } from '@/lib/forms/popup-dom'
import type { RendererForm } from './form-renderer'
import type { Block } from '@/lib/site-pages/model'

export function PreviewPopup({ form, block, editorBar = false, onEdit }: { form: RendererForm & { name: string }; block: Block; editorBar?: boolean; onEdit?: () => void }) {
  const [open, setOpen] = useState(!editorBar)
  const [done, setDone] = useState<{ id: string; first: string | null } | null>(null)
  const [phone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 859px)').matches)
  const dialog = useRef<HTMLDivElement>(null)
  // #4452 rework 1 (P3-15): the preview behaves like the live pop-up: focus
  // starts in the first field, Tab stays inside, Esc closes.
  useEffect(() => {
    if (!open) return
    const first = dialog.current?.querySelector<HTMLElement>(FIRST_FIELD_SELECTOR) ?? dialog.current
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
      if (e.key === 'Tab' && dialog.current) {
        const items = focusablesIn<HTMLElement>(dialog.current).filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (!items.length) return
        const a = items[0]
        const z = items[items.length - 1]
        if (!dialog.current.contains(document.activeElement)) { e.preventDefault(); a.focus(); return }
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <>
      <div className="ed-bar" data-preview-popup="">
        <span>This page has a pop-up form ({block.popup?.style === 'side' ? 'side panel' : 'centre pop-up'}).</span>
        <button type="button" onClick={() => { setDone(null); setOpen(true) }}>See the pop-up</button>
        {onEdit ? <button type="button" data-editor-marker="" onClick={onEdit}>Edit the pop-up</button> : null}
      </div>
      {open ? (
        <PopupDialog dialogRef={dialog} overBar style={phone ? 'sheet' : block.popup?.style === 'side' ? 'side' : 'centre'} form={{ ...form, preview: true }} block={block}
          confirmClose={false} onKeepGoing={() => {}} onClose={() => setOpen(false)} done={done}
          onDone={(o, first) => setDone({ id: o.submissionId, first })} />
      ) : null}
    </>
  )
}
