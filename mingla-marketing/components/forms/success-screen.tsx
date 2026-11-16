'use client'
// #4452 §2.8 — the success screen: real next steps, shown only after the server's 200.
import { useState } from 'react'
import { formEvent } from './form-events'
import { BookedScreen, InformBooking } from './inform-booking'
import type { BookingBasics } from '@/lib/forms/booking'

const CALL: Record<'host' | 'creator' | 'local', string> = { host: '/schedule', creator: '/schedule/creators', local: '/schedule/locals' }

export function SuccessScreen({ audience, firstName, submissionId, preview, onClose, booking, onBooked }: {
  audience: 'host' | 'creator' | 'local'; firstName: string | null; submissionId: string; preview?: boolean; onClose?: () => void
  /** §2.8: the answers just sent, for booking here without retyping (null: book on /schedule). */
  booking?: BookingBasics | null
  /** Called after an in-form booking (form pages go to /apply/<slug>/booked; pop-ups send a virtual page view). */
  onBooked?: (start: string) => void
}) {
  const [picking, setPicking] = useState(false)
  const [booked, setBooked] = useState<string | null>(null)
  if (booked) return <BookedScreen first={firstName} start={booked} audience={audience} onClose={onClose} />
  const app = audience === 'host' ? { href: '/host/download', text: 'Get Mingla Host' } : { href: '/download', text: 'Get the Mingla app' }
  const callHref = `${CALL[audience]}${submissionId && submissionId !== 'preview' ? `?form_submission_id=${encodeURIComponent(submissionId)}` : ''}`
  return (
    <div className="fk-success" role="status">
      <span className="fk-big-tick" aria-hidden="true">✓</span>
      <h2>You&rsquo;re in{firstName ? <>, <em>{firstName}</em></> : null}.</h2>
      <p>Check your inbox for next steps. One more thing gets you {audience === 'host' ? 'live' : 'hired'} faster:</p>
      {preview ? <p className="fk-help">Preview: nothing was sent.</p> : null}
      {picking && booking ? (
        <InformBooking basics={booking} submissionId={submissionId} first={firstName} preview={preview} onBooked={(start) => { setBooked(start); onBooked?.(start) }} />
      ) : null}
      <div className="fk-actions">
        {booking ? (
          !picking ? <button type="button" className="fk-send" onClick={() => { formEvent('next_step', null, { choice: 'book_call' }); setPicking(true) }}>Book your 20-minute call</button> : null
        ) : (
          <a className="fk-send" href={callHref} onClick={() => formEvent('next_step', null, { choice: 'book_call' })}>Book your 20-minute call</a>
        )}
        <a className="fk-link-btn" href={app.href} onClick={() => formEvent('next_step', null, { choice: 'get_app' })}>{app.text}</a>
        {onClose ? <button type="button" className="fk-link" onClick={() => { formEvent('next_step', null, { choice: 'done' }); onClose() }}>Done</button> : null}
      </div>
    </div>
  )
}
