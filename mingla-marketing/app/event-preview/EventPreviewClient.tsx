'use client'
// ISSUE-1100 — the event rendered as a real Mingla listing (not a mockup):
// a cover-image hero + the organiser's own details, laid out like a published
// Mingla event page. The publish CTA is DEVICE-AWARE — desktop lands on the
// business web dashboard to publish, mobile opens the app (fixes the bug where
// the raw install OneLink sent laptop users to the Mac App Store).
// ?sample=1 renders sample content for review without a real run.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchEventPreview, type EventPreviewRender } from '@/lib/growth-tools-submit'
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_ONELINK_URL, BUSINESS_WEB_URL } from '@/lib/store-links'

const SAMPLE: EventPreviewRender = {
  kind: 'event',
  title: 'Afrobeats Rooftop Summer Party with DJ Spinall',
  tagline:
    'London’s hottest Afrobeats night takes over Skylight Rooftop — golden-hour views, global-superstar sound, and the summer’s best crowd.',
  city: 'London',
  venue_name: 'Skylight Rooftop',
  category: 'Club night / DJ',
  date: '2026-08-15',
  start_time: '21:00',
  vibe_tags: ['Afrobeats', 'Rooftop Party', 'Summer Vibes', 'Club Night', 'DJ Spinall'],
  why_go: [
    'DJ Spinall headlining — a genuine global draw',
    'Open-air rooftop with skyline views at golden hour',
    'The city’s best-dressed Afrobeats crowd',
    'Limited capacity — an intimate, sell-out feel',
  ],
  best_for: ['Date night', 'Big group', 'Birthday'],
  cover_url: '',
  ticket_price: 25,
  currency: 'GBP',
}

function dateLabel(iso: string, time: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(ms)) return iso
  const d = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(ms))
  return time ? `${d} · ${time}` : d
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}

export function EventPreviewClient() {
  const params = useSearchParams()
  const runId = params.get('run_id') ?? ''
  const sample = params.get('sample') === '1'
  const [render, setRender] = useState<EventPreviewRender | null>(sample ? SAMPLE : null)
  const [failed, setFailed] = useState(false)

  // Device-aware publish target: default to the web dashboard (works on every
  // device); upgrade to the app OneLink on mobile after mount (no SSR mismatch).
  const [publishHref, setPublishHref] = useState(BUSINESS_WEB_URL)
  useEffect(() => {
    const platform = detectClientPlatform()
    if (platform === 'ios' || platform === 'android') {
      setPublishHref(`${BUSINESS_ONELINK_URL}?pid=tool_events&c=tool_events`)
    }
  }, [])

  useEffect(() => {
    if (sample) return
    let alive = true
    if (!runId) {
      setFailed(true)
      return
    }
    fetchEventPreview(runId).then((res) => {
      if (!alive) return
      if (res.ok) setRender(res.render)
      else setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [runId, sample])

  if (failed) {
    return (
      <div className="grid min-h-screen place-items-center bg-smoke px-6 text-center">
        <div>
          <p className="font-display text-2xl text-white">This preview isn’t available</p>
          <a href="/tools/events" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-warm px-6 text-sm font-semibold text-white">
            Back to the predictor
          </a>
        </div>
      </div>
    )
  }
  if (!render) return <div className="min-h-screen bg-smoke" />

  const priceLabel = !render.ticket_price || render.ticket_price <= 0
    ? 'Free'
    : money(render.ticket_price, render.currency || 'USD')
  const isPaid = !!render.ticket_price && render.ticket_price > 0

  return (
    <div className="min-h-screen bg-smoke pb-16 text-white">
      {/* Cover hero — a real photo makes it read like a published listing */}
      <div className="relative">
        <div className="relative h-[42vh] min-h-[280px] w-full overflow-hidden md:h-[52vh]">
          {render.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={render.cover_url} alt="" className="size-full object-cover" />
          ) : (
            <div className="size-full" style={{ background: 'radial-gradient(120% 120% at 20% 10%, rgba(235,120,37,0.4) 0%, #0b0b0d 60%)' }} />
          )}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(11,11,13,0.15) 0%, rgba(11,11,13,0.5) 55%, #0b0b0d 100%)' }} />
        </div>
        <div className="absolute inset-x-0 bottom-0 px-6 pb-6 md:px-10 md:pb-8">
          <div className="mx-auto max-w-3xl">
            <span className="inline-flex items-center rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/90 backdrop-blur">
              {render.category || 'Event'}
            </span>
            <h1 className="mt-3 font-display text-[clamp(1.9rem,5.5vw,3.2rem)] leading-[1.05] text-white drop-shadow">
              {render.title}
            </h1>
          </div>
        </div>
      </div>

      {/* Meta + body */}
      <div className="mx-auto max-w-3xl px-6 md:px-10">
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-warm md:text-base">{dateLabel(render.date, render.start_time)}</span>
          <span className="text-sm text-white/70">{[render.venue_name, render.city].filter(Boolean).join(' · ')}</span>
        </div>
        {render.tagline ? (
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/85 md:text-lg">{render.tagline}</p>
        ) : null}
        {render.vibe_tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {render.vibe_tags.map((t) => (
              <span key={t} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/85">{t}</span>
            ))}
          </div>
        ) : null}

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_260px]">
          <div>
            {render.why_go.length > 0 ? (
              <>
                <h2 className="font-display text-2xl text-white">Why you’ll want to be there</h2>
                <ul className="mt-4 space-y-3">
                  {render.why_go.map((w) => (
                    <li key={w} className="flex items-start gap-3 text-white/85">
                      <span aria-hidden="true" className="mt-1 shrink-0 text-warm">◆</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <aside className="h-max rounded-2xl border border-white/12 bg-white/[0.04] p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/55">Tickets</span>
              <span className="font-display text-2xl text-white">{priceLabel}</span>
            </div>
            {render.best_for.length > 0 ? (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Best for</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {render.best_for.map((b) => (
                    <span key={b} className="rounded-full border border-warm/40 bg-warm/10 px-3 py-1 text-xs font-semibold text-warm">{b}</span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-5 rounded-xl bg-warm px-4 py-3 text-center text-sm font-bold text-warm-ink">
              {isPaid ? 'Get tickets on Mingla' : 'RSVP on Mingla'}
            </div>
            <p className="mt-2 text-center text-[0.7rem] text-white/45">Preview — this is how your event looks on Mingla.</p>
          </aside>
        </div>

        {/* Publish — device-aware: desktop → business web, mobile → the app */}
        <div className="mt-12 rounded-2xl border border-white/12 bg-white/[0.04] p-6 text-center">
          <p className="font-display text-xl text-white">Ready to publish this?</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/70">
            List it on Mingla and we’ll put it in front of people planning their week.
          </p>
          <a
            href={publishHref}
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-warm px-6 text-sm font-semibold text-white transition hover:bg-warm-hover"
          >
            List it on Mingla
          </a>
        </div>
      </div>
    </div>
  )
}
