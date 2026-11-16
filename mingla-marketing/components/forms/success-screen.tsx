'use client'
// #4452 §2.8 — the success screen: real next steps, shown only after the server's 200.
import { captureMarketing } from '@/components/marketing/marketing-capture'

const CALL: Record<'host' | 'creator' | 'local', string> = { host: '/schedule', creator: '/schedule/creators', local: '/schedule/locals' }

export function SuccessScreen({ audience, firstName, submissionId, preview, onClose }: {
  audience: 'host' | 'creator' | 'local'; firstName: string | null; submissionId: string; preview?: boolean; onClose?: () => void
}) {
  const app = audience === 'host' ? { href: '/host/download', text: 'Get Mingla Host' } : { href: '/download', text: 'Get the Mingla app' }
  const callHref = `${CALL[audience]}${submissionId && submissionId !== 'preview' ? `?form_submission_id=${encodeURIComponent(submissionId)}` : ''}`
  return (
    <div className="fk-success" role="status">
      <span className="fk-big-tick" aria-hidden="true">✓</span>
      <h2>You&rsquo;re in{firstName ? <>, <em>{firstName}</em></> : null}.</h2>
      <p>Check your inbox for next steps. One more thing gets you {audience === 'host' ? 'live' : 'hired'} faster:</p>
      {preview ? <p className="fk-help">Preview: nothing was sent.</p> : null}
      <div className="fk-actions">
        <a className="fk-send" href={callHref} onClick={() => captureMarketing('next_step', { choice: 'book_call' })}>Book your 20-minute call</a>
        <a className="fk-link-btn" href={app.href} onClick={() => captureMarketing('next_step', { choice: 'get_app' })}>{app.text}</a>
        {onClose ? <button type="button" className="fk-link" onClick={() => { captureMarketing('next_step', { choice: 'done' }); onClose() }}>Done</button> : null}
      </div>
    </div>
  )
}
