'use client'
// ISSUE-1004 — the event rendered as a polished Mingla listing. Fetches the
// run's saved listing copy (?run_id) and lays it out like a real Mingla event
// page — the "wizard" payoff the organiser sees before publishing on Mingla.
// ?sample=1 renders sample content for review without a real run.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchEventPreview, type EventPreviewRender } from '@/lib/growth-tools-submit'

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
}

function dateLabel(iso: string, time: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(ms)) return iso
  const d = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(ms))
  return time ? `${d} · ${time}` : d
}

export function EventPreviewClient() {
  const params = useSearchParams()
  const runId = params.get('run_id') ?? ''
  const sample = params.get('sample') === '1'
  const [render, setRender] = useState<EventPreviewRender | null>(sample ? SAMPLE : null)
  const [failed, setFailed] = useState(false)

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

  if (!render) {
    return <div className="min-h-screen bg-smoke" />
  }

  return (
    <div className="min-h-screen bg-smoke pb-16 text-white">
      {/* Hero */}
      <div
        className="relative overflow-hidden px-6 pb-10 pt-16 md:px-10 md:pt-24"
        style={{ background: 'radial-gradient(120% 120% at 15% 0%, rgba(235,120,37,0.32) 0%, rgba(11,11,13,0) 55%), #0b0b0d' }}
      >
        <div className="mx-auto max-w-3xl">
          <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80">
            {render.category || 'Event'}
          </span>
          <h1 className="mt-4 font-display text-[clamp(2rem,6vw,3.4rem)] leading-[1.05] text-white">
            {render.title}
          </h1>
          <p className="mt-3 text-sm font-semibold text-warm md:text-base">
            {dateLabel(render.date, render.start_time)}
          </p>
          <p className="text-sm text-white/70">
            {[render.venue_name, render.city].filter(Boolean).join(' · ')}
          </p>
          {render.tagline ? (
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/85 md:text-lg">
              {render.tagline}
            </p>
          ) : null}
          {render.vibe_tags.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {render.vibe_tags.map((t) => (
                <span key={t} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/85">{t}</span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto mt-10 max-w-3xl px-6 md:px-10">
        <div className="grid gap-8 md:grid-cols-[1fr_260px]">
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
            {render.best_for.length > 0 ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-white/55">Best for</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {render.best_for.map((b) => (
                    <span key={b} className="rounded-full border border-warm/40 bg-warm/10 px-3 py-1 text-xs font-semibold text-warm">{b}</span>
                  ))}
                </div>
              </>
            ) : null}
            <div className="mt-5 rounded-xl bg-warm px-4 py-3 text-center text-sm font-bold text-warm-ink">
              Get tickets on Mingla
            </div>
            <p className="mt-2 text-center text-[0.7rem] text-white/45">Preview — this is how your event looks on Mingla.</p>
          </aside>
        </div>

        <div className="mt-12 rounded-2xl border border-white/12 bg-white/[0.04] p-6 text-center">
          <p className="font-display text-xl text-white">Ready to publish this?</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-white/70">
            List your event on Mingla and we’ll put it in front of people planning their week.
          </p>
          <a
            href="https://biz.usemingla.com/ZSCW?pid=tool_events&c=tool_events"
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-warm px-6 text-sm font-semibold text-white transition hover:bg-warm-hover"
          >
            List it on Mingla
          </a>
        </div>
      </div>
    </div>
  )
}
