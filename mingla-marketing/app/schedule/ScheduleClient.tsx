'use client'
// #1086 [Standalone scheduler] → #4339 §6 — Book a call, redesigned.
//
// The design's flow ("Mingla, Edited", VIEWS.schedule): pick a day (one row of
// day chips that swipes on a phone) → pick a time (your time zone, 20 minutes)
// → details → confirm → "You're booked."
//
// Details: Name, Email, "What do you run?" (the eight ICPs) and "Your main
// social" (platform + handle) are required; Place or brand name (the existing
// `venue`) and Website are optional. `?icp=<slug>` from a Host landing page
// preselects what they run; `?venue`, `?report_url` and `?source` keep working
// exactly as before (the free tools' funnels, #3601 source attribution), and
// `?name` / `?email` still prefill.
//
// Availability and booking are the live `growth-tools-book` function through
// lib/growth-tools-submit.ts (Google Calendar + Meet invite, confirmation emails
// to both sides). The handle and website are checked here with the same rules
// the function enforces (lib/booking-social.ts); the function is the authority
// and names the field it refuses. Confirm stays pressable: a press with a
// problem shows every field's message and moves focus to the first one.
// Degrades to email when the calendar is unconfigured or has no openings.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Check, Mail } from 'lucide-react'
import { captureMarketing, captureSearchMeasurement } from '@/components/marketing/posthog-provider'
import { landingIcp } from '@/lib/page-measurement'
import { bookCall, fetchBookingSlots, type BookingSlot } from '@/lib/growth-tools-submit'
import { BOOKING_ICPS, SOCIAL_PLATFORMS, bookingErrors, icpFromParam, type BookingField } from '@/lib/booking-social'

const CALL_MAILTO = 'mailto:seth@usemingla.com?subject=Book%20a%20call%20with%20Mingla'

// Locale-aware, stable at module scope. The long label doubles as the group key:
// across the booking window it is unique (weekday + month + day).
const dayKeyFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const dayWeekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const dayNumberFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric' })
const dayMonthFmt = new Intl.DateTimeFormat(undefined, { month: 'short' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

interface Day {
  key: string
  date: Date
  slots: BookingSlot[]
}

type Phase = 'loading' | 'ready' | 'unavailable' | 'confirming' | 'done'

interface Confirmed {
  start: string
  email: string
  meet_url: string | null
}

const FIELD_ORDER: readonly BookingField[] = ['name', 'email', 'icp', 'social', 'website']

const SERVER_MESSAGE: Readonly<Record<BookingField, string>> = {
  name: 'Add your name.',
  email: 'Add an email we can send the invite to.',
  icp: 'Choose what you run.',
  social: 'We couldn’t use that social. Check the handle, or paste your profile link.',
  website: 'Use a web address, like yourplace.com.',
}

export function ScheduleClient() {
  const params = useSearchParams()
  const reportUrl = (params.get('report_url') ?? '').slice(0, 500)
  const source = (params.get('source') ?? 'direct').slice(0, 40)
  const presetIcp = icpFromParam(params.get('icp'))
  const ids = useId()

  const [phase, setPhase] = useState<Phase>('loading')
  const [slots, setSlots] = useState<BookingSlot[]>([])
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [name, setName] = useState(params.get('name') ?? '')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [icp, setIcp] = useState<string>(presetIcp)
  const [socialPlatform, setSocialPlatform] = useState<string>('instagram')
  const [socialHandle, setSocialHandle] = useState('')
  const [venue, setVenue] = useState((params.get('venue') ?? '').slice(0, 120))
  const [website, setWebsite] = useState('')
  const [touched, setTouched] = useState<Partial<Record<BookingField, boolean>>>({})
  const [serverField, setServerField] = useState<BookingField | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const doneRef = useRef<HTMLHeadingElement>(null)

  // Load the availability window. `keep` preserves the current day selection on
  // a post-conflict refresh (only the taken slot drops out).
  async function load(keep = false) {
    if (!keep) setPhase('loading')
    const res = await fetchBookingSlots()
    if (!res.ok || res.slots.length === 0) {
      setPhase('unavailable')
      return
    }
    setSlots(res.slots)
    setPhase('ready')
  }

  useEffect(() => {
    captureMarketing('tool_book_view', { source, venue: venue || undefined, icp: presetIcp || undefined })
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const days = useMemo<Day[]>(() => {
    const map = new Map<string, Day>()
    for (const s of slots) {
      const date = new Date(s.start)
      const key = dayKeyFmt.format(date)
      const entry = map.get(key)
      if (entry) entry.slots.push(s)
      else map.set(key, { key, date, slots: [s] })
    }
    return [...map.values()]
  }, [slots])

  // Keep a valid day selected as the window changes.
  useEffect(() => {
    if (days.length === 0) return
    if (!selectedDayKey || !days.some((d) => d.key === selectedDayKey)) setSelectedDayKey(days[0].key)
  }, [days, selectedDayKey])

  useEffect(() => {
    if (phase === 'done') doneRef.current?.focus()
  }, [phase])

  const selectedDay = days.find((d) => d.key === selectedDayKey) ?? days[0] ?? null
  const errors = bookingErrors({ name, email, icp, socialPlatform, socialHandle, venue, website })
  const valid = Object.keys(errors).length === 0

  const message = (field: BookingField): string | undefined => {
    if (serverField === field) return errors[field] ?? SERVER_MESSAGE[field]
    return touched[field] ? errors[field] : undefined
  }
  const touch = (field: BookingField) => setTouched((t) => (t[field] ? t : { ...t, [field]: true }))
  const clearServer = (field: BookingField) => setServerField((f) => (f === field ? null : f))
  const focusField = (field: BookingField) =>
    window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus())

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSlot || phase === 'confirming') return
    if (!valid) {
      setTouched({ name: true, email: true, icp: true, social: true, website: true })
      const first = FIELD_ORDER.find((f) => errors[f])
      if (first) focusField(first)
      return
    }
    setPhase('confirming')
    setError(null)
    setServerField(null)
    captureMarketing('schedule_details_submitted', { icp, source })
    const res = await bookCall({
      start: selectedSlot,
      name: name.trim(),
      email: email.trim(),
      icp,
      social_platform: socialPlatform,
      social_handle: socialHandle.trim(),
      venue: venue.trim() || undefined,
      website: website.trim() || undefined,
      report_url: reportUrl || undefined,
      // #3601 — always sent. It is never empty (defaults to 'direct'), and the
      // backend maps 'direct' and absent to the same shared-scheduler-link label.
      source,
    })
    if (res.ok) {
      captureMarketing('tool_book_confirmed', {
        source,
        venue: venue.trim() || undefined,
        icp,
        social_platform: socialPlatform,
        start: res.start,
      })
      // #4339 round B: a confirmed booking is the lead GA4 counts, by ICP.
      const leadIcp = landingIcp(icp)
      if (leadIcp) {
        captureSearchMeasurement('generate_lead', { audience: 'host', page_family: 'host_pillar', icp: leadIcp, action_state: 'succeeded' })
      }
      setConfirmed({ start: res.start, email: email.trim(), meet_url: res.meet_url })
      setPhase('done')
      return
    }
    if (res.error === 'slot_taken') {
      setError('That time was just taken. Here are the latest openings.')
      setSelectedSlot(null)
      void load(true) // refresh so the taken slot drops out
      return
    }
    if (res.error === 'booking_unconfigured') {
      setPhase('unavailable')
      return
    }
    setPhase('ready')
    if (res.error === 'validation' && res.field && (FIELD_ORDER as readonly string[]).includes(res.field)) {
      const field = res.field as BookingField
      setServerField(field)
      focusField(field)
      return
    }
    setError('That didn’t go through. Try again, or email us.')
  }

  const describe = (field: BookingField) => {
    const text = message(field)
    return {
      'data-field': field,
      'aria-invalid': text ? true : undefined,
      'aria-describedby': text ? `${ids}-${field}-err` : undefined,
      onBlur: () => touch(field),
    } as const
  }
  const fieldError = (field: BookingField) => {
    const text = message(field)
    return text ? (
      <small className="err" id={`${ids}-${field}-err`}>
        {text}
      </small>
    ) : null
  }

  let panel: ReactNode
  if (phase === 'loading') {
    panel = (
      <div className="sched-state" role="status">
        <span className="spin" aria-hidden="true" />
        <p className="muted">Finding open times…</p>
      </div>
    )
  } else if (phase === 'unavailable') {
    panel = (
      <div className="sched-state">
        <h2 className="h3">Let’s find a time by email.</h2>
        <p className="muted">
          Online booking is taking a break right now. Email us and we’ll get a call on the calendar within the day.
        </p>
        <a className="btn ink" href={CALL_MAILTO}>
          <Mail aria-hidden="true" /> Email us to book
        </a>
      </div>
    )
  } else if (phase === 'done' && confirmed) {
    const when = new Date(confirmed.start)
    panel = (
      <div className="done" data-schedule-done="">
        <div className="tick" aria-hidden="true">
          <Check />
        </div>
        <h2 className="h3" ref={doneRef} tabIndex={-1}>
          You’re booked.
        </h2>
        <p className="muted">
          {dayKeyFmt.format(when)} at {timeFmt.format(when)}. The invite, with a video link, is on its way to{' '}
          <b>{confirmed.email}</b>.
        </p>
        <div className="row">
          {confirmed.meet_url ? (
            <a className="btn ink" href={confirmed.meet_url} target="_blank" rel="noopener noreferrer">
              Join the video call
            </a>
          ) : null}
          <Link className="btn soft" href="/host">
            Back to Mingla Host
          </Link>
        </div>
      </div>
    )
  } else {
    panel = (
      <div data-pick="">
        <h2 className="h6" id={`${ids}-days`}>
          Pick a day
        </h2>
        <div className="days" role="group" aria-labelledby={`${ids}-days`} data-schedule-days="">
          {days.map((d) => {
            const active = d.key === selectedDay?.key
            return (
              <button
                key={d.key}
                type="button"
                className={active ? 'on' : undefined}
                aria-pressed={active}
                aria-label={d.key}
                onClick={() => {
                  setSelectedDayKey(d.key)
                  setSelectedSlot(null)
                }}
              >
                {dayWeekdayFmt.format(d.date)}
                <b>{dayNumberFmt.format(d.date)}</b>
                {dayMonthFmt.format(d.date)}
              </button>
            )
          })}
        </div>
        <h2 className="h6" id={`${ids}-times`}>
          {selectedDay ? selectedDay.key : 'Pick a time'} · your time zone · 20 min
        </h2>
        <div className="slots" role="group" aria-labelledby={`${ids}-times`} data-schedule-slots="">
          {selectedDay?.slots.map((s) => {
            const active = s.start === selectedSlot
            return (
              <button
                key={s.start}
                type="button"
                className={active ? 'on' : undefined}
                aria-pressed={active}
                onClick={() => {
                  setSelectedSlot(s.start)
                  // #4339 round B: the time is chosen (no personal detail).
                  captureMarketing('schedule_slot_selected', { icp: presetIcp || null, source })
                  setError(null)
                }}
              >
                {timeFmt.format(new Date(s.start))}
              </button>
            )
          })}
        </div>

        {selectedSlot ? (
          <form ref={formRef} className="sform on" noValidate onSubmit={confirm} data-schedule-form="">
            <div className="field">
              <label htmlFor={`${ids}-name`}>
                Your name <span className="req" aria-hidden="true">*</span>
              </label>
              <input
                id={`${ids}-name`}
                required
                autoComplete="name"
                placeholder="Your name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                {...describe('name')}
              />
              {fieldError('name')}
            </div>
            <div className="field">
              <label htmlFor={`${ids}-email`}>
                Your email <span className="req" aria-hidden="true">*</span>
              </label>
              <input
                id={`${ids}-email`}
                type="email"
                inputMode="email"
                required
                autoComplete="email"
                placeholder="you@yourplace.com"
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
                {...describe('email')}
              />
              {fieldError('email')}
            </div>
            <div className="field full">
              <label htmlFor={`${ids}-icp`}>
                What do you run? <span className="req" aria-hidden="true">*</span>
              </label>
              <select
                id={`${ids}-icp`}
                required
                value={icp}
                onChange={(e) => {
                  setIcp(e.target.value)
                  touch('icp')
                  clearServer('icp')
                }}
                {...describe('icp')}
              >
                <option value="">Choose one</option>
                {BOOKING_ICPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {fieldError('icp')}
            </div>
            <div className="field full">
              <label htmlFor={`${ids}-social`}>
                Your main social <span className="req" aria-hidden="true">*</span>
              </label>
              <div className="soc">
                <select
                  aria-label="Platform"
                  value={socialPlatform}
                  onChange={(e) => {
                    setSocialPlatform(e.target.value)
                    clearServer('social')
                  }}
                  data-schedule-platform=""
                >
                  {SOCIAL_PLATFORMS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <input
                  id={`${ids}-social`}
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="@yourplace"
                  value={socialHandle}
                  maxLength={300}
                  onChange={(e) => {
                    setSocialHandle(e.target.value)
                    clearServer('social')
                  }}
                  {...describe('social')}
                />
              </div>
              {fieldError('social')}
            </div>
            <div className="field">
              <label htmlFor={`${ids}-venue`}>Place or brand name</label>
              <input
                id={`${ids}-venue`}
                placeholder="Optional"
                value={venue}
                maxLength={120}
                onChange={(e) => setVenue(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`${ids}-website`}>Website</label>
              <input
                id={`${ids}-website`}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                placeholder="Optional"
                value={website}
                maxLength={300}
                onChange={(e) => {
                  setWebsite(e.target.value)
                  clearServer('website')
                }}
                {...describe('website')}
              />
              {fieldError('website')}
            </div>
            <button className="btn ink full" type="submit" disabled={phase === 'confirming'} data-schedule-confirm="">
              {phase === 'confirming' ? 'Booking…' : `Confirm ${timeFmt.format(new Date(selectedSlot))}`}
              {phase === 'confirming' ? null : <ArrowRight aria-hidden="true" />}
            </button>
          </form>
        ) : null}

        {error ? (
          <p role="alert" className="sched-error">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <section className="sec dark sched-sec" aria-labelledby={`${ids}-title`}>
      <div className="wrap sched">
        <div>
          <h1 className="sched-title" id={`${ids}-title`}>
            Grab 20 minutes <em>with Mingla.</em>
          </h1>
          <p className="lead">Pick a time. You’ll get a calendar invite with a video link.</p>
        </div>
        <div className="panel">{panel}</div>
      </div>
    </section>
  )
}
