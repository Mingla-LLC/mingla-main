'use client'

// #4452 §6.7 — the full-report template for the four free tools (design ch. 4d,
// approved from four real reports). The site nav above (logo pill, call
// button) comes from the tools layout. This file holds the frame and the
// shared parts: the header, the Night-field hero slot, the section shell (a
// serif heading with its italic half; `data-section` carries the baseline
// heading the order guard checks), fixes, factors, the bottom line, bars drawn
// to scale, the offer card, the two-button action bar and the share links.
//
// Honesty (§6.7): every figure carries a source line (their answers, Google or
// live research), and a missing value hides its row instead of showing a zero.

import { useEffect, useState, type ReactNode } from 'react'
import './tools.css'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import { shareLink } from './share-link'

export type ReportTool = 'venues' | 'events' | 'trips' | 'experiences'

const TOOL_PATH: Record<ReportTool, string> = { venues: '/tools/venues', events: '/tools/events', trips: '/tools/trips', experiences: '/tools/pricing' }
const TOOL_CAMPAIGN = { venues: 'tool_venues', events: 'tool_events', trips: 'tool_trips', experiences: 'tool_pricing' } as const
/** §5.10: the host call goes to /schedule?icp=<icp>. */
const TOOL_ICP: Record<ReportTool, string> = { venues: 'restaurants', events: 'events', trips: 'trips', experiences: 'experiences' }

/** Currency without decimals for big numbers, with them for small non-integers; never throws. */
export function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: n < 100 && !Number.isInteger(n) ? 2 : 0,
    }).format(n)
  } catch {
    return `${currency} ${Math.round(n)}`
  }
}

/** "Angus Barn" → ["Angus", "Barn."]: the design's serif title with its italic half. */
export function splitTitle(title: string, italicWords = 1): [string, string] {
  const words = title.trim().split(/\s+/)
  if (words.length <= italicWords) return ['', /[.!?…]$/.test(title.trim()) ? title.trim() : `${title.trim()}.`]
  const tail = words.slice(-italicWords).join(' ')
  return [words.slice(0, -italicWords).join(' '), /[.!?…]$/.test(tail) ? tail : `${tail}.`]
}

/** The report's date line ("16 Aug 2026"), from the run's own timestamp only. */
export function reportDate(iso?: string): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms))
}

export function ReportFrame({ tool, kick, title, titleItalicWords = 1, sub, hero, children, offer, actionLine, runId, before }: {
  tool: ReportTool
  kick: string
  title: string
  titleItalicWords?: number
  sub?: string
  /** The Night-field hero (or a cover), placed under the header. */
  hero: ReactNode
  children: ReactNode
  offer: ReactNode
  actionLine: string
  runId: string
  /** Something above the header (the trips cover replaces the header). */
  before?: ReactNode
}) {
  const [plain, em] = splitTitle(title, titleItalicWords)
  return (
    <article className="rp" data-report={tool}>
      {before ?? (
        <header className="rhead">
          <span className="rkick">{kick}</span>
          <h1>{plain ? `${plain} ` : ''}<em>{em}</em></h1>
          {sub ? <span className="sub">{sub}</span> : null}
        </header>
      )}
      {hero}
      {children}
      <div className="rsec" style={{ paddingTop: 0 }} data-offer="">{offer}</div>
      <ActionBar tool={tool} runId={runId} line={actionLine} />
      <ReportFoot tool={tool} />
    </article>
  )
}

/** One report section: the serif heading (plain + italic) and its body. */
export function RSec({ id, h, em, isNew, lede, children }: {
  /** The baseline heading this section had before the redesign (the order guard's key). */
  id: string
  h: string
  em: string
  /** "In the report data, not shown before" (§6.7 newly rendered data). */
  isNew?: boolean
  lede?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rsec" data-section={id}>
      <h2>{h} <em>{em}</em>{isNew ? <span className="rp-newtag">New</span> : null}</h2>
      {lede ? <p className="lede">{lede}</p> : null}
      {children}
    </section>
  )
}

/** The design's source line under a figure: where it came from. */
export function Source({ from }: { from: Array<'answers' | 'google' | 'research' | 'mingla' | 'site'> }) {
  const words = { answers: 'your answers', google: 'Google', research: 'live research', mingla: 'Mingla’s own data', site: 'your live website' }
  return <p className="src">From {from.map((f) => words[f]).join(' and ')}.</p>
}

export interface FixItem { title: string; body?: string; why?: string; upside?: string; tags: Array<{ label: string; hot?: boolean }> }

const EFFORT: Record<string, string> = { this_week: 'This week', this_month: 'This month', project: 'Bigger project' }
export const effortLabel = (e: string | undefined): string | null => (e ? EFFORT[e] ?? null : null)

export function Fixes({ items }: { items: FixItem[] }) {
  return (
    <ol className="fixes" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((f, i) => (
        <li key={`${f.title}-${i}`} className="fix3">
          <span className="n" aria-hidden="true">{i + 1}</span>
          <div>
            <b>{f.title}</b>
            {f.body ? <p>{f.body}</p> : null}
            {f.why ? <div className="howto"><span>Why: {f.why}</span></div> : null}
            {f.upside ? <div className="howto"><span>Upside: {f.upside}</span></div> : null}
          </div>
          <div className="tags">{f.tags.map((t) => <i key={t.label} className={t.hot ? 'hot' : undefined}>{t.label}</i>)}</div>
        </li>
      ))}
    </ol>
  )
}

export function Factors({ items }: { items: Array<{ label: string; status: 'help' | 'watch' | 'hurt'; detail: string }> }) {
  const word = { help: 'Helps', watch: 'Watch', hurt: 'Hurts' }
  return (
    <div className="facts2">
      {items.map((f) => (
        <div key={f.label} className={`fact ${f.status}`}>
          <b><i>{word[f.status] ?? 'Watch'}</i>{f.label}</b>
          {f.detail}
        </div>
      ))}
    </div>
  )
}

/** "The bottom line": the decision first, then the best move and the risk. */
export function BottomLine({ children, best, watch }: { children: ReactNode; best?: string; watch?: string }) {
  return (
    <div className="bl">
      <p>{children}</p>
      {best || watch ? (
        <div className="two2">
          {best ? <div><span>Best move</span>{best}</div> : null}
          {watch ? <div><span>Watch out for</span>{watch}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Bars drawn to scale (design cmpbars): "me" is orange, "rec" is ink. */
export function ScaleBars({ rows, format }: { rows: Array<{ label: ReactNode; value: number; kind?: 'me' | 'rec'; note?: string }>; format: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="rcard cmpbars">
      {rows.map((r, i) => (
        <div key={i} className={`r${r.kind ? ` ${r.kind}` : ''}`}>
          <span>{r.kind ? <b>{r.label}</b> : r.label}{r.note ? <><br /><small className="src2">{r.note}</small></> : null}</span>
          <span className="bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} /></span>
          <span className="v">{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function WeatherCard({ weather }: { weather: { summary: string; impact?: string; kind?: string } }) {
  const badge = weather.kind === 'forecast' ? 'Forecast' : weather.kind === 'climate_normal' ? 'Typical for this date' : 'Seasonal'
  return (
    <div className="rcard">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>Weather</b><span className="chip2">{badge}</span></div>
      <div style={{ fontSize: 14, color: '#111110' }}>{weather.summary}</div>
      {weather.impact ? <div style={{ fontSize: 13 }}>{weather.impact}</div> : null}
      <Source from={['research']} />
    </div>
  )
}

/** The existing offer card, in the design's look. */
export function Offer({ title, body, children }: { title: ReactNode; body: ReactNode; children?: ReactNode }) {
  return (
    <div className="offer">
      <b>{title}</b>
      <p>{body}</p>
      {children ? <div className="tp-actions" style={{ marginTop: 6 }}>{children}</div> : null}
    </div>
  )
}

/** The two-button action bar (§5.10, host bar): Get Mingla Host and Book a 20-minute call. */
export function ActionBar({ tool, runId, line }: { tool: ReportTool; runId: string; line: string }) {
  return (
    <div className="rbar" data-action-bar="">
      <div>
        <h2>Want this done <em>for you?</em></h2>
        <p>{line}</p>
      </div>
      <div className="bb">
        <DeviceLink
          surface="host"
          attribution={toolAttribution(TOOL_CAMPAIGN[tool])}
          onActivate={() => captureMarketing('tool_gate_app_click', { tool, run_id: runId, location: 'action_bar' })}
          className="a1"
        >
          Get Mingla Host
        </DeviceLink>
        <a
          className="a2"
          href={`/schedule?icp=${TOOL_ICP[tool]}`}
          onClick={() => captureMarketing('tool_offer_cta_click', { tool, run_id: runId, cta: 'action_bar_call' })}
        >
          Book a 20-minute call
        </a>
      </div>
    </div>
  )
}

/** Share and re-check links (§6.7): "This link works for 30 days". */
export function ReportFoot({ tool }: { tool: ReportTool }) {
  const [shared, setShared] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [canShare, setCanShare] = useState(false)
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && (typeof navigator.share === 'function' || !!navigator.clipboard)) }, [])
  async function share() {
    try {
      if ((await shareLink('My Mingla report', window.location.href)) === 'copied') setShared('copied')
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setShared('failed')
    }
  }
  return (
    <footer className="rfoot">
      <span>This link works for 30 days.</span>
      <span className="lks">
        {canShare ? <button type="button" onClick={share}>Share this report</button> : null}
        <a href={TOOL_PATH[tool]}>Run it again</a>
        <span>Mingla, Raleigh NC</span>
      </span>
      {shared === 'copied' ? <span role="status">Link copied.</span> : shared === 'failed' ? <span role="alert">We couldn&rsquo;t share it. Copy the address instead.</span> : null}
    </footer>
  )
}

/** "You told us: …" for the situation the report was run for (their answers, shown back). */
export function ToldUs({ children }: { children: ReactNode }) {
  return <p className="told" data-told-us="">You told us: {children}</p>
}

/** The report page while the token-verified report loads. */
export function ReportLoading({ what }: { what: string }) {
  return (
    <div className="rp" aria-busy="true">
      <div className="rsec" style={{ justifyItems: 'center', textAlign: 'center', padding: '96px 16px' }}>
        <span className="tp-run" aria-hidden="true"><span className="d on" style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #111110', borderRightColor: 'transparent', display: 'block', animation: 'tp-spin .8s linear infinite' }} /></span>
        <p role="status">Loading your {what}…</p>
      </div>
    </div>
  )
}

/** The report page when the link is wrong or expired: what happened and what to do. */
export function ReportLinkInvalid({ tool, body, back }: { tool: ReportTool; body: string; back: string }) {
  return (
    <div className="rp">
      <div className="rsec" style={{ padding: '64px 16px' }}>
        <div className="rcard" style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center', justifyItems: 'center' }}>
          <h2 style={{ fontFamily: 'var(--tp-serif)', fontSize: 34, lineHeight: 1.05, color: '#111110' }}>This link isn&rsquo;t <em>valid.</em></h2>
          <p>{body}</p>
          <a className="tp-go" style={{ width: 'auto' }} href={TOOL_PATH[tool]}>{back}</a>
        </div>
      </div>
    </div>
  )
}
