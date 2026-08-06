'use client'
// #1086 [Standalone scheduler] — the day → time booking flow.
//
// A dedicated page (not the inline report picker) so leads from ANY funnel —
// the grader report, a homepage CTA, a cold email, an ad — can book a Mingla
// call at one URL. Reads context from the query string (?venue / ?report_url /
// ?source, optional name/email prefill), lists a full MONTH of availability
// from `growth-tools-book` grouped by day, and books via the same edge fn
// (Google Calendar + Meet invite; confirmation emails to both parties). Degrades
// to a mailto when the calendar is unconfigured or empty.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { captureMarketing } from '@/components/marketing/posthog-provider'
import { bookCall, fetchBookingSlots, type BookingSlot } from '@/lib/growth-tools-submit'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CALL_MAILTO =
  'mailto:seth@usemingla.com?subject=Book%20a%20call%20with%20Mingla'

// Locale-aware, stable at module scope. Day label doubles as the group key —
// across the booking window it is unique (weekday + month + day).
const dayLabelFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
})
const dayWeekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const dayDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
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
  event_url: string | null
}

export function ScheduleClient() {
  const params = useSearchParams()
  const venue = (params.get('venue') ?? '').slice(0, 120)
  const reportUrl = (params.get('report_url') ?? '').slice(0, 500)
  const source = (params.get('source') ?? 'direct').slice(0, 40)
  const reduceMotion = useReducedMotion()

  const [phase, setPhase] = useState<Phase>('loading')
  const [slots, setSlots] = useState<BookingSlot[]>([])
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [name, setName] = useState(params.get('name') ?? '')
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null)

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
    captureMarketing('tool_book_view', { source, venue: venue || undefined })
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const days = useMemo<Day[]>(() => {
    const map = new Map<string, Day>()
    for (const s of slots) {
      const date = new Date(s.start)
      const key = dayLabelFmt.format(date)
      const entry = map.get(key)
      if (entry) entry.slots.push(s)
      else map.set(key, { key, date, slots: [s] })
    }
    return [...map.values()]
  }, [slots])

  // Keep a valid day selected as the window changes.
  useEffect(() => {
    if (days.length === 0) return
    if (!selectedDayKey || !days.some((d) => d.key === selectedDayKey)) {
      setSelectedDayKey(days[0].key)
    }
  }, [days, selectedDayKey])

  const selectedDay = days.find((d) => d.key === selectedDayKey) ?? days[0] ?? null
  const emailValid = EMAIL_REGEX.test(email.trim())
  const canConfirm = !!selectedSlot && name.trim().length >= 2 && emailValid

  async function confirm() {
    if (!canConfirm || !selectedSlot) return
    setPhase('confirming')
    setError(null)
    const res = await bookCall({
      start: selectedSlot,
      name: name.trim(),
      email: email.trim(),
      venue: venue || undefined,
      report_url: reportUrl || undefined,
    })
    if (res.ok) {
      captureMarketing('tool_book_confirmed', {
        source,
        venue: venue || undefined,
        start: res.start,
      })
      setConfirmed({
        start: res.start,
        email: email.trim(),
        meet_url: res.meet_url,
        event_url: res.event_url,
      })
      setPhase('done')
      return
    }
    if (res.error === 'slot_taken') {
      setError('That time was just taken — here are the latest openings.')
      setSelectedSlot(null)
      void load(true) // refresh so the taken slot drops out
      return
    }
    if (res.error === 'booking_unconfigured') {
      setPhase('unavailable')
      return
    }
    setError('That didn’t go through — try again, or email us.')
    setPhase('ready')
  }

  // ── States ────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <Shell>
        <div className="grid place-items-center py-20 text-center">
          <div className="flex flex-col items-center gap-3">
            <span
              aria-hidden="true"
              className="size-6 animate-spin rounded-full border-2 border-warm/30 border-t-warm"
            />
            <p className="text-sm text-text-muted">Finding open times…</p>
          </div>
        </div>
      </Shell>
    )
  }

  if (phase === 'unavailable') {
    return (
      <Shell>
        <div className="rounded-md border border-divider-strong bg-parchment p-8 text-center">
          <p className="font-display text-2xl text-text-primary">Let’s find a time by email</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
            Online booking is taking a break right now. Email us and we’ll get a call on
            the calendar within the day.
          </p>
          <a
            href={CALL_MAILTO}
            className="mt-5 inline-flex min-h-11 items-center rounded-full bg-warm px-6 text-sm font-semibold text-white transition hover:bg-warm-hover focus-ring"
          >
            Email us to book
          </a>
        </div>
      </Shell>
    )
  }

  if (phase === 'done' && confirmed) {
    return (
      <Shell>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="rounded-md border border-divider-strong bg-parchment p-8 text-center"
        >
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-moss/15 text-2xl text-moss">
            ✓
          </div>
          <p className="mt-4 font-display text-[clamp(1.5rem,4vw,2rem)] text-text-primary">
            You’re booked in
          </p>
          <p className="mt-2 text-base text-text-secondary">
            <span className="font-semibold text-text-primary">
              {dayLabelFmt.format(new Date(confirmed.start))}
            </span>{' '}
            at{' '}
            <span className="font-semibold text-text-primary">
              {timeFmt.format(new Date(confirmed.start))}
            </span>
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-text-secondary">
            A confirmation and a calendar invite with a Google Meet link are on their way to{' '}
            <span className="font-semibold text-text-primary">{confirmed.email}</span>. See
            you then.
          </p>
          {confirmed.meet_url ? (
            <a
              href={confirmed.meet_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex min-h-11 items-center rounded-full bg-warm px-6 text-sm font-semibold text-white transition hover:bg-warm-hover focus-ring"
            >
              Join the Meet link
            </a>
          ) : null}
        </motion.div>
      </Shell>
    )
  }

  // 'ready' | 'confirming'
  return (
    <Shell>
      <div className="overflow-hidden rounded-md border border-divider-strong bg-parchment">
        {/* grid-cols-1 is load-bearing on mobile, not decorative: with no explicit
            track the single implicit column is `auto` = max-content, so the 28
            shrink-0 day buttons and the 2-up time grid size it to ~1769px. The
            wrapper is overflow-hidden, so the times get CLIPPED (not scrolled)
            and read as empty pills. Tailwind's grid-cols-1 emits
            repeat(1,minmax(0,1fr)) — the zero minimum the md: tracks already have. */}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,240px)_1fr]">
          {/* Day rail — a full month of open days, scrollable */}
          <div className="border-b border-divider-strong p-4 md:border-b-0 md:border-r md:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Pick a day
            </p>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1 md:max-h-[26rem] md:flex-col md:overflow-x-visible md:overflow-y-auto md:pb-0 md:pr-1">
              {days.map((d) => {
                const active = d.key === selectedDay?.key
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => {
                      setSelectedDayKey(d.key)
                      setSelectedSlot(null)
                    }}
                    className={cn(
                      'flex shrink-0 items-center justify-between gap-3 rounded-md border px-3.5 py-2.5 text-left transition focus-ring md:w-full',
                      active
                        ? 'border-warm bg-warm/10'
                        : 'border-divider-strong bg-white hover:border-warm/40 hover:bg-stripe',
                    )}
                    aria-pressed={active}
                  >
                    <span className="flex flex-col">
                      <span
                        className={cn(
                          'text-sm font-semibold',
                          active ? 'text-warm-ink' : 'text-text-primary',
                        )}
                      >
                        {dayWeekdayFmt.format(d.date)}
                      </span>
                      <span className="text-xs text-text-muted">{dayDateFmt.format(d.date)}</span>
                    </span>
                    <span className="hidden text-[0.7rem] font-medium text-text-muted md:inline">
                      {d.slots.length}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Times + details */}
          <div className="p-4 md:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
              Pick a time
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              {selectedDay ? dayLabelFmt.format(selectedDay.date) : ''} · times in your
              timezone · 20&nbsp;min
            </p>
            <div className="mt-3 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {selectedDay?.slots.map((s) => {
                const active = s.start === selectedSlot
                return (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => setSelectedSlot(s.start)}
                    className={cn(
                      'min-h-11 rounded-full border px-3 text-sm font-semibold transition focus-ring',
                      active
                        ? 'border-warm bg-warm text-white'
                        : 'border-divider-strong bg-white text-text-primary hover:border-warm/50 hover:bg-stripe',
                    )}
                    aria-pressed={active}
                  >
                    {timeFmt.format(new Date(s.start))}
                  </button>
                )
              })}
            </div>

            {/* Details — revealed once a time is chosen */}
            {selectedSlot ? (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="mt-5 border-t border-divider-strong pt-5"
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                    aria-label="Your name"
                    className="min-h-11 w-full min-w-0 flex-1 rounded-sm border border-divider-strong bg-white px-3 text-base text-text-primary placeholder:text-text-muted focus-ring"
                  />
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    aria-label="Your email"
                    placeholder="you@yourplace.com"
                    className="min-h-11 w-full min-w-0 flex-1 rounded-sm border border-divider-strong bg-white px-3 text-base text-text-primary placeholder:text-text-muted focus-ring"
                  />
                </div>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!canConfirm || phase === 'confirming'}
                  className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-warm px-6 text-sm font-semibold text-white transition hover:bg-warm-hover focus-ring disabled:opacity-60 sm:w-auto"
                >
                  {phase === 'confirming'
                    ? 'Booking…'
                    : `Confirm ${timeFmt.format(new Date(selectedSlot))}`}
                </button>
              </motion.div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Shell>
  )
}

// Header + framing shared by every state. Light card region flips to the
// theme-aware light tokens via data-theme; the page sits on the dark /schedule
// stage from schedule/layout.tsx.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14" data-theme="light">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-warm">
          Book a call
        </p>
        <h1 className="mt-2 font-display text-[clamp(1.8rem,5vw,2.6rem)] leading-tight text-white">
          Grab 20 minutes with Mingla
        </h1>
      </div>
      <div className="mt-8">{children}</div>
    </div>
  )
}
