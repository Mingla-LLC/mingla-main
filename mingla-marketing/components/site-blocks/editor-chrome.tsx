'use client'

// #4452 §7.6 — the editor-only bars above the page: the pop-up spot (every page
// can hold one) and, on /schedule, the details step. Each posts a spot click.
import { postToEditor } from './editor-bridge'

export function EditorChrome({ page, hasPopup, details }: { page: string; hasPopup: boolean; details: 'none' | 'empty' | 'filled' }) {
  return (
    <div className="ed-bar" data-editor-chrome="">
      <button type="button" data-editor-marker="" onClick={() => postToEditor({ type: 'spot-click', page, spot: 'popup' })}>
        {hasPopup ? 'Edit the pop-up form' : '+ Add a pop-up form'}
      </button>
      {details !== 'none' ? (
        <button type="button" data-editor-marker="" onClick={() => postToEditor({ type: 'spot-click', page, spot: 'details-step' })}>
          Details step · {details === 'filled' ? 'Change' : 'Add questions'}
        </button>
      ) : null}
    </div>
  )
}
