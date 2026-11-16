'use client'
// #1004 [Event Turnout Predictor] — the full report.
//
// #4452 §6.7: redesigned on the paper report template (design ch. 4d,
// eventReport, approved from the real Lekki yacht cruise report). Every section
// it rendered before is kept, in the same order (the order guard keys on
// `data-section`): the forecast hero and the read · the bottom line · how your
// room fills · the ad-spend plan (paid or free) · pick your spend · what's
// driving your turnout · who you're up against that night · similar events,
// real turnouts · weather · demand right now · how to pull a bigger crowd · your
// event as a Mingla listing · the offer. Newly shown: each fix's why, each
// comparable's source, and more of the listing (cover, title, why go, best
// for). The page only renders the token-verified full report (§6.4).

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import type { EventReport, EventScenario } from '@/lib/growth-tools-submit'
import { nextStepCta } from '@/lib/tools/scenarios'
import { BottomLine, effortLabel, Factors, Fixes, money, Offer, ReportFrame, RSec, Source, ToldUs, WeatherCard } from '../_template/ReportShell'

function dateLabel(iso: string, time: string): string {
  const ms = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(ms)) return iso
  const d = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms))
  return time ? `${d}, ${time}` : d
}

// ── Forecast hero (Night field): the turnout range + capacity bar + confidence ─
function ForecastHero({ report }: { report: EventReport }) {
  const f = report.forecast
  const cap = Math.max(1, f.capacity)
  const lowPct = Math.min(100, Math.round((f.total_low / cap) * 100))
  const highPct = Math.min(100, Math.round((f.total_high / cap) * 100))
  const situation = report.followup?.reason === 'free_rsvp' ? report.followup : null
  return (
    <div className="fc" data-hero="events">
      <div style={{ display: 'grid', gap: 10 }}>
        <span className="rkick">Predicted turnout</span>
        <span className="big">{f.total_low}–{f.total_high}</span>
        <span>{f.pct_capacity_low}–{f.pct_capacity_high}% of your {f.capacity} capacity</span>
        <div className="cap" aria-hidden="true"><u style={{ left: `${lowPct}%`, right: `${100 - highPct}%` }} /><i style={{ left: 0, width: `${lowPct}%` }} /></div>
        <span className={`conf ${f.confidence}`}>{f.confidence[0].toUpperCase()}{f.confidence.slice(1)} confidence</span>
        <span className="src" style={{ color: 'rgba(245,244,240,.55)' }}>From your answers and live research.</span>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {f.headline_read ? <div style={{ fontSize: 16, lineHeight: 1.5 }}>{f.headline_read}</div> : null}
        {situation ? (
          <ToldUs>
            it&rsquo;s free (RSVP only), your RSVP goal is {situation.rsvp_goal.toLocaleString('en')}, and you&rsquo;ve had {situation.no_shows === 'lots' ? 'lots of' : 'a few'} no-shows before.
          </ToldUs>
        ) : null}
      </div>
    </div>
  )
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return <div><b>{v}</b><span>{k}{sub ? ` · ${sub}` : ''}</span></div>
}

// ── The plan engine: profit-optimiser (paid) or budget-buys (free) ───────────
function BudgetEngine({ report }: { report: EventReport }) {
  // Reports generated before #1100 stored `paid_plan`, not `plan` — guard so an
  // old emailed link degrades gracefully instead of throwing a client exception.
  const plan = report.plan as EventReport['plan'] | undefined
  const offerFrom = report.offer?.per_person_from ?? '$3.99'
  if (!plan || (plan.kind !== 'paid_optimized' && plan.kind !== 'free_budget')) {
    return (
      <RSec id="Your ad-spend plan" h="Your ad-spend" em="plan.">
        <div className="rcard">This report predates our upgraded ad-spend planner. Re-run the predictor for the full profit-max forecast: Mingla can drive people to your event from {offerFrom} per head.</div>
      </RSec>
    )
  }
  const cur = plan.currency
  if (plan.kind === 'paid_optimized') {
    if (!plan.ads_worth_it) {
      return (
        <RSec id="Your ad-spend plan" h="Your ad-spend" em="plan.">
          <div className="rcard">
            <span>{plan.read}</span>
            <span style={{ fontSize: 12.5, color: '#7c7870' }}>
              At {money(plan.ticket_price, cur)} a ticket, ad clicks cost about {money(plan.cpc, cur)} and about {plan.benchmarks.landing_to_ticket_pct}% buy, so each ad ticket would cost more than it earns. Lean on organic and Mingla&rsquo;s {offerFrom}/head promotion.
            </span>
          </div>
        </RSec>
      )
    }
    return (
      <div className="rsec" style={{ paddingTop: 0 }} data-section="Your ad-spend plan">
        <div className="adplan">
          <span className="rkick">Your profit-max ad plan</span>
          <h3>Spend {money(plan.recommended_budget, cur)} on ads → net ≈ {money(plan.ad_profit, cur)} more profit.</h3>
          <div className="stats">
            <Stat k="Recommended budget" v={money(plan.recommended_budget, cur)} />
            <Stat k="Extra tickets" v={`${plan.ad_tickets_low}–${plan.ad_tickets_high}`} sub={money(plan.ad_revenue, cur)} />
            {plan.cost_per_ticket !== null ? <Stat k="Per ticket" v={money(plan.cost_per_ticket, cur)} sub={plan.cost_pct_of_ticket !== null ? `${plan.cost_pct_of_ticket}% of price` : undefined} /> : null}
            {plan.roas !== null ? <Stat k="Return on ad spend" v={`${plan.roas}×`} /> : null}
          </div>
          <p>{plan.read} Beyond that, each new ticket starts costing more than it earns. Estimates for planning, from live research and Mingla&rsquo;s demand data; real results vary.</p>
        </div>
      </div>
    )
  }
  if (!plan.budget || plan.budget <= 0) {
    return (
      <RSec id="Your ad-spend plan" h="What a promo budget" em="could add.">
        <div className="rcard">This is your organic outlook. Add a promo budget on a re-run and we&rsquo;ll show how many more people it can bring. Mingla puts your event in front of people already planning their week, from {offerFrom} per head.</div>
      </RSec>
    )
  }
  return (
    <div className="rsec" style={{ paddingTop: 0 }} data-section="Your ad-spend plan">
      <div className="adplan">
        <span className="rkick">Your {money(plan.budget, cur)} promo plan</span>
        <h3>Mingla can drive {plan.attendees_low}–{plan.attendees_high} more people to your event.</h3>
        <div className="stats">
          <Stat k={plan.cpc_source === 'researched' ? 'Per click, live research' : 'Per click, estimated'} v={money(plan.cpc, cur)} />
          <Stat k="Clicks your budget buys" v={`${plan.clicks_low}–${plan.clicks_high}`} />
          {plan.cost_per_attendee_low !== null && plan.cost_per_attendee_high !== null ? (
            <Stat k="Per attendee" v={`${money(plan.cost_per_attendee_low, cur)}–${money(plan.cost_per_attendee_high, cur)}`} />
          ) : null}
        </div>
        <p>Estimates for planning, from live research and Mingla&rsquo;s demand data; real results vary.</p>
      </div>
    </div>
  )
}

// ── How your room fills — organic + ads + empty ──────────────────────────────
function RoomFill({ report }: { report: EventReport }) {
  const f = report.forecast
  const cap = Math.max(1, f.capacity)
  const plan = report.plan
  const organic = Math.min(cap, Math.round((f.baseline_low + f.baseline_high) / 2))
  const adMid = plan.kind === 'paid_optimized'
    ? Math.round((plan.ad_attendees_low + plan.ad_attendees_high) / 2)
    : Math.round((plan.attendees_low + plan.attendees_high) / 2)
  const ad = Math.max(0, Math.min(cap - organic, adMid))
  const pct = (n: number) => (n / cap) * 100
  return (
    <RSec id="How your room fills" h="How your room" em="fills.">
      <div className="rcard">
        <div className="stack" aria-hidden="true">
          <i style={{ width: `${pct(organic)}%`, background: '#2f3a2e' }} />
          <i style={{ width: `${pct(ad)}%`, background: '#eb7825' }} />
        </div>
        <div className="legend">
          <span style={{ ['--c' as string]: '#2f3a2e' }}>Come organically ({f.baseline_low}–{f.baseline_high})</span>
          {ad > 0 ? <span style={{ ['--c' as string]: '#eb7825' }}>{plan.kind === 'paid_optimized' ? 'From ads, recommended' : 'From your budget'} ({ad})</span> : null}
          <span style={{ ['--c' as string]: '#efede7' }}>Empty seats ({Math.max(0, cap - organic - ad)})</span>
        </div>
        <small style={{ color: '#7c7870' }}>Capacity {cap} · likely {organic + ad} through the door ({Math.round(pct(organic + ad))}% full).</small>
      </div>
    </RSec>
  )
}

// ── Pick your spend — the budget scenario ladder ─────────────────────────────
function ScenarioLadder({ scenarios, currency }: { scenarios: EventScenario[]; currency: string }) {
  if (scenarios.length === 0) return null
  const maxProfit = Math.max(...scenarios.map((s) => s.profit), 1)
  return (
    <RSec id="Pick your spend" h="Pick your" em="spend." lede="Every level is profitable: pick your risk. We recommend the one marked ★.">
      <div className="scen">
        {scenarios.map((s) => (
          <div key={s.label} className={`r${s.recommended ? ' rec' : ''}`}>
            <b>{s.recommended ? '★ ' : ''}{s.label}</b>
            <span>{money(s.budget, currency)}</span>
            <span className="bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (s.profit / maxProfit) * 100)}%` }} /></span>
            <span style={{ textAlign: 'right' }}>
              <b>+{money(s.profit, currency)}</b><br />
              <small>{s.total_attendees} in ({s.pct_capacity}%){s.roas !== null ? ` · ${s.roas}×` : ''} · {s.ad_tickets} tickets{s.cost_per_ticket !== null ? ` · ${money(s.cost_per_ticket, currency)}/ticket` : ''}</small>
            </span>
          </div>
        ))}
      </div>
    </RSec>
  )
}

export function EventReportView({ report, runId }: { report: EventReport; runId: string }) {
  // Deep-link to /schedule with event context (added after mount — no SSR window).
  const [bookHref, setBookHref] = useState(
    () => `/schedule?${new URLSearchParams({ venue: report.event.title, source: 'event_predictor' }).toString()}`,
  )
  useEffect(() => {
    setBookHref(
      `/schedule?${new URLSearchParams({
        venue: report.event.title,
        source: 'event_predictor',
        report_url: window.location.href,
      }).toString()}`,
    )
  }, [report.event.title])

  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'events', run_id: runId })
    captureMarketing('tool_offer_view', { tool: 'events', run_id: runId })
  }, [runId])

  const ev = report.event
  const offerFrom = report.offer?.per_person_from ?? '$3.99'
  const situation = report.followup?.reason === 'free_rsvp' ? report.followup : null
  const f = report.forecast
  const plan = report.plan
  const topFix = report.fixes[0]
  const risk = report.factors.find((x) => x.status === 'hurt') ?? report.factors.find((x) => x.status === 'watch')
  const paidWorth = plan.kind === 'paid_optimized' && plan.ads_worth_it
  const lp = report.listing_preview
  const price = ev.ticket_price > 0 ? money(ev.ticket_price, ev.currency) : 'Free'

  return (
    <ReportFrame
      tool="events"
      runId={runId}
      kick={[ev.category, 'turnout forecast', 'full report'].filter(Boolean).join(' · ')}
      title={ev.title}
      titleItalicWords={ev.title.trim().split(/\s+/).length > 2 ? 2 : 1}
      sub={[[ev.venue_name, ev.city].filter(Boolean).join(', '), dateLabel(ev.date, ev.start_time), price, `${ev.capacity} capacity`].filter(Boolean).join(' · ')}
      actionLine={situation ? 'Take RSVPs in Mingla Host, or plan the reminders with the team.' : 'Sell tickets in Mingla Host, or plan the promo with the team.'}
      hero={<ForecastHero report={report} />}
      offer={(
        <Offer
          title={<>We put your event in front of people planning their week, from {offerFrom} per head.</>}
          body={<>That&rsquo;s the introductory Mingla promotion. Book a call and we&rsquo;ll help you hit the top of your forecast, and list your event free.</>}
        >
          {situation ? (
            <DeviceLink surface="host" attribution={toolAttribution('tool_events')} className="tp-go"
              onActivate={() => captureMarketing('tool_gate_app_click', { tool: 'events', run_id: runId, location: 'offer' })}>
              {nextStepCta('events', 'free_rsvp')}
            </DeviceLink>
          ) : null}
          <Link href={bookHref} className={situation ? 'tp-ghost' : 'tp-go'}
            onClick={() => captureMarketing('tool_offer_cta_click', { tool: 'events', run_id: runId, cta: 'call' })}>
            Book a call: we&rsquo;ll help you fill it
          </Link>
        </Offer>
      )}
    >
      {report.narrative ? <div className="rsec"><p className="prose">{report.narrative}</p></div> : null}

      <RSec id="The bottom line" h="The bottom" em="line.">
        <BottomLine best={topFix?.title} watch={risk?.label}>
          You&rsquo;ll likely draw {f.total_low}–{f.total_high} ({f.pct_capacity_low}–{f.pct_capacity_high}% full), at {f.confidence} confidence.
          {paidWorth ? <> Spend about {money((plan as { recommended_budget: number }).recommended_budget, plan.currency)} on ads for roughly {money((plan as { ad_profit: number }).ad_profit, plan.currency)} more profit.</> : null}
        </BottomLine>
      </RSec>

      <RoomFill report={report} />

      <BudgetEngine report={report} />

      {plan.kind === 'paid_optimized' && plan.scenarios && plan.scenarios.length > 0 ? (
        <ScenarioLadder scenarios={plan.scenarios} currency={plan.currency} />
      ) : null}

      {report.factors.length > 0 ? (
        <RSec id="What’s driving your turnout" h="What’s driving your" em="turnout.">
          <Factors items={report.factors} />
        </RSec>
      ) : null}

      {report.competitors.length > 0 ? (
        <RSec id="Who you’re up against that night" h="Who you’re up against" em="that night.">
          <div className="lines">
            {report.competitors.map((c) => (
              <div key={c.name}>
                <span><b>{c.name}</b><small>{[c.date_note, c.scale_note].filter(Boolean).join(' · ')}</small></span>
                {c.platform ? <span className="chip2">{c.platform}</span> : <span />}
              </div>
            ))}
          </div>
          <Source from={['research']} />
        </RSec>
      ) : null}

      {report.comparables.length > 0 ? (
        <RSec id="Similar events, real turnouts" h="Similar events," em="real turnouts." isNew={report.comparables.some((c) => c.source_note)}>
          <div className="lines">
            {report.comparables.map((c) => (
              <div key={c.name}>
                <span><b>{c.name}</b><small>{c.turnout_note}</small></span>
                {c.source_note ? <span className="chip2" data-new="source_note">{c.source_note}</span> : <span />}
              </div>
            ))}
          </div>
        </RSec>
      ) : null}

      {report.weather || report.demand_read ? (
        <section className="rsec" data-section={report.weather ? 'Weather' : 'Demand right now'}>
          <h2>{report.weather && report.demand_read ? <>Weather and <em>demand.</em></> : report.weather ? <>The <em>weather.</em></> : <>Demand right <em>now.</em></>}</h2>
          <div className="wx">
            {report.weather ? <WeatherCard weather={report.weather} /> : null}
            {report.demand_read ? (
              <div className="rcard" data-section={report.weather ? 'Demand right now' : undefined}>
                <b>Demand right now</b>
                <div>{report.demand_read}</div>
                <Source from={['research']} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {report.fixes.length > 0 ? (
        <RSec id="How to pull a bigger crowd" h="How to pull a" em="bigger crowd.">
          <Fixes items={report.fixes.map((fix, i) => ({
            title: fix.title,
            body: fix.change,
            why: fix.why,
            upside: fix.lift_note,
            tags: effortLabel(fix.effort) ? [{ label: effortLabel(fix.effort) as string, hot: i === 0 }] : [],
          }))} />
        </RSec>
      ) : null}

      <RSec id="Your event as a Mingla listing" h="Your event as a" em="Mingla listing." isNew={lp.why_go.length > 0 || lp.best_for.length > 0 || !!lp.cover_url}>
        <div className="listing">
          <div className="cv" style={lp.cover_url ? { backgroundImage: `url(${JSON.stringify(lp.cover_url)})` } : undefined}>
            <div>
              <b>{lp.title || ev.title}</b>
              <span style={{ fontSize: 13.5, opacity: 0.9 }}>{lp.tagline || 'A polished, ready-to-publish version of your event.'}</span>
            </div>
          </div>
          <div className="bd2">
            {lp.vibe_tags.length > 0 ? <div className="vibes">{lp.vibe_tags.map((t) => <span key={t}>{t}</span>)}</div> : null}
            {lp.why_go.length > 0 || lp.best_for.length > 0 ? (
              <div className="two2">
                {lp.why_go.length > 0 ? <div><b>Why go</b><ul>{lp.why_go.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
                {lp.best_for.length > 0 ? <div><b>Best for</b><ul>{lp.best_for.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
              </div>
            ) : null}
            <Link href={`/event-preview?run_id=${encodeURIComponent(runId)}`} target="_blank" className="tp-ghost" style={{ justifySelf: 'start' }}>
              See the full listing preview →
            </Link>
          </div>
        </div>
      </RSec>
    </ReportFrame>
  )
}
