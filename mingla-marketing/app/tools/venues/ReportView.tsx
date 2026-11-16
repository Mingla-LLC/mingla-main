'use client'
// #1003 [Venue Website Grader — growth tools, test cut] — the full report.
//
// #4452 §6.7: redesigned on the paper report template (design ch. 4d, venueReport,
// approved from the real Angus Barn report). Every section the report rendered
// before is kept, in the same order (the order guard keys on `data-section`):
// your vibe card · site health check · Mingla already knows you · the grades ·
// your Google listing · what your customers say · your fixes · who's eating
// your Friday nights · you vs <competitor> · where you already win · how to
// outrank them · your homepage, redesigned · the offer. The hero is the Night
// field with the live screenshot and the score ring; the two-button action bar
// and the share links close it. Newly shown: `rewritten_hero` (the homepage
// words before and after, under the slider). The page only renders the
// token-verified full report (§6.4: the anonymous page gets the preview only).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import type { GraderCompetitionEffort, GraderReport, GraderScoreKey } from '@/lib/growth-tools-submit'
import { nextStepCta } from '@/lib/tools/scenarios'
import { effortLabel, Fixes, Offer, reportDate, ReportFrame, RSec, Source, ToldUs } from '../_template/ReportShell'

// #4137: the app CTA goes through the one CTA seam (DeviceLink): a phone gets the
// business OneLink with `?pid=tool_venues&c=tool_venues`; a computer the host web app.
const APP_GATE_ATTRIBUTION = toolAttribution('tool_venues')

const SCORE_ROWS: Array<{ key: GraderScoreKey; label: string }> = [
  { key: 'first_impression', label: 'First impression' },
  { key: 'findability', label: 'Findability' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'menu_offers', label: 'Menu & offers' },
  { key: 'occasion_signal', label: 'Occasion signal' },
]

const FOUND_VIA = { instagram: 'Instagram', whatsapp: 'WhatsApp', google_only: 'Google only' } as const

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function displayHost(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, '')
  } catch {
    return website
  }
}

const barColor = (v: number) => (v >= 80 ? '#16a34a' : v >= 60 ? '#eb7825' : '#dc2626')

/** #4452 §6.7 / §6.8: the homepage words before and after (data the report already has). */
function RewrittenHero({ rewritten }: { rewritten: { before_excerpt: string; after_copy: string } }) {
  return (
    <div className="ba2" data-rewritten-hero="">
      {rewritten.before_excerpt ? (
        <div className="b"><span className="lb2">Today</span>{rewritten.before_excerpt}</div>
      ) : null}
      {rewritten.after_copy ? (
        <div className="a"><span className="lb2">Rewritten by Mingla</span>{rewritten.after_copy}</div>
      ) : null}
    </div>
  )
}

// The before / after slider (design baSlider): the current site (before) is
// clipped over the redesign (after); drag anywhere, or use the range control
// (keyboard). The after side is the "after" screenshot, or (#4452 §6.8) the
// live preview page of this run, drawn at 1280 px and scaled to the frame.
function BeforeAfterSlider({
  before,
  after,
  afterFrame,
  host,
}: {
  before: string
  after: string | null
  /** #4452 §6.8: no after_url → the existing venue preview page, drawn live. */
  afterFrame?: string | null
  host: string
}) {
  const [pos, setPos] = useState(50)
  const [scale, setScale] = useState(0.5)
  const frameRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = frameRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1280))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={frameRef} className="bas" style={{ ['--p' as string]: `${pos}%` }} data-slider="">
      <div className="bas-after">
        {after ? (
          <img src={after} alt="Your homepage rebuilt in a Mingla template" draggable={false} />
        ) : afterFrame ? (
          // #4452 §6.8: the live preview page (same origin; its client needs scripts), scaled into the frame.
          <iframe
            src={afterFrame}
            title="Your homepage rebuilt in a Mingla template (live preview)"
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            loading="lazy"
            tabIndex={-1}
            style={{ transform: `scale(${scale})` }}
          />
        ) : null}
      </div>
      <div className="bas-before"><img src={before} alt={`Your site today, ${host}`} draggable={false} /></div>
      <div className="bas-line" aria-hidden="true"><span>⇄</span></div>
      <span className="bas-l">Today</span>
      <span className="bas-r">Mingla</span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Compare your site today with the redesign"
      />
    </div>
  )
}

export function ReportView({ report, runId }: { report: GraderReport; runId: string }) {
  // Deep-link to the standalone scheduling page, carrying venue + source. The
  // report_url is added after mount (window is server-undefined) — starting
  // without it keeps the SSR and first client render identical.
  const [bookHref, setBookHref] = useState(
    () => `/schedule?${new URLSearchParams({ venue: report.venue.name, source: 'venue_grader' }).toString()}`,
  )
  useEffect(() => {
    setBookHref(
      `/schedule?${new URLSearchParams({
        venue: report.venue.name,
        source: 'venue_grader',
        report_url: window.location.href,
      }).toString()}`,
    )
  }, [report.venue.name])

  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'venues', run_id: runId })
    captureMarketing('tool_offer_view', { tool: 'venues', run_id: runId })
  }, [runId])

  const situation = report.followup?.reason === 'no_website' ? report.followup : null
  const host = report.venue.website ? displayHost(report.venue.website) : ''
  const vibes = report.vibe_card.vibes.slice(0, 3)
  const photos = (report.match.photo_urls ?? []).slice(0, 3)
  const competition = report.competition
  const competitors = (competition?.competitors ?? []).slice(0, 4)
  const playbook = (competition?.outrank_playbook ?? []).slice(0, 5)
  const checks = report.site_signals?.checks ?? []
  const passCount = checks.filter((c) => c.status === 'pass').length
  const warnCount = checks.filter((c) => c.status === 'warn').length
  const failCount = checks.filter((c) => c.status === 'fail').length
  const praise = report.review_themes?.praise ?? []
  const complaints = report.review_themes?.complaints ?? []
  const headToHead = report.head_to_head
  const hhRows = (headToHead?.rows ?? []).slice(0, 6)
  const whereYouWin = (report.where_you_win ?? []).slice(0, 3)
  const offerFrom = report.offer?.per_person_from ?? '$3.99'
  const overall = clampScore(report.scores.overall)
  // Prefer the live ScreenshotOne capture; fall back to the site's og:image.
  const siteImage = report.screenshot.image_url || report.screenshot.og_image_url || null
  const afterImage = report.screenshot.after_url || null
  // #4452 §6.8: without after_url the after side is the live preview page of this run.
  const afterFrame = !afterImage && runId ? `/venue-preview?run_id=${encodeURIComponent(runId)}` : null
  const rewritten = report.rewritten_hero && (report.rewritten_hero.before_excerpt || report.rewritten_hero.after_copy) ? report.rewritten_hero : null
  const topFix = report.fixes[0]

  return (
    <ReportFrame
      tool="venues"
      runId={runId}
      kick={['Venue website grader', 'full report', reportDate(report.meta?.generated_at)].filter(Boolean).join(' · ')}
      title={report.venue.name}
      sub={[report.venue.city, host || (situation ? 'No website on Google' : '')].filter(Boolean).join(' · ')}
      actionLine={situation ? 'Make your free page in Mingla Host, or set it up with the team.' : 'Fix all of this in Mingla Host, or talk it through with the team.'}
      hero={(
        <div className="rhero" data-hero="venues">
          <div style={{ display: 'grid', gap: 14 }}>
            {siteImage ? (
              <div className="rp-shot" style={{ backgroundImage: `url(${JSON.stringify(siteImage)})` }} role="img" aria-label={`Live screenshot of ${host}`}>
                <span>Your site right now · {host}</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <span className="rkick">{situation ? 'No website on Google' : 'No preview of your site'}</span>
                <p className="verdict">{situation ? <>People can&rsquo;t book you from a search <em>yet.</em></> : <>We graded the live site <em>directly.</em></>}</p>
              </div>
            )}
            {topFix ? <p>Start here: <b style={{ color: '#f5f4f0' }}>{topFix.title}</b></p> : null}
            {situation ? <ToldUs>people find you on {FOUND_VIA[situation.found_via]}.</ToldUs> : null}
            {report.meta?.fetch_failed && !situation ? (
              <p className="src">Parts of the site didn&rsquo;t load when we visited; some grades reflect that (which is itself a finding).</p>
            ) : null}
          </div>
          <div className="rp-grade">
            <div className="rp-ring" style={{ ['--v' as string]: overall }} role="img" aria-label={`Overall grade ${report.scores.grade}, ${overall} out of 100`}>
              <div><b>{report.scores.grade}</b><span>{overall} / 100</span></div>
            </div>
            <small>
              Overall website score.
              {report.percentile ? ` Better than ${clampScore(report.percentile.better_than_pct)}% of ${report.percentile.sample.toLocaleString('en')} scored venues in ${report.percentile.city}.` : ''}
            </small>
            <span className="src">{situation ? 'From Google and live research.' : 'From your live website and live research.'}</span>
          </div>
        </div>
      )}
      offer={(
        <Offer
          title={<>We drive high-ticket people looking for date spots to your venue, from {offerFrom} per person.</>}
          body={<>That&rsquo;s the introductory Mingla promotion. Book a call and we&rsquo;ll fix everything in this report for you, free, and put your venue in front of people planning a night out.</>}
        >
          {situation ? (
            <DeviceLink
              surface="host"
              attribution={APP_GATE_ATTRIBUTION}
              onActivate={() => captureMarketing('tool_gate_app_click', { tool: 'venues', run_id: runId, location: 'offer' })}
              className="tp-go"
            >
              {nextStepCta('venues', 'no_website')}
            </DeviceLink>
          ) : null}
          <Link
            href={bookHref}
            onClick={() => captureMarketing('tool_offer_cta_click', { tool: 'venues', run_id: runId, cta: 'call' })}
            className={situation ? 'tp-ghost' : 'tp-go'}
          >
            Book a call: we fix all of this, free
          </Link>
        </Offer>
      )}
    >
      <RSec id="Your vibe card" h="Your vibe" em="card.">
        <div className="rcard">
          {vibes.length > 0 ? <div className="vibes">{vibes.map((v) => <span key={v}>{v}</span>)}</div> : null}
          {report.vibe_card.occasions.length > 0 ? (
            <div style={{ fontSize: 13.5 }}><b>Good for:</b> {report.vibe_card.occasions.join(' · ')}</div>
          ) : null}
          {report.vibe_card.signature_mention ? <div className="quote">&ldquo;{report.vibe_card.signature_mention}&rdquo;</div> : null}
          {report.ai_read ? <div className="ai"><b>How AI reads your site:</b> {report.ai_read}</div> : null}
          <Source from={situation ? ['google', 'research'] : ['site', 'research']} />
        </div>
      </RSec>

      {checks.length > 0 ? (
        <RSec id="Site health check" h="Site health" em="check.">
          <div className="rcard">
            <div className="counts">
              <span style={{ background: '#dcfce7', color: '#166534' }}>{passCount} passing</span>
              <span style={{ background: '#fef3c7', color: '#92400e' }}>{warnCount} to tidy</span>
              <span style={{ background: '#fee2e2', color: '#991b1b' }}>{failCount} failing</span>
            </div>
            <ul className="checks" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {checks.map((c) => (
                <li key={c.key} className={`chkr ${c.status}`}>
                  <i aria-hidden="true">{c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✕'}</i>
                  <span><b>{c.label}</b>{c.detail}</span>
                </li>
              ))}
            </ul>
            <Source from={['site']} />
          </div>
        </RSec>
      ) : null}

      {report.match.found ? (
        <RSec id="Mingla already knows you" h="Mingla already" em="knows you.">
          <div className="rcard">
            {photos.length > 0 ? <div className="photos">{photos.map((url) => <img key={url} src={url} alt="" loading="lazy" />)}</div> : null}
            {typeof report.match.mingla_score === 'number' ? (
              <div className="score2"><b>{clampScore(report.match.mingla_score)}</b><span style={{ color: '#7c7870' }}>Mingla score</span></div>
            ) : null}
            {report.match.ai_read ? <div className="ai">{report.match.ai_read}</div> : null}
            <Source from={['mingla']} />
          </div>
        </RSec>
      ) : null}

      <RSec id="The grades" h="The" em="grades.">
        <div className="rcard gbars">
          {SCORE_ROWS.map(({ key, label }) => {
            const value = clampScore(report.scores[key])
            const reason = report.scores.reasons[key]
            return (
              <div key={key} className="gbar">
                <div className="top"><span>{label}</span><span>{value}/100</span></div>
                <div className="trk" aria-hidden="true"><i style={{ width: `${value}%`, background: barColor(value) }} /></div>
                {reason ? <p>{reason}</p> : null}
              </div>
            )
          })}
        </div>
      </RSec>

      {report.google_listing.lines.length > 0 ? (
        <RSec id="Your Google listing" h="Your Google" em="listing.">
          <div className="rcard glist">
            {report.google_listing.lines.map((line, i) => <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>)}
            <Source from={['google']} />
          </div>
        </RSec>
      ) : null}

      {praise.length > 0 || complaints.length > 0 ? (
        <RSec id="What your customers say" h="What your customers" em="say.">
          <div className="say">
            {praise.length > 0 ? (
              <div className="rcard"><b style={{ color: '#166534' }}>What they love</b><ul className="rlist">{praise.map((s) => <li key={s}>{s}</li>)}</ul></div>
            ) : null}
            {complaints.length > 0 ? (
              <div className="rcard"><b style={{ color: '#991b1b' }}>What comes up as a gripe</b><ul className="rlist">{complaints.map((s) => <li key={s}>{s}</li>)}</ul></div>
            ) : null}
          </div>
          <Source from={['google', 'research']} />
        </RSec>
      ) : null}

      {report.fixes.length > 0 ? (
        <RSec id="Your fixes" h="Your fixes," em="in order.">
          <Fixes items={report.fixes.map((fix, i) => ({
            title: fix.title,
            body: fix.change,
            why: fix.why,
            tags: [{ label: fix.impact === 'high' ? 'High impact' : 'Medium', hot: i === 0 && fix.impact === 'high' }],
          }))} />
        </RSec>
      ) : null}

      {competitors.length > 0 ? (
        <RSec id="Who’s eating your Friday nights" h="Who’s eating your" em="Friday nights." lede={competition?.your_rank_read}>
          <div className="comps4">
            {competitors.map((c, i) => (
              <div key={`${c.name}-${i}`} className="comp">
                <div className="t"><b>{c.name}</b>{typeof c.mingla_score === 'number' ? <span className="ms">Mingla score {clampScore(c.mingla_score)}</span> : null}</div>
                {c.city ? <small>{c.city}</small> : null}
                {c.what_they_do_better.length > 0 ? <ul>{c.what_they_do_better.slice(0, 3).map((p) => <li key={p}>{p}</li>)}</ul> : null}
                {c.evidence ? <small>{c.evidence}</small> : null}
              </div>
            ))}
          </div>
          <Source from={['research', 'mingla']} />
        </RSec>
      ) : null}

      {headToHead && hhRows.length > 0 ? (
        <RSec id="You vs" h="You vs" em={`${headToHead.competitor}.`}>
          <div className="tablewrap">
            <table className="h2h">
              <thead><tr><th><span className="sr-only">What</span></th><th>You</th><th>{headToHead.competitor}</th></tr></thead>
              <tbody>
                {hhRows.map((row, i) => (
                  <tr key={`${row.dimension}-${i}`}>
                    <td><b>{row.dimension}</b></td>
                    <td className={row.winner === 'you' ? 'w' : row.winner === 'tie' ? 'tie' : undefined}>{row.you}</td>
                    <td className={row.winner === 'them' ? 'w' : row.winner === 'tie' ? 'tie' : undefined}>{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </RSec>
      ) : null}

      {whereYouWin.length > 0 ? (
        <RSec id="Where you already win" h="Where you already" em="win.">
          <div className="good">{whereYouWin.map((s) => <div key={s}>{s}</div>)}</div>
        </RSec>
      ) : null}

      {playbook.length > 0 ? (
        <RSec id="How to outrank them" h="How to" em="outrank them.">
          <ol className="moves" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {playbook.map((move, i) => (
              <li key={`${move.move}-${i}`} className="move">
                <span className="n" aria-hidden="true">{i + 1}</span>
                <div><b>{move.move}</b><p>{move.why_it_works}</p></div>
                <span className="eff">{effortLabel(move.effort as GraderCompetitionEffort) ?? 'Bigger project'}</span>
              </li>
            ))}
          </ol>
        </RSec>
      ) : null}

      {siteImage && (afterImage || afterFrame) ? (
        <RSec id="Your homepage, redesigned" h="Your homepage," em="redesigned.">
          <div data-before-after={afterImage ? 'image' : 'live'} style={{ display: 'grid', gap: 12 }}>
            <BeforeAfterSlider before={siteImage} after={afterImage} afterFrame={afterFrame} host={host} />
            <p className="lede" style={{ margin: 0 }}>Drag anywhere on the image: your site today vs rebuilt in a Mingla template.{rewritten ? ' The words, rewritten:' : ''}</p>
            {rewritten ? <RewrittenHero rewritten={rewritten} /> : null}
          </div>
        </RSec>
      ) : rewritten ? (
        // #4452 §6.8: neither image: the words before and after, no slider.
        <RSec id="Your homepage, redesigned" h="Your homepage," em="redesigned.">
          <div data-before-after="copy" style={{ display: 'grid', gap: 12 }}>
            <p className="lede" style={{ margin: 0 }}>{situation ? 'The words for your first page, written from what Google knows about you:' : 'Your homepage words today, and rewritten by Mingla:'}</p>
            <RewrittenHero rewritten={rewritten} />
          </div>
        </RSec>
      ) : null}

    </ReportFrame>
  )
}
