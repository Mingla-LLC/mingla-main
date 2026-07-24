'use client'
// ISSUE-1105 — the event rendered as a FAITHFUL replica of the real Mingla event
// page. Matches @mingla/offering-rendering's EventOfferingBody design tokens
// (bg #0c0e12, accent #ff8a3b, Inter, hero 900/44, date-row card, radius-999
// pills, About section, inline Tickets box radius 18) — not the marketing theme.
// The publish CTA stays DEVICE-AWARE (desktop → business web, mobile → app).
// ?sample=1 renders sample content without a real run.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchEventPreview, type EventPreviewRender } from '@/lib/growth-tools-submit'
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_ONELINK_URL, BUSINESS_WEB_URL } from '@/lib/store-links'

// Design tokens duplicated from packages/offering-rendering/designTokens.ts — the
// exact values the real event page renders with.
const T = {
  bg: '#0c0e12',
  text: '#ffffff',
  text2: 'rgba(255,255,255,0.72)',
  text3: 'rgba(255,255,255,0.48)',
  accent: '#ff8a3b',
  accentWash: 'rgba(255,138,59,0.16)',
  accentBorder: 'rgba(255,138,59,0.32)',
  card: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.10)',
  inverse: '#0c0e12',
}

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

function fullDate(iso: string, time: string): { line: string; sub: string } {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(ms)) return { line: iso, sub: '' }
  const line = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(ms))
  return { line, sub: time ? `Doors ${time}` : '' }
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
      <div style={{ minHeight: '100vh', background: T.bg, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', color: T.text }}>
        <div>
          <p style={{ fontSize: 22, fontWeight: 800 }}>This preview isn’t available</p>
          <a href="/tools/events" style={{ display: 'inline-flex', marginTop: 16, minHeight: 44, alignItems: 'center', padding: '0 24px', borderRadius: 999, background: T.accent, color: T.inverse, fontWeight: 700, textDecoration: 'none' }}>
            Back to the predictor
          </a>
        </div>
      </div>
    )
  }
  if (!render) return <div style={{ minHeight: '100vh', background: T.bg }} />

  const isPaid = !!render.ticket_price && render.ticket_price > 0
  const priceLabel = isPaid ? money(render.ticket_price as number, render.currency || 'USD') : 'Free'
  const d = fullDate(render.date, render.start_time)

  // The inline Tickets box (section 5) — a faithful static render of the real one.
  const ticketBox = (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{isPaid ? 'General admission' : 'RSVP'}</p>
          <p style={{ fontSize: 13, lineHeight: '18px', marginTop: 3, color: T.text2 }}>
            {isPaid ? 'Standard entry' : 'Free — reserve your spot'}
          </p>
        </div>
        <p style={{ fontSize: 15, fontWeight: 900, color: T.accent, whiteSpace: 'nowrap' }}>{priceLabel}</p>
      </div>
      {/* stepper (visual only in the preview) */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        <span style={{ width: 34, height: 34, borderRadius: 999, display: 'grid', placeItems: 'center', background: T.card, border: `1px solid ${T.border}`, color: T.text3, fontSize: 20, fontWeight: 900 }}>−</span>
        <span style={{ minWidth: 20, textAlign: 'center', fontSize: 16, fontWeight: 800, color: T.text }}>0</span>
        <span style={{ width: 34, height: 34, borderRadius: 999, display: 'grid', placeItems: 'center', background: T.accent, color: T.inverse, fontSize: 20, fontWeight: 900 }}>+</span>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text2 }}>Total</span>
        <span style={{ fontSize: 15, fontWeight: 900, color: T.text }}>{money(0, render.currency || 'USD')}</span>
      </div>
      <div style={{ marginTop: 12, height: 46, borderRadius: 999, background: T.accent, color: T.inverse, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 800 }}>
        {isPaid ? 'Get tickets' : 'RSVP'}
      </div>
      <p style={{ marginTop: 8, textAlign: 'center', fontSize: 11, color: T.text3 }}>Preview — this is how your event looks on Mingla.</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, paddingBottom: 64 }}>
      {/* (1) Cover hero — pinned cover + eyebrow + heavy 900 title */}
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'relative', width: '100%', height: 'min(52vh, 520px)', minHeight: 300, overflow: 'hidden' }}>
          {render.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={render.cover_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: `radial-gradient(120% 120% at 20% 10%, ${T.accentWash} 0%, ${T.bg} 60%)` }} />
          )}
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(12,14,18,0.1) 0%, rgba(12,14,18,0.55) 55%, ${T.bg} 100%)` }} />
        </div>
        <div style={{ position: 'absolute', insetInline: 0, bottom: 0, padding: '0 24px 28px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {d.line ? (
              <p style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.8, textTransform: 'uppercase', color: T.text, marginBottom: 10 }}>
                {d.line}
              </p>
            ) : null}
            <h1 style={{ fontSize: 'clamp(2rem, 6vw, 44px)', lineHeight: 1.06, fontWeight: 900, letterSpacing: '-1px', color: T.text, margin: 0 }}>
              {render.title}
            </h1>
          </div>
        </div>
      </div>

      {/* Body — desktop two-column (body + sticky ticket panel), 1-col on mobile */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }} className="mt-6 grid gap-8 md:grid-cols-[1fr_320px]">
        <div>
          {/* date-row card (accent wash) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: T.accentWash, border: `1px solid ${T.accentBorder}`, borderRadius: 16, padding: '12px 14px' }}>
            <span aria-hidden="true" style={{ fontSize: 18, fontWeight: 900, color: T.accent }}>◆</span>
            <span>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 800, letterSpacing: '-0.2px', color: T.text }}>{d.line}</span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 2, color: T.text2 }}>
                {[d.sub, render.venue_name, render.city].filter(Boolean).join(' · ')}
              </span>
            </span>
          </div>

          {/* pills (vibe tags) */}
          {render.vibe_tags.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {render.vibe_tags.map((t) => (
                <span key={t} style={{ borderRadius: 999, background: T.card, border: `1px solid ${T.border}`, padding: '6px 12px', fontSize: 13, fontWeight: 700, color: T.text2 }}>{t}</span>
              ))}
            </div>
          ) : null}

          {/* (7) About */}
          {render.tagline || render.why_go.length > 0 ? (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', marginBottom: 12, color: T.text }}>About</h2>
              {render.tagline ? <p style={{ fontSize: 16, lineHeight: '23px', color: T.text2 }}>{render.tagline}</p> : null}
              {render.why_go.length > 0 ? (
                <ul style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', padding: 0 }}>
                  {render.why_go.map((w) => (
                    <li key={w} style={{ display: 'flex', gap: 10, fontSize: 15, lineHeight: '22px', color: T.text }}>
                      <span aria-hidden="true" style={{ color: T.accent, marginTop: 1 }}>◆</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {/* Good for */}
          {render.best_for.length > 0 ? (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', marginBottom: 12, color: T.text }}>Good for</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {render.best_for.map((b) => (
                  <span key={b} style={{ borderRadius: 999, background: T.accentWash, border: `1px solid ${T.accentBorder}`, padding: '6px 12px', fontSize: 13, fontWeight: 700, color: T.accent }}>{b}</span>
                ))}
              </div>
            </section>
          ) : null}

          {/* (5) Tickets — inline on mobile, hidden on desktop (sticky panel owns it) */}
          <section style={{ marginTop: 24 }} className="md:hidden">
            <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', marginBottom: 12, color: T.text }}>Tickets</h2>
            {ticketBox}
          </section>
        </div>

        {/* desktop sticky ticket panel */}
        <aside className="hidden md:block">
          <div style={{ position: 'sticky', top: 24 }}>{ticketBox}</div>
        </aside>
      </div>

      {/* Publish — device-aware: desktop → business web, mobile → the app */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ marginTop: 40, borderRadius: 16, background: T.card, border: `1px solid ${T.border}`, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 20, fontWeight: 800, color: T.text }}>Ready to publish this?</p>
          <p style={{ margin: '8px auto 0', maxWidth: 420, fontSize: 14, color: T.text2 }}>
            List it on Mingla and we’ll put it in front of people planning their week.
          </p>
          <a href={publishHref} style={{ display: 'inline-flex', marginTop: 16, minHeight: 44, alignItems: 'center', padding: '0 24px', borderRadius: 999, background: T.accent, color: T.inverse, fontWeight: 800, textDecoration: 'none' }}>
            List it on Mingla
          </a>
        </div>
      </div>
    </div>
  )
}
