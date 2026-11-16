'use client'

// #4452 §2.4 / §7.4 — the pop-up's dialog as visitors see it: the designed
// photo side (centre style), the title bar with Close, the keep / close prompt,
// the form (or the success screen) and the footer with the dismiss link and
// the small print. The site's PopupHost and the builder's live preview (the
// forms kit) render this same component, so the preview is the real thing.
import type { RefObject } from 'react'
import { FormRenderer, type RendererForm } from './form-renderer'
import { SuccessScreen } from './success-screen'
import { FormLook } from './form-look'
import { designOf } from '@/lib/forms/design'
import type { SubmitOutcome } from '@/lib/forms/submit'
import type { BookingBasics } from '@/lib/forms/booking'
import type { Block } from '@/lib/site-pages/model'

export type CloseHow = 'close_button' | 'not_now' | 'esc' | 'scrim' | 'done'

export interface PopupDialogProps {
  dialogRef?: RefObject<HTMLDivElement | null>
  style: 'centre' | 'side' | 'sheet'
  form: RendererForm & { name: string }
  block: Pick<Block, 'id' | 'head' | 'em'>
  confirmClose: boolean
  onKeepGoing: () => void
  onClose: (how: CloseHow) => void
  done: { id: string; first: string | null; booking?: BookingBasics | null } | null
  /** §2.8: after an in-form booking. */
  onBooked?: (start: string) => void
  onDirty?: (dirty: boolean) => void
  onDone: (o: Extract<SubmitOutcome, { ok: true }>, first: string | null, booking?: BookingBasics | null) => void
  /** The builder's preview: drawn inside its frame, not over a page. */
  framed?: boolean
}

export function PopupDialog({ dialogRef, style, form, block, confirmClose, onKeepGoing, onClose, done, onDirty, onDone, onBooked, framed = false }: PopupDialogProps) {
  const design = designOf(form.design)
  const title = style === 'side' ? `${block.head ?? design.head}` : block.head ?? design.title ?? form.name
  return (
    <div className={`pu-scrim${framed ? ' pu-framed' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose('scrim') }}>
      <div ref={dialogRef} className={`pu pu-${style}`} role="dialog" aria-modal="true" aria-labelledby="pu-title" tabIndex={-1}>
        {style === 'sheet' ? <span className="pu-grab" aria-hidden="true" /> : null}
        {style === 'centre' ? <FormLook design={design} /> : null}
        <div className="pu-pane">
          {style === 'side' ? <FormLook design={design} compact /> : null}
          <div className="pu-top">
            <h2 id="pu-title" className="pu-title">
              {title} {style === 'side' && (block.em ?? design.em) ? <em>{block.em ?? design.em}</em> : null}
            </h2>
            <button type="button" className="pu-close" onClick={() => onClose('close_button')} aria-label="Close">
              <span aria-hidden="true">✕</span> Close
            </button>
          </div>
          {confirmClose ? (
            <div className="pu-confirm" role="alert">
              <p>Close the form? Your answers are kept on this device for 7 days.</p>
              <button type="button" className="fk-send" autoFocus onClick={onKeepGoing}>Keep going</button>
              <button type="button" className="fk-link" onClick={() => onClose('close_button')}>Close</button>
            </div>
          ) : null}
          <div className="pu-body">
            {done ? (
              <SuccessScreen audience={form.audience} firstName={done.first} submissionId={done.id} preview={form.preview} onClose={() => onClose('done')} booking={done.booking ?? null} onBooked={onBooked} />
            ) : (
              <FormRenderer form={form} placement="popup" blockId={block.id} sendLabel={design.send} onDirty={onDirty} onDone={onDone} />
            )}
          </div>
          {!done ? (
            <div className="pu-foot">
              <button type="button" className="fk-link" onClick={() => onClose('not_now')}>{design.dismiss}</button>
              {style !== 'sheet' && design.small ? <p className="pu-small">{design.small}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
