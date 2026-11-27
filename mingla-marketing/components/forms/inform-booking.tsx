'use client'

// #4452 §2.8 / SC-116 — pick a time and book, right after the form, without
// retyping: the booking is made from the answers just sent and tied to the
// submission (form_submission_id). slot_taken reloads the times; a calendar
// outage says so and links to /schedule/<audience>.
import { useCallback, useEffect, useState } from 'react'
import { bookCall, fetchBookingSlots } from '@/lib/booking-call'
import { type BookingBasics, type Slot, SLOT_TAKEN, TEAM_WORDS, bookedLine, calendarDown, slotsByDay, timeLabel } from '@/lib/forms/booking'
import { formEvent } from './form-events'

const scheduleFor = (a: 'creator' | 'local') => (a === 'creator' ? '/schedule/creators' : '/schedule/locals')

export function InformBooking({ basics, submissionId, first, preview, onBooked }: {
  basics: BookingBasics; submissionId: string; first: string | null; preview?: boolean; onBooked: (start: string) => void
}) {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } })()
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [durationMinutes, setDurationMinutes] = useState(20)
  const schedulerKey = basics.audience === 'creator' ? 'creator-call' : 'local-call'
  const load = useCallback(async () => {
    setSlots(null)
    const res = await fetchBookingSlots(schedulerKey)
    if (!res.ok) { setProblem(calendarDown(basics.audience)); setSlots([]); return }
    setSlots(res.slots)
    setDurationMinutes(res.durationMinutes)
  }, [basics.audience, schedulerKey])
  useEffect(() => { void load() }, [load])
  const days = slots ? slotsByDay(slots, tz) : []
  const shown = days.find((d) => d.day === day) ?? days[0]

  const book = async () => {
    if (!pick || busy) return
    if (preview) { onBooked(pick); return }
    setBusy(true)
    setProblem(null)
    const res = await bookCall({
      start: pick, name: basics.name, email: basics.email, time_zone: tz, audience: basics.audience, city: basics.city,
      social_platform: basics.social_platform, social_handle: basics.social_handle, ...(basics.makes ? { makes: basics.makes } : {}),
      phone: basics.phone as unknown as string, form_submission_id: submissionId, source: 'form', scheduler_key: schedulerKey,
    })
    setBusy(false)
    if (res.ok) {
      formEvent('call_booked_inform', null)
      onBooked(res.start)
      return
    }
    if (res.error === 'slot_taken' || (res.error as string) === 'conflict') { setProblem(SLOT_TAKEN); setPick(null); void load(); return }
    if (res.error === 'validation') { setProblem(`We need a little more to book this one. Book at ${scheduleFor(basics.audience)}.`); return }
    setProblem(calendarDown(basics.audience))
  }

  return (
    <div className="fk-booking" data-inform-booking="">
      <h3>Pick a time{first ? `, ${first}` : ''}.</h3>
      <p className="fk-help">{durationMinutes} minutes on video with the {TEAM_WORDS[basics.audience]} team. Times are in your time zone.</p>
      {problem ? <p className="fk-failure" role="alert">{problem}</p> : null}
      {slots === null ? <p className="fk-help">Loading times…</p> : !days.length ? (
        problem ? null : <p className="fk-help">No times this week. <a href={`/schedule/${basics.audience === 'creator' ? 'creators' : 'locals'}`}>See more times</a></p>
      ) : (
        <>
          <div className="fk-chips" role="group" aria-label="Day">
            {days.map((d) => (
              <button key={d.day} type="button" className={shown?.day === d.day ? 'on' : ''} aria-pressed={shown?.day === d.day} onClick={() => { setDay(d.day); setPick(null) }}>{d.label}</button>
            ))}
          </div>
          <div className="fk-chips" role="group" aria-label="Time">
            {shown?.slots.map((s) => (
              <button key={s.start} type="button" className={pick === s.start ? 'on' : ''} aria-pressed={pick === s.start}
                onClick={() => { setPick(s.start); formEvent('call_slot_selected', null) }}>{timeLabel(s.start, tz)}</button>
            ))}
          </div>
          <button type="button" className="fk-send" disabled={!pick || busy} aria-busy={busy} onClick={() => void book()}>
            {busy ? 'Booking…' : pick ? `Book ${bookedLine(pick, tz)}` : 'Pick a time'}
          </button>
        </>
      )}
    </div>
  )
}

export function BookedScreen({ first, start, audience, onClose }: { first: string | null; start: string; audience: 'host' | 'creator' | 'local'; onClose?: () => void }) {
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } })()
  const app = audience === 'host' ? { href: '/host/download', text: 'Get Mingla Host while you wait' } : { href: '/download', text: 'Get the Mingla app while you wait' }
  return (
    <div className="fk-success" role="status" data-booked="">
      <span className="fk-big-tick" aria-hidden="true">✓</span>
      <h2>You&rsquo;re booked{first ? <>, <em>{first}</em></> : null}.</h2>
      <p>{bookedLine(start, tz)}. The invite with the video link is on its way to your inbox.</p>
      <div className="fk-actions">
        {onClose ? <button type="button" className="fk-send" onClick={() => { formEvent('next_step', null, { choice: 'done' }); onClose() }}>Done</button> : <a className="fk-send" href="/">Done</a>}
        <a className="fk-link-btn" href={app.href} onClick={() => formEvent('next_step', null, { choice: 'get_app' })}>{app.text}</a>
      </div>
    </div>
  )
}
