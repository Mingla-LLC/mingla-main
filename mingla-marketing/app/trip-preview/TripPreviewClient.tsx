'use client'
// ISSUE-1005 — the trip rendered as a FAITHFUL replica of the real Mingla trip
// page. Matches @mingla/offering-rendering's TripOfferingBody design tokens (bg
// #0c0e12, accent #ff8a3b, Inter, hero 900, date/duration pills, day-by-day
// spine, included/excluded chips, reserve box radius 18) — not the marketing
// theme. The publish CTA stays DEVICE-AWARE (desktop → business web, mobile →
// app). ?sample=1 renders sample content without a real run.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchTripPreview, type TripPreviewRender } from '@/lib/growth-tools-submit'
import { detectClientPlatform } from '@/lib/device-platform'
import { BUSINESS_ONELINK_URL, BUSINESS_WEB_URL } from '@/lib/store-links'

// Design tokens duplicated from packages/offering-rendering/designTokens.ts.
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
  moss: '#7bb28a',
  inverse: '#0c0e12',
}

const SAMPLE: TripPreviewRender = {
  kind: 'trip',
  title: 'Marrakech Long Weekend — Riads, Souks & the Atlas',
  tagline:
    'Four days of colour: a hidden-courtyard riad, a sunrise camel ride in the Agafay, a rooftop dinner over the medina, and a day in the Atlas foothills — all handled, all yours.',
  cover_url: '',
  destination: 'Marrakech, Morocco',
  departure: 'London',
  date_range: 'Oct 16 – Oct 20',
  nights: 4,
  days: 5,
  group_size: 10,
  price_per_person: 640,
  currency: 'GBP',
  vibe_tags: ['Riad stays', 'Souks', 'Atlas Mountains', 'Foodie', 'Golden hour'],
  why_go: [
    'A hand-picked riad with a courtyard pool, steps from Jemaa el-Fnaa',
    'Sunrise camel trek in the Agafay desert',
    'A guided souk crawl that skips the tourist traps',
    'A day trip to the Ourika Valley in the Atlas foothills',
  ],
  best_for: ['Friend groups', 'Milestone birthday', 'First-time Morocco'],
  included: ['4 nights riad', 'Airport transfers', 'Daily breakfast', 'Guided souk tour', 'Atlas day trip'],
  excluded: ['Flights', 'Travel insurance', 'Lunches & dinners'],
  itinerary: [
    { day: 1, title: 'Arrival & the medina', summary: 'Land, settle into the riad, and ease in with a rooftop dinner over the old town.', stay: 'Riad El Fenn', activities: ['Rooftop welcome dinner'] },
    { day: 2, title: 'Souks & palaces', summary: 'A guided crawl through the souks, then the Bahia Palace and a hammam to wind down.', stay: 'Riad El Fenn', activities: ['Guided souk tour', 'Bahia Palace'] },
    { day: 3, title: 'The Agafay desert', summary: 'Sunrise camel ride, lunch under the stars, back for a lazy afternoon by the pool.', stay: 'Riad El Fenn', activities: ['Sunrise camel trek'] },
    { day: 4, title: 'Atlas foothills', summary: 'A day trip to the Ourika Valley — waterfalls, a Berber village lunch, and mountain air.', stay: 'Riad El Fenn', activities: ['Ourika Valley day trip'] },
    { day: 5, title: 'Slow morning & home', summary: 'One last mint tea on the roof before the transfer to the airport.', stay: '', activities: [] },
  ],
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}

export function TripPreviewClient() {
  const params = useSearchParams()
  const runId = params.get('run_id') ?? ''
  const sample = params.get('sample') === '1'
  const [render, setRender] = useState<TripPreviewRender | null>(sample ? SAMPLE : null)
  const [failed, setFailed] = useState(false)

  const [publishHref, setPublishHref] = useState(BUSINESS_WEB_URL)
  useEffect(() => {
    const platform = detectClientPlatform()
    if (platform === 'ios' || platform === 'android') {
      setPublishHref(`${BUSINESS_ONELINK_URL}?pid=tool_trips&c=tool_trips`)
    }
  }, [])

  useEffect(() => {
    if (sample) return
    let alive = true
    if (!runId) {
      setFailed(true)
      return
    }
    fetchTripPreview(runId).then((res) => {
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
          <a href="/tools/trips" style={{ display: 'inline-flex', marginTop: 16, minHeight: 44, alignItems: 'center', padding: '0 24px', borderRadius: 999, background: T.accent, color: T.inverse, fontWeight: 700, textDecoration: 'none' }}>
            Back to the quoter
          </a>
        </div>
      </div>
    )
  }
  if (!render) return <div style={{ minHeight: '100vh', background: T.bg }} />

  const cur = render.currency || 'USD'
  const durationLabel = `${render.nights} night${render.nights === 1 ? '' : 's'} · ${render.days} day${render.days === 1 ? '' : 's'}`
  const routeLabel = [render.departure, render.destination].filter(Boolean).join(' → ')
  const priceLabel = render.price_per_person > 0 ? money(render.price_per_person, cur) : 'Priced on request'

  // The reserve box (§10) — a faithful static render of the real one.
  const reserveBox = (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, color: T.text3, textTransform: 'uppercase', letterSpacing: 1 }}>From</p>
          <p style={{ fontSize: 26, fontWeight: 900, color: T.text, lineHeight: 1.1 }}>{priceLabel}</p>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 2 }}>per person</p>
        </div>
        {render.group_size > 0 ? (
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: T.text2 }}>{render.group_size} spots</p>
            <p style={{ fontSize: 12, color: T.text3 }}>group trip</p>
          </div>
        ) : null}
      </div>
      <div style={{ marginTop: 14, height: 46, borderRadius: 999, background: T.accent, color: T.inverse, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 800 }}>
        Reserve your spot
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, color: T.text3 }}>
        <span aria-hidden="true">🔒</span>
        <span>Deposit or pay in full · pay-over-time available</span>
      </div>
      <p style={{ marginTop: 10, textAlign: 'center', fontSize: 11, color: T.text3 }}>Preview — this is how your trip looks on Mingla.</p>
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
          {/* Cover-media banner — the auto cover is a placeholder; on Mingla the
              organiser adds their own photo/GIF/video. Centered on the cover. */}
          <div style={{ position: 'absolute', insetInline: 0, top: '34%', display: 'flex', justifyContent: 'center', padding: '0 16px', pointerEvents: 'none' }}>
            <div style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 999, background: 'rgba(12,14,18,0.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: `1px solid ${T.accentBorder}`, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', maxWidth: '100%' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.8" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>
                Upload your own photo, GIF or video on Mingla
              </span>
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', insetInline: 0, bottom: 0, padding: '0 24px 28px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {render.date_range ? (
              <p style={{ fontSize: 12, fontWeight: 900, letterSpacing: 1.8, textTransform: 'uppercase', color: T.text, marginBottom: 10 }}>
                {render.date_range}{durationLabel ? ` · ${durationLabel}` : ''}
              </p>
            ) : null}
            <h1 style={{ fontSize: 'clamp(2rem, 6vw, 44px)', lineHeight: 1.06, fontWeight: 900, letterSpacing: '-1px', color: T.text, margin: 0 }}>
              {render.title}
            </h1>
          </div>
        </div>
      </div>

      {/* Body — desktop two-column (body + sticky reserve panel), 1-col on mobile */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }} className="mt-6 grid gap-8 md:grid-cols-[1fr_320px]">
        <div>
          {/* meta card (accent wash): dates · duration · route */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: T.accentWash, border: `1px solid ${T.accentBorder}`, borderRadius: 16, padding: '12px 14px' }}>
            <span aria-hidden="true" style={{ fontSize: 18, fontWeight: 900, color: T.accent }}>◆</span>
            <span>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 800, letterSpacing: '-0.2px', color: T.text }}>
                {[render.date_range, durationLabel].filter(Boolean).join(' · ')}
              </span>
              {routeLabel ? (
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginTop: 2, color: T.text2 }}>{routeLabel}</span>
              ) : null}
            </span>
          </div>

          {/* vibe pills */}
          {render.vibe_tags.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {render.vibe_tags.map((t) => (
                <span key={t} style={{ borderRadius: 999, background: T.card, border: `1px solid ${T.border}`, padding: '6px 12px', fontSize: 13, fontWeight: 700, color: T.text2 }}>{t}</span>
              ))}
            </div>
          ) : null}

          {/* About */}
          {render.tagline || render.why_go.length > 0 ? (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', marginBottom: 12, color: T.text }}>About this trip</h2>
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

          {/* Day-by-day itinerary spine */}
          {render.itinerary.length > 0 ? (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', marginBottom: 12, color: T.text }}>Day by day</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {render.itinerary.map((d) => (
                  <div key={d.day} style={{ display: 'flex', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <span style={{ width: 30, height: 30, borderRadius: 999, background: T.accentWash, border: `1px solid ${T.accentBorder}`, color: T.accent, fontSize: 13, fontWeight: 900, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{d.day}</span>
                      <span style={{ flex: 1, width: 1, background: T.border, marginTop: 4 }} aria-hidden="true" />
                    </div>
                    <div style={{ paddingBottom: 8, minWidth: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{d.title}</p>
                      {d.summary ? <p style={{ fontSize: 14, lineHeight: '20px', marginTop: 3, color: T.text2 }}>{d.summary}</p> : null}
                      {(d.stay || d.activities.length > 0) ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {d.stay ? (
                            <span style={{ borderRadius: 999, background: T.card, border: `1px solid ${T.border}`, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: T.text2 }}>🛏 {d.stay}</span>
                          ) : null}
                          {d.activities.map((a) => (
                            <span key={a} style={{ borderRadius: 999, background: T.accentWash, border: `1px solid ${T.accentBorder}`, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: T.accent }}>◆ {a}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* What's included / not included */}
          {(render.included.length > 0 || render.excluded.length > 0) ? (
            <section style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', marginBottom: 12, color: T.text }}>What’s included</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {render.included.map((i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 14, color: T.text }}>
                    <span aria-hidden="true" style={{ color: T.moss, fontWeight: 900 }}>✓</span>
                    <span>{i}</span>
                  </div>
                ))}
                {render.excluded.map((i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 14, color: T.text3 }}>
                    <span aria-hidden="true" style={{ fontWeight: 900 }}>✕</span>
                    <span>{i}</span>
                  </div>
                ))}
              </div>
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

          {/* Reserve — inline on mobile, hidden on desktop (sticky panel owns it) */}
          <section style={{ marginTop: 24 }} className="md:hidden">
            <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.3px', marginBottom: 12, color: T.text }}>Reserve</h2>
            {reserveBox}
          </section>
        </div>

        {/* desktop sticky reserve panel */}
        <aside className="hidden md:block">
          <div style={{ position: 'sticky', top: 24 }}>{reserveBox}</div>
        </aside>
      </div>

      {/* Publish — device-aware: desktop → business web, mobile → the app */}
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ marginTop: 40, borderRadius: 16, background: T.card, border: `1px solid ${T.border}`, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 20, fontWeight: 800, color: T.text }}>Ready to publish this?</p>
          <p style={{ margin: '8px auto 0', maxWidth: 440, fontSize: 14, color: T.text2 }}>
            List it on Mingla and give your travellers a real place to book — checkout, deposits and
            pay-over-time built in.
          </p>
          <a href={publishHref} style={{ display: 'inline-flex', marginTop: 16, minHeight: 44, alignItems: 'center', padding: '0 24px', borderRadius: 999, background: T.accent, color: T.inverse, fontWeight: 800, textDecoration: 'none' }}>
            List it on Mingla
          </a>
        </div>
      </div>
    </div>
  )
}
