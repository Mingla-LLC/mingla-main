'use client'
// #1006 [The Undercharging Audit] — the full report.
//
// #4452 §6.7: redesigned on the paper report template (design ch. 4d,
// pricingReport, approved from the real Raleigh pasta class report). Every
// section it rendered before is kept, in the same order (the order guard keys
// on `data-section`): the stinging number with the maths · the read · the
// bottom line · your true cost per head · the price you should charge · what
// comparable experiences charge · what's shaping your price · demand right now
// · how to reprice without losing bookings · the offer. Newly shown: the
// comparables drawn to scale with your current and recommended price, and each
// one's source. §6.6: "You told us: <category>" so a wrong pick is visible.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import type { PricingReport } from '@/lib/growth-tools-submit'
import { nextStepCta } from '@/lib/tools/scenarios'
import { BottomLine, effortLabel, Factors, Fixes, money, Offer, reportDate, ReportFrame, RSec, ScaleBars, Source, ToldUs } from '../_template/ReportShell'

function StingHero({ report }: { report: PricingReport }) {
  const a = report.audit
  const cur = a.currency
  const label = a.verdict === 'losing' ? 'You’re losing money' : a.verdict === 'underpriced' ? 'You’re leaving money on the table' : 'You’re priced about right'
  const big = a.verdict === 'healthy' ? money(a.recommended_price, cur) : money(a.headline_amount, cur)
  return (
    <div className="sting" data-hero="pricing">
      <span className="lab">{label}</span>
      <span className="big">
        {a.verdict === 'healthy' ? '' : a.verdict === 'losing' ? '−' : '+'}{big}
        {a.verdict !== 'healthy' ? <span style={{ fontSize: '.35em' }}>/mo</span> : null}
      </span>
      <p>{a.verdict === 'losing' ? 'lost every month, once your time is counted' : a.verdict === 'underpriced' ? 'left on the table every month' : 'the price your costs and market support'}</p>
      <div className="maths">
        {a.current_price > 0
          ? <>{money(a.current_price, cur)} × {a.seats} seats = {money(a.revenue_per_event, cur)} in − {money(a.total_cost_per_event, cur)} true cost = {money(a.profit_per_event, cur)} an event × {a.events_per_month} a month.</>
          : <>Free today: {a.seats} seats bring nothing in, and each event costs you {money(a.total_cost_per_event, cur)} (your time counted) × {a.events_per_month} a month.</>}
      </div>
      {report.headline_verdict ? <p>{report.headline_verdict}</p> : null}
      <span className="src" style={{ color: 'rgba(245,244,240,.55)' }}>From your answers; comparable prices from live research.</span>
    </div>
  )
}

export function PricingReportView({ report, runId }: { report: PricingReport; runId: string }) {
  const shortTitle = report.experience.description.length > 60
    ? `${report.experience.description.slice(0, 57)}…`
    : report.experience.description
  const [bookHref, setBookHref] = useState(
    () => `/schedule?${new URLSearchParams({ venue: shortTitle, source: 'pricing_audit' }).toString()}`,
  )
  useEffect(() => {
    setBookHref(
      `/schedule?${new URLSearchParams({
        venue: shortTitle,
        source: 'pricing_audit',
        report_url: window.location.href,
      }).toString()}`,
    )
  }, [shortTitle])
  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'experiences', run_id: runId })
    captureMarketing('tool_offer_view', { tool: 'experiences', run_id: runId })
  }, [runId])

  const e = report.experience
  const a = report.audit
  const cur = a.currency
  const situation = report.followup?.reason === 'free_today' ? report.followup : null
  const topFix = report.fixes[0]
  const risk = report.factors.find((x) => x.status === 'hurt') ?? report.factors.find((x) => x.status === 'watch')
  const higher = a.recommended_price > a.current_price
  const pricedComps = report.comps.filter((c) => c.price_pp !== null && c.price_pp > 0)

  return (
    <ReportFrame
      tool="experiences"
      runId={runId}
      kick={['Pricing audit', 'full report', reportDate(report.meta?.generated_at)].filter(Boolean).join(' · ')}
      title={shortTitle}
      sub={[e.city, `${e.seats} seats`, e.current_price > 0 ? `${money(e.current_price, cur)}/person` : 'Currently free', `${e.events_per_month}×/month`].filter(Boolean).join(' · ')}
      actionLine={`Relaunch at ${money(a.recommended_price, cur)} in Mingla Host, or talk pricing with the team.`}
      hero={(
        <>
          <div className="rsec" style={{ paddingTop: 0, paddingBottom: 0 }}>
            {/* #4452 §6.6: the category as they picked it, so a wrong pick is visible. */}
            <span className="told" data-told-us="">You told us: {e.category}</span>
            {situation ? (
              <ToldUs>
                it&rsquo;s free today, each session costs you {money(situation.session_cost, cur)}, and guests would {situation.deposit === 'probably' ? 'probably' : 'maybe'} pay a deposit.
              </ToldUs>
            ) : null}
          </div>
          <StingHero report={report} />
        </>
      )}
      offer={(
        <Offer
          title={<>Relaunch at the right price: all-in checkout, no surprise fees.</>}
          body={<>List your experience on Mingla at {money(a.recommended_price, cur)}, take bookings with all-in pricing, and we&rsquo;ll help fill the seats from {report.offer?.per_person_from ?? '$3.99'} per head. Book a call and we&rsquo;ll set it up.</>}
        >
          {situation ? (
            <DeviceLink surface="host" attribution={toolAttribution('tool_pricing')} className="tp-go"
              onActivate={() => captureMarketing('tool_gate_app_click', { tool: 'experiences', run_id: runId, location: 'offer' })}>
              {nextStepCta('pricing', 'free_today')}
            </DeviceLink>
          ) : null}
          <Link href={bookHref} className={situation ? 'tp-ghost' : 'tp-go'}
            onClick={() => captureMarketing('tool_offer_cta_click', { tool: 'experiences', run_id: runId, cta: 'call' })}>
            Book a call: we&rsquo;ll help you relaunch
          </Link>
        </Offer>
      )}
    >
      {report.narrative ? <div className="rsec"><p className="prose">{report.narrative}</p></div> : null}

      <RSec id="The bottom line" h="The bottom" em="line.">
        <BottomLine best={topFix?.title} watch={risk?.label}>{a.read}</BottomLine>
      </RSec>

      <RSec id="Your true cost per head" h="Your true cost" em="per head." lede="Most hosts never count their own time. Here it is, in the number.">
        <div className="rcard">
          {a.cost_lines.map((line) => (
            <div key={line.key} className="costrow">
              <span>
                <b>{line.label}</b>
                {line.key === 'time' ? <span className="fg">Often forgotten</span> : null}
                {line.estimated ? <span className="fg" style={{ background: '#f5f4f0', color: '#7c7870' }}>Estimated</span> : null}
                {line.basis ? <small>{line.basis}</small> : null}
              </span>
              <b>{money(line.per_head, cur)}<small style={{ display: 'inline' }}> a head</small></b>
            </div>
          ))}
          <div className="costrow tot"><span><b>True cost per head</b></span><b>{money(a.cost_per_head, cur)}</b></div>
          <div className="strip3" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <div className="ai"><b style={{ display: 'block', fontSize: 18 }}>{a.current_price > 0 ? money(a.current_price, cur) : 'Nothing'}</b>You charge</div>
            <div className="ai"><b style={{ display: 'block', fontSize: 18, color: a.margin_per_head < 0 ? '#991b1b' : '#166534' }}>{money(a.margin_per_head, cur)}</b>Margin per head</div>
            {a.break_even_seats_now !== null ? <div className="ai"><b style={{ display: 'block', fontSize: 18 }}>{a.break_even_seats_now} seats</b>Break-even</div> : null}
          </div>
          <small style={{ color: '#7c7870' }}>{report.price_basis?.note || 'Comparable prices are current estimates from live research; your loss or upside is your own maths.'}{report.price_basis?.checked_on ? ` Checked ${report.price_basis.checked_on}.` : ''}</small>
        </div>
      </RSec>

      <div className="rsec" style={{ paddingTop: 0 }} data-section="The price you should charge">
        <div className="reco">
          <span className="rkick">The price you should charge</span>
          <span className="big">{money(a.recommended_price, cur)}</span>
          <span>per person{higher ? `, up from ${money(a.current_price, cur)}: about ${money(a.extra_per_head, cur)} more a head` : ''}</span>
          <div className="tiles">
            <div><b>{a.recommended_margin_pct}%</b>Margin per head</div>
            <div><b>{a.break_even_seats_rec ?? 'n/a'}<span style={{ fontSize: 12, fontWeight: 400 }}> of {a.seats}</span></b>Break-even seats</div>
            <div><b>{money(a.monthly_upside, cur)}</b>{a.verdict === 'losing' ? 'Swing to profit' : 'Extra per month'}</div>
          </div>
          {report.premium_framing ? <div className="frame2">{report.premium_framing}</div> : null}
          {report.value_points.length > 0 ? <ul>{report.value_points.map((v) => <li key={v}>{v}</li>)}</ul> : null}
        </div>
      </div>

      {report.comps.length > 0 ? (
        <RSec id="What comparable experiences charge" h="What comparable experiences" em="charge." isNew={pricedComps.length > 0}>
          {pricedComps.length > 0 ? (
            <ScaleBars
              format={(n) => money(n, cur)}
              rows={[
                ...(a.current_price > 0 ? [{ label: 'You today', value: a.current_price, kind: 'me' as const }] : []),
                { label: 'Your new price', value: a.recommended_price, kind: 'rec' as const },
                ...pricedComps.map((c) => ({ label: c.name, value: c.price_pp as number, note: [c.note, c.source_note].filter(Boolean).join(' · ') || undefined })),
              ]}
            />
          ) : null}
          {report.comps.filter((c) => c.price_pp === null || c.price_pp <= 0).length > 0 ? (
            <div className="lines">
              {report.comps.filter((c) => c.price_pp === null || c.price_pp <= 0).map((c) => (
                <div key={c.name}><span><b>{c.name}</b><small>{[c.note, c.source_note].filter(Boolean).join(' · ')}</small></span><span className="chip2">Price not listed</span></div>
              ))}
            </div>
          ) : null}
          <Source from={['research']} />
        </RSec>
      ) : null}

      {report.factors.length > 0 ? (
        <RSec id="What’s shaping your price" h="What’s shaping your" em="price.">
          <Factors items={report.factors} />
        </RSec>
      ) : null}

      {report.demand_read ? (
        <RSec id="Demand right now" h="Demand right" em="now.">
          <div className="rcard"><div style={{ fontSize: 14.5 }}>{report.demand_read}</div><Source from={['research']} /></div>
        </RSec>
      ) : null}

      {report.fixes.length > 0 ? (
        <RSec id="How to reprice without losing bookings" h="How to reprice without" em="losing bookings.">
          <Fixes items={report.fixes.map((fix, i) => ({
            title: fix.title,
            body: fix.change,
            why: fix.why,
            upside: fix.lift_note,
            tags: effortLabel(fix.effort) ? [{ label: effortLabel(fix.effort) as string, hot: i === 0 }] : [],
          }))} />
        </RSec>
      ) : null}
    </ReportFrame>
  )
}
