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
// lib/booking-call.ts (Google Calendar + Meet invite, confirmation emails
// to both sides). The handle and website are checked here with the same rules
// the function enforces (lib/booking-social.ts); the function is the authority
// and names the field it refuses. Confirm stays pressable: a press with a
// problem shows every field's message and moves focus to the first one.
// Degrades to email when the calendar is unconfigured or has no openings.
//
// #4339 Creators and Locals calls (Seth approved, 9 Nov): the same flow and
// state machine serve /schedule/creators and /schedule/locals through the
// `audience` prop (host, the default, is /schedule and is unchanged). A
// program call asks for the city (every live Mingla city, from the server
// page, plus "Somewhere else"), the main social and, for Creators, "What do
// you make?" and an optional link to their best work; for Locals, an optional
// first place. Its analytics carry `audience` and never fire the Host
// `generate_lead`; "You're booked." asks them to get the Mingla app.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Check, Mail } from 'lucide-react'
import { captureMarketing, captureSearchMeasurement } from '@/components/marketing/marketing-capture'
import { ExplorerHandoffButton } from '@/components/landing/explorer-handoff'
import { landingIcp } from '@/lib/page-measurement'
import { bookCall, fetchBookingHandoff, fetchBookingSlots, scheduleTokenFrom, type BookingSlot } from '@/lib/booking-call'
import { marketingAdContext } from '@/lib/marketing-ad-context'
import { sessionUtm } from '@/lib/forms/utm'
import {
  BOOKING_ICPS,
  CREATOR_MAKES,
  SOCIAL_PLATFORMS,
  SOMEWHERE_ELSE,
  bookingErrors,
  icpFromParam,
  programBookingErrors,
  type BookingAudience,
  type BookingField,
  type ProgramBookingField,
} from '@/lib/booking-social'
import type { ProgramCallCopy } from '@/lib/program-call-copy'

const CALL_MAILTO = 'mailto:seth@usemingla.com?subject=Book%20a%20call%20with%20Mingla'

type Field = BookingField | ProgramBookingField

/** The booker's IANA time zone, so the team sees their local time; omitted when unknown. */
function bookerTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone.length <= 64 ? zone : undefined
  } catch {
    return undefined
  }
}

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

const FIELD_ORDER: Readonly<Record<BookingAudience, readonly Field[]>> = {
  host: ['name', 'email', 'icp', 'social', 'website'],
  creator: ['name', 'email', 'city', 'social', 'makes', 'work_url'],
  local: ['name', 'email', 'city', 'social', 'first_place'],
}

const SERVER_MESSAGE: Readonly<Record<Field, string>> = {
  name: 'Add your name.',
  email: 'Add an email we can send the invite to.',
  icp: 'Choose what you run.',
  social: 'We couldn’t use that social. Check the handle, or paste your profile link.',
  website: 'Use a web address, like yourplace.com.',
  city: 'Choose your city.',
  makes: 'Choose what you make.',
  work_url: 'Use a web address, like a link to a post or your portfolio.',
  first_place: 'Keep it to one place name.',
}

interface ScheduleClientProps {
  /** host (/schedule, the default), creator (/schedule/creators) or local (/schedule/locals). */
  audience?: BookingAudience
  /** Program calls: every live Mingla city by name, then "Somewhere else" (read on the server). */
  cities?: readonly string[]
  /** Program calls: the page's words (lib/program-call-copy.ts, passed from the server so they stay out of the client bundle). */
  copy?: ProgramCallCopy
  /** #4452 §2.2: the /schedule details-step spot (a server-rendered <Spot>), or nothing. */
  detailsSlot?: ReactNode
  /** Stable registry key; the route is only a friendly alias. */
  schedulerKey?: string
}

export function ScheduleClient({ audience = 'host', cities = [SOMEWHERE_ELSE], copy, detailsSlot = null, schedulerKey: routeSchedulerKey }: ScheduleClientProps = {}) {
  const params = useSearchParams()
  const isHost = audience === 'host'
  const schedulerKey = (params.get('profile') || routeSchedulerKey || (audience === 'creator' ? 'creator-call' : audience === 'local' ? 'local-call' : 'host-demo')).slice(0, 48)
  const handoffToken = (params.get('handoff') || '').slice(0, 80)
  // No live city could be read: "Somewhere else" and a free-text city, so nobody is blocked.
  const cityFallback = !cities.some((c) => c !== SOMEWHERE_ELSE)
  const reportUrl = (params.get('report_url') ?? '').slice(0, 500)
  const source = (params.get('source') ?? 'direct').slice(0, 40)
  // #4571 W4: a host card's own scheduler link carries `for`; nothing on the page changes.
  const scheduleFor = isHost ? scheduleTokenFrom(params.get('for')) : undefined
  const presetIcp = icpFromParam(params.get('icp'))
  const ids = useId()

  const [phase, setPhase] = useState<Phase>('loading')
  const [slots, setSlots] = useState<BookingSlot[]>([])
  const [durationMinutes, setDurationMinutes] = useState(20)
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [name, setName] = useState(params.get('name') ?? '')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [icp, setIcp] = useState<string>(presetIcp)
  const [socialPlatform, setSocialPlatform] = useState<string>('instagram')
  const [socialHandle, setSocialHandle] = useState('')
  const [venue, setVenue] = useState((params.get('venue') ?? '').slice(0, 120))
  const [website, setWebsite] = useState('')
  const [city, setCity] = useState(cityFallback ? SOMEWHERE_ELSE : '')
  const [cityOther, setCityOther] = useState('')
  const [makes, setMakes] = useState('')
  const [workUrl, setWorkUrl] = useState('')
  const [firstPlace, setFirstPlace] = useState('')
  // #4452 §4.6 / #4640: a phone required for every call, plus the optional,
  // unticked consent box (Q-A1-2).
  const [phone, setPhone] = useState('')
  const [phoneTouched, setPhoneTouched] = useState(false)
  const [phoneServer, setPhoneServer] = useState(false)
  const [consent, setConsent] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [serverField, setServerField] = useState<Field | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const doneRef = useRef<HTMLHeadingElement>(null)

  // Load the availability window. `keep` preserves the current day selection on
  // a post-conflict refresh (only the taken slot drops out).
  async function load(keep = false) {
    if (!keep) setPhase('loading')
    const res = await fetchBookingSlots(schedulerKey)
    if (!res.ok || res.slots.length === 0) {
      setPhase('unavailable')
      return
    }
    setSlots(res.slots)
    setDurationMinutes(res.durationMinutes)
    setPhase('ready')
  }

  useEffect(() => {
    captureMarketing('tool_book_view', { audience, source, venue: venue || undefined, icp: presetIcp || undefined })
    void (async () => {
      if (handoffToken) {
        const handoff = await fetchBookingHandoff(handoffToken, schedulerKey)
        if (handoff.ok) {
          const p = handoff.payload
          if (typeof p.name === 'string') setName(p.name)
          if (typeof p.email === 'string') setEmail(p.email)
          if (typeof p.phone === 'string') setPhone(p.phone)
          if (typeof p.icp === 'string') setIcp(p.icp)
          if (typeof p.social_platform === 'string') setSocialPlatform(p.social_platform)
          if (typeof p.social_handle === 'string') setSocialHandle(p.social_handle)
          if (typeof p.venue === 'string') setVenue(p.venue)
          if (typeof p.website === 'string') setWebsite(p.website)
          if (typeof p.city === 'string') setCity(p.city)
          if (typeof p.makes === 'string') setMakes(p.makes)
          if (typeof p.first_place === 'string') setFirstPlace(p.first_place)
        }
      }
      await load()
    })()
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
  // The city a program call books with: the chosen live city, or what they
  // typed when no live city could be read ("Somewhere else" when blank).
  const bookedCity = cityFallback ? cityOther.trim() || SOMEWHERE_ELSE : city
  const errors: Partial<Record<Field, string>> = isHost
    ? bookingErrors({ name, email, icp, socialPlatform, socialHandle, venue, website })
    : programBookingErrors({ audience, name, email, city: bookedCity, socialPlatform, socialHandle, makes, workUrl, firstPlace })
  const phoneDigits = phone.replace(/[^0-9]/g, '')
  const phoneOk = /^\s*\+/.test(phone) && phoneDigits.length >= 7 && phoneDigits.length <= 15 && phoneDigits[0] !== '0'
  const phoneMessage = (phoneTouched || phoneServer) && !phoneOk ? 'That number looks short. Start with your country code, like +234.' : undefined
  const valid = Object.keys(errors).length === 0 && phoneOk
  const fieldOrder = FIELD_ORDER[audience]

  const message = (field: Field): string | undefined => {
    if (serverField === field) return errors[field] ?? SERVER_MESSAGE[field]
    return touched[field] ? errors[field] : undefined
  }
  const touch = (field: Field) => setTouched((t) => (t[field] ? t : { ...t, [field]: true }))
  const clearServer = (field: Field) => setServerField((f) => (f === field ? null : f))
  const focusField = (field: Field) =>
    window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus())

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSlot || phase === 'confirming') return
    if (!valid) {
      setTouched(Object.fromEntries(fieldOrder.map((f) => [f, true])))
      setPhoneTouched(true)
      const first = fieldOrder.find((f) => errors[f])
      if (first) focusField(first)
      else if (!phoneOk) window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-field="phone"]')?.focus())
      return
    }
    setPhase('confirming')
    setError(null)
    setServerField(null)
    captureMarketing('schedule_details_submitted', isHost ? { audience, icp, source } : { audience, source })
    // #4452 §4.6: every audience sends its ad context (ads-gated inside) and its landing UTM.
    const adContext = marketingAdContext()
    const formSubmissionId = params.get('form_submission_id') ?? undefined
    const res = await bookCall({
      start: selectedSlot,
      name: name.trim(),
      email: email.trim(),
      // #3601 — always sent. It is never empty (defaults to 'direct'), and the
      // backend maps 'direct' and absent to the same shared-scheduler-link label.
      source,
      time_zone: bookerTimeZone(),
      phone: phone.trim(),
      scheduler_key: schedulerKey,
      ...(handoffToken ? { handoff_token: handoffToken } : {}),
      utm: sessionUtm(),
      ...(formSubmissionId ? { form_submission_id: formSubmissionId } : {}),
      ...(consent ? { marketing_consent: true, consent_text: 'Send me occasional emails from Mingla. Unsubscribe anytime.' } : {}),
      ...(adContext ? { ad: adContext } : {}),
      ...(isHost
        ? {
            icp,
            social_platform: socialPlatform,
            social_handle: socialHandle.trim(),
            venue: venue.trim() || undefined,
            website: website.trim() || undefined,
            report_url: reportUrl || undefined,
            ...(scheduleFor ? { for: scheduleFor } : {}),
            // #4238 W3-3: the host lead's ad context (ads-gated inside).
            ...(adContext ? { ad: adContext } : {}),
          }
        : {
            audience,
            city: bookedCity,
            social_platform: socialPlatform,
            social_handle: socialHandle.trim(),
            ...(audience === 'creator'
              ? { makes, work_url: workUrl.trim() || undefined }
              : { first_place: firstPlace.trim() || undefined }),
          }),
    })
    if (res.ok) {
      captureMarketing('tool_book_confirmed', {
        audience,
        source,
        venue: isHost ? venue.trim() || undefined : undefined,
        icp: isHost ? icp : undefined,
        social_platform: socialPlatform,
        start: res.start,
      })
      // #4339 round B: a confirmed Host booking is the lead GA4 counts, by ICP.
      // A Creators or Locals call is never a Host lead, and the governed GA4
      // schema (@mingla/search-measurement) has no creator or local audience,
      // so it is recorded in PostHog only (tool_book_confirmed, by audience).
      const leadIcp = isHost ? landingIcp(icp) : null
      if (leadIcp) {
        captureSearchMeasurement('generate_lead', { audience: 'host', page_family: 'host_pillar', icp: leadIcp, action_state: 'succeeded' })
      }
      // #4238 W3-3 / #4452: the browser twins of the server's labelled Lead and booked call (ads on only).
      // #4452: the pixel helpers load on booking, not with the page (the #4339 first-load budget).
      if (res.lead_event_id || res.goal_event_id) {
        const leadId = res.lead_event_id
        const goalId = res.goal_event_id
        void import('@/lib/marketing-pixels').then(({ fireMarketingGoal, fireMarketingLead }) => {
          if (leadId) fireMarketingLead(audience, leadId)
          if (goalId) fireMarketingGoal(audience, goalId)
        })
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
    if (res.error === 'validation' && res.field === 'phone') {
      setPhoneServer(true)
      window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[data-field="phone"]')?.focus())
      return
    }
    if (res.error === 'validation' && res.field && (fieldOrder as readonly string[]).includes(res.field)) {
      const field = res.field as Field
      setServerField(field)
      focusField(field)
      return
    }
    setError('That didn’t go through. Try again, or email us.')
  }

  const describe = (field: Field) => {
    const text = message(field)
    return {
      'data-field': field,
      'aria-invalid': text ? true : undefined,
      'aria-describedby': text ? `${ids}-${field}-err` : undefined,
      onBlur: () => touch(field),
    } as const
  }
  const fieldError = (field: Field) => {
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
      <div className="sched-state sched-loading" role="status">
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
        {isHost || !copy ? (
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
        ) : (
          <>
            <p className="muted done-next">{copy.next}</p>
            <div className="row">
              <ExplorerHandoffButton location={copy.handoff} className="btn cta">
                Get Mingla
              </ExplorerHandoffButton>
              <Link className="btn soft" href={copy.back.href}>
                {copy.back.label}
              </Link>
            </div>
          </>
        )}
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
          {selectedDay ? selectedDay.key : 'Pick a time'} · your time zone · {durationMinutes} min
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
                  captureMarketing('schedule_slot_selected', { audience, icp: isHost ? presetIcp || null : null, source })
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
                placeholder={isHost ? 'you@yourplace.com' : 'you@email.com'}
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
                {...describe('email')}
              />
              {fieldError('email')}
            </div>
            <div className="field">
              <label htmlFor={`${ids}-phone`}>
                Your phone <span className="req" aria-hidden="true">*</span>
              </label>
              <input
                id={`${ids}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+234 801 234 5678"
                value={phone}
                maxLength={24}
                data-field="phone"
                required
                aria-invalid={phoneMessage ? true : undefined}
                onBlur={() => setPhoneTouched(true)}
                onChange={(e) => { setPhone(e.target.value); setPhoneServer(false) }}
              />
              {phoneMessage ? <p className="err" role="alert">{phoneMessage}</p> : null}
            </div>
            {isHost ? (
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
            ) : (
              <div className="field full">
                <label htmlFor={`${ids}-city`}>
                  Your city <span className="req" aria-hidden="true">*</span>
                </label>
                <select
                  id={`${ids}-city`}
                  required
                  value={city}
                  onChange={(e) => {
                    setCity(e.target.value)
                    touch('city')
                    clearServer('city')
                  }}
                  {...describe('city')}
                  data-schedule-city=""
                >
                  {cityFallback ? null : <option value="">Choose your city</option>}
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {cityFallback ? (
                  <input
                    aria-label="Which city?"
                    placeholder="Which city? (optional)"
                    value={cityOther}
                    maxLength={80}
                    onChange={(e) => {
                      setCityOther(e.target.value)
                      clearServer('city')
                    }}
                    data-schedule-city-other=""
                  />
                ) : null}
                {audience === 'local' ? (
                  <small className="hint">
                    Locals open city by city, with up to three per city.
                  </small>
                ) : null}
                {fieldError('city')}
              </div>
            )}
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
                  placeholder={isHost ? '@yourplace' : '@yourhandle'}
                  value={socialHandle}
                  maxLength={300}
                  onChange={(e) => {
                    setSocialHandle(e.target.value)
                    clearServer('social')
                  }}
                  {...describe('social')}
                />
              </div>
              {audience === 'creator' ? <small className="hint">We look at your work before the call.</small> : null}
              {fieldError('social')}
            </div>
            {isHost ? (
              <>
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
              </>
            ) : audience === 'creator' ? (
              <>
                <fieldset
                  className="field full seg-f"
                  data-field="makes"
                  aria-invalid={message('makes') ? true : undefined}
                  aria-describedby={message('makes') ? `${ids}-makes-err` : undefined}
                  tabIndex={-1}
                >
                  <legend>
                    What do you make? <span className="req" aria-hidden="true">*</span>
                  </legend>
                  <div className="seg" role="radiogroup" aria-required="true" data-schedule-makes="">
                    {CREATOR_MAKES.map((m) => (
                      <label key={m.value}>
                        <input
                          type="radio"
                          name={`${ids}-makes`}
                          value={m.value}
                          checked={makes === m.value}
                          onChange={() => {
                            setMakes(m.value)
                            touch('makes')
                            clearServer('makes')
                          }}
                        />
                        <span>{m.label}</span>
                      </label>
                    ))}
                  </div>
                  {fieldError('makes')}
                </fieldset>
                <div className="field full">
                  <label htmlFor={`${ids}-work`}>Link to your best work</label>
                  <input
                    id={`${ids}-work`}
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    placeholder="Optional · a reel, a post or a portfolio"
                    value={workUrl}
                    maxLength={300}
                    onChange={(e) => {
                      setWorkUrl(e.target.value)
                      clearServer('work_url')
                    }}
                    {...describe('work_url')}
                  />
                  {fieldError('work_url')}
                </div>
              </>
            ) : (
              <div className="field full">
                <label htmlFor={`${ids}-first`}>A place you’d review first</label>
                <input
                  id={`${ids}-first`}
                  placeholder="Optional · a place in your city"
                  value={firstPlace}
                  maxLength={120}
                  onChange={(e) => {
                    setFirstPlace(e.target.value)
                    clearServer('first_place')
                  }}
                  {...describe('first_place')}
                />
                {fieldError('first_place')}
              </div>
            )}
            {/* #4452 Q-A1-2: optional, never pre-ticked; the same words the forms use. */}
            <label className="field full consent-box">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{' '}
              Send me occasional emails from Mingla. Unsubscribe anytime.
            </label>
            {/* #4452 §2.2: extra questions from a form go in the details step. */}
            {detailsSlot}
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
        {isHost || !copy ? (
          <div>
            <h1 className="sched-title" id={`${ids}-title`}>
              Grab 20 minutes <em>with Mingla.</em>
            </h1>
            <p className="lead">Pick a time. You’ll get a calendar invite with a video link.</p>
          </div>
        ) : (
          <div>
            <span className="pill aud">{copy.pill}</span>
            <h1 className="sched-title" id={`${ids}-title`}>
              Talk to the <em>{copy.team}</em>
            </h1>
            <p className="lead">{copy.lead}</p>
            <ul className="covers">
              {copy.covers.map((line, index) => (
                <li key={line}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="panel">{panel}</div>
      </div>
    </section>
  )
}
