'use client'
// #1005 [Quote Any Trip] — the full report.
//
// #4452 §6.7: redesigned on the paper report template (design ch. 4d, tripReport,
// approved from the real Kyoto in Bloom report). Every section it rendered
// before is kept, in the same order (the order guard keys on `data-section`):
// the cover with the price · the read · the bottom line · your cost sheet · what
// to charge · perfect timing · signature experiences · your day-by-day plan ·
// where they'll stay · what comparable trips charge · filling the seats · pick
// your promo spend · what's shaping this quote · weather · demand right now ·
// how to sell it out & lift margin · your trip as a bookable Mingla page · the
// offer. Newly shown: the listing's included, excluded, why go and best for,
// and the comparables drawn to scale against your price.
//
// #4452 §6.5, the honest state: when live prices did not come back
// (`pricing_status: "unpriced"`, or the same rule on an older report), the page
// says "We couldn't price this trip yet.", shows no money at all, hides the cost
// sheet and the margin ladder, and keeps the plan, the hotels and the experiences.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { DeviceLink } from '@/components/cutout/device-link'
import { toolAttribution } from '@/lib/links-src'
import type { TripReport, TripScenario } from '@/lib/growth-tools-submit'
import { nextStepCta } from '@/lib/tools/scenarios'
import { BottomLine, effortLabel, Factors, Fixes, money, Offer, ReportFrame, RSec, ScaleBars, Source, splitTitle, ToldUs, WeatherCard } from '../_template/ReportShell'

/** §6.5: the server's rule, applied again for reports stored before the status existed. */
export function tripIsUnpriced(report: Pick<TripReport, 'plan'> & { pricing_status?: string }): boolean {
  if (report.pricing_status === 'unpriced') return true
  const lines = report.plan?.cost_lines ?? []
  const sum = lines.reduce((s, l) => s + (Number.isFinite(l.per_person) ? l.per_person : 0), 0)
  const positive = lines.filter((l) => l.per_person > 0).length
  return sum <= 0 || !(report.plan?.recommended_price_per_person > 0) || positive < 2
}

function ScenarioLadder({ scenarios, currency }: { scenarios: TripScenario[]; currency: string }) {
  if (scenarios.length === 0) return null
  const maxProfit = Math.max(...scenarios.map((s) => s.extra_profit), 1)
  return (
    <RSec id="Pick your promo spend" h="Pick your promo" em="spend." lede="Every level nets extra profit: pick your risk. We recommend the one marked ★.">
      <div className="scen">
        {scenarios.map((s) => (
          <div key={s.label} className={`r${s.recommended ? ' rec' : ''}`}>
            <b>{s.recommended ? '★ ' : ''}{s.label}</b>
            <span>{money(s.budget, currency)}</span>
            <span className="bar" aria-hidden="true"><i style={{ width: `${Math.max(4, (s.extra_profit / maxProfit) * 100)}%` }} /></span>
            <span style={{ textAlign: 'right' }}>
              <b>+{money(s.extra_profit, currency)}</b><br />
              <small>{s.total_booked} booked ({s.pct_full}%) · {s.ad_bookings} extra seats{s.cost_per_booking !== null ? ` · ${money(s.cost_per_booking, currency)}/seat` : ''}</small>
            </span>
          </div>
        ))}
      </div>
    </RSec>
  )
}

export function TripReportView({ report, runId }: { report: TripReport; runId: string }) {
  // Deep-link to /schedule with trip context (added after mount — no SSR window).
  const [bookHref, setBookHref] = useState(
    () => `/schedule?${new URLSearchParams({ venue: report.trip.title, source: 'trip_quoter' }).toString()}`,
  )
  useEffect(() => {
    setBookHref(
      `/schedule?${new URLSearchParams({
        venue: report.trip.title,
        source: 'trip_quoter',
        report_url: window.location.href,
      }).toString()}`,
    )
  }, [report.trip.title])
  useEffect(() => {
    captureMarketing('tool_gate_viewed', { tool: 'trips', run_id: runId })
    captureMarketing('tool_offer_view', { tool: 'trips', run_id: runId })
  }, [runId])

  const t = report.trip
  const p = report.plan
  const cur = p.currency
  const unpriced = tripIsUnpriced(report)
  const offerFrom = report.offer?.per_person_from ?? '$3.99'
  const situation = report.followup?.reason === 'group_over_15' ? report.followup : null
  const durationLabel = `${t.nights} night${t.nights === 1 ? '' : 's'} · ${t.days} day${t.days === 1 ? '' : 's'}`
  const topFix = report.fixes[0]
  const risk = report.factors.find((x) => x.status === 'hurt') ?? report.factors.find((x) => x.status === 'watch')
  const acts = report.activities.filter((a) => a.name)
  const lp = report.listing_preview
  const [plain, em] = splitTitle(t.title, 1)
  const pricedComps = report.comparables.filter((c) => c.price_pp !== null && c.price_pp > 0)

  const cover = (
    <div className="tcover" style={lp.cover_url ? { backgroundImage: `url(${JSON.stringify(lp.cover_url)})` } : undefined} data-hero="trips">
      <div className="in">
        <div style={{ display: 'grid', gap: 8 }}>
          <span className="rkick">{[t.destination, 'trip quote', 'full report'].filter(Boolean).join(' · ')}</span>
          <h1>{plain ? `${plain} ` : ''}<em>{em}</em></h1>
          <p>{[t.departure ? `From ${t.departure}` : '', t.date_range, durationLabel, `${t.group_size} people`].filter(Boolean).join(' · ')}</p>
          {situation ? <ToldUs>{situation.coach ? 'a coach between stops' : 'no coach'}, {situation.rooms} rooms.</ToldUs> : null}
        </div>
        {unpriced ? (
          <div className="px" data-unpriced="">
            <span className="rkick">Charge per person</span>
            <b style={{ fontSize: 'clamp(30px, 4vw, 40px)', lineHeight: 1.05 }}>We couldn&rsquo;t price this trip yet.</b>
            <span>Live prices for {t.destination} didn&rsquo;t come back. Your plan, hotels and activities are below; prices will follow when we can check them.</span>
          </div>
        ) : (
          <div className="px">
            <span className="rkick">Charge per person</span>
            <b>{money(p.recommended_price_per_person, cur)}</b>
            <span>{money(p.group_price, cur)} for your group of {p.group_size} · {money(p.group_profit, cur)} profit</span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Built from {money(p.cost_per_person, cur)} real cost at a {p.recommended_margin_pct}% margin</span>
            <span className={`conf ${report.confidence}`}>{report.confidence[0].toUpperCase()}{report.confidence.slice(1)} confidence</span>
            <span className="src" style={{ color: 'rgba(245,244,240,.6)' }}>From live research and your answers.</span>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <ReportFrame
      tool="trips"
      runId={runId}
      kick=""
      title={t.title}
      before={cover}
      hero={null}
      actionLine="Publish the trip in Mingla Host, or set it up with the team."
      offer={(
        <Offer
          title={<>You&rsquo;ve got the quote. Now give them a real place to pay.</>}
          body={<>Publish this as a bookable Mingla trip page with checkout, deposits and pay-over-time, and we&rsquo;ll fill the seats{unpriced ? '' : <> from {offerFrom} per head</>}. Book a call and we&rsquo;ll set it up.</>}
        >
          {situation ? (
            <DeviceLink surface="host" attribution={toolAttribution('tool_trips')} className="tp-go"
              onActivate={() => captureMarketing('tool_gate_app_click', { tool: 'trips', run_id: runId, location: 'offer' })}>
              {nextStepCta('trips', 'group_over_15')}
            </DeviceLink>
          ) : null}
          <Link href={bookHref} className={situation ? 'tp-ghost' : 'tp-go'}
            onClick={() => captureMarketing('tool_offer_cta_click', { tool: 'trips', run_id: runId, cta: 'call' })}>
            Book a call: we&rsquo;ll help you publish it
          </Link>
        </Offer>
      )}
    >
      {report.headline_read || report.cover_narrative ? (
        <div className="rsec">
          {report.headline_read ? <p style={{ fontSize: 18, lineHeight: 1.5, fontFamily: 'var(--tp-serif)' }}>{report.headline_read}</p> : null}
          {report.cover_narrative ? <p className="prose" style={{ color: '#3f3d39' }}>{report.cover_narrative}</p> : null}
        </div>
      ) : null}

      <RSec id="The bottom line" h="The bottom" em="line.">
        <BottomLine best={topFix?.title} watch={risk?.label}>
          {unpriced
            ? <>Your plan is ready; the price isn&rsquo;t yet. We&rsquo;ll price it when live rates for {t.destination} come back.</>
            : <>Charge {money(p.recommended_price_per_person, cur)} a head. That clears {money(p.profit_per_person, cur)} profit each, about {money(p.group_profit, cur)} across {p.group_size} people at a {p.recommended_margin_pct}% margin.</>}
        </BottomLine>
      </RSec>

      {!unpriced ? (
        <RSec id="Your cost sheet (per person)" h="Your cost sheet," em="per person.">
          <div className="rcard">
            {p.cost_lines.map((line) => (
              <div key={line.key} className="costrow"><span><b>{line.label}</b>{line.basis ? <small>{line.basis}</small> : null}</span><b>{money(line.per_person, cur)}</b></div>
            ))}
            <div className="costrow tot">
              <span><b>Cost per person</b>{p.cost_per_person_low > 0 && p.cost_per_person_high > 0 ? <small>Range {money(p.cost_per_person_low, cur)} to {money(p.cost_per_person_high, cur)}</small> : null}</span>
              <b>{money(p.cost_per_person, cur)}</b>
            </div>
            <div className="costrow tot" style={{ background: '#111110', color: '#fff', borderRadius: 14, padding: '12px 14px' }}>
              <span><b style={{ color: '#fff' }}>What to charge at a {p.recommended_margin_pct}% margin</b></span><b style={{ color: '#fff' }}>{money(p.recommended_price_per_person, cur)}</b>
            </div>
            <small style={{ color: '#7c7870' }}>{report.price_basis?.note || 'Prices are current estimates from live research, not guaranteed rates.'}{report.price_basis?.checked_on ? ` Checked ${report.price_basis.checked_on}.` : ''}</small>
          </div>
        </RSec>
      ) : null}

      {!unpriced && p.margin_tiers.length > 0 ? (
        <RSec id="What to charge" h="What to" em="charge." lede={p.price_vs_market}>
          <div className="ladder">
            {p.margin_tiers.map((tier) => (
              <div key={tier.margin_pct} className={tier.recommended ? 'rec' : undefined}>
                <span className="rkick">{tier.recommended ? '★ ' : ''}{tier.margin_pct}% margin</span>
                <b>{money(tier.price_per_person, cur)}</b>
                <span>per person · +{money(tier.group_profit, cur)} for the group</span>
              </div>
            ))}
          </div>
        </RSec>
      ) : null}

      {report.season_note && report.season_note.trim() ? (
        <RSec id="Perfect timing" h="Perfect" em="timing.">
          <div className="rcard"><div style={{ fontSize: 14.5, lineHeight: 1.6 }}>{report.season_note}</div><Source from={['research']} /></div>
        </RSec>
      ) : null}

      {acts.length > 0 ? (
        <RSec id="Signature experiences — all included" h="Signature experiences," em="all included." lede="The popular, in-season highlights we’d build this trip around.">
          <div className="acts">
            {acts.map((a) => (
              <div key={a.name} className="act">
                <div className="t">
                  {a.tag ? <span className="chip2">{a.tag}</span> : <span />}
                  {!unpriced && a.price_pp !== null && a.price_pp > 0 ? <b style={{ fontSize: 13 }}>{money(a.price_pp, cur)}/pp</b> : null}
                </div>
                <b>{a.name}</b>
                {a.why ? <span>{a.why}</span> : null}
                {a.best_time ? <small style={{ color: '#7c7870' }}>◷ {a.best_time}</small> : null}
              </div>
            ))}
          </div>
        </RSec>
      ) : null}

      {report.itinerary.length > 0 ? (
        <RSec id="Your day-by-day plan" h="Your day-by-day" em="plan.">
          <ol className="days2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {report.itinerary.map((d) => (
              <li key={d.day} className="day">
                <span className="dn" aria-hidden="true">{d.day}</span>
                <div className="dc">
                  <b><span className="sr-only">Day {d.day}: </span>{d.title}</b>
                  {d.summary ? <span>{d.summary}</span> : null}
                  <div className="ch3">
                    {d.stay ? <span className="chip2">🛏 {d.stay}</span> : null}
                    {d.activities.map((x) => <span key={x} className="chip2">◆ {x}</span>)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </RSec>
      ) : null}

      {report.hotels.length > 0 ? (
        <RSec id="Where they’ll stay" h="Where they’ll" em="stay.">
          <div className="lines">
            {report.hotels.map((h) => (
              <div key={h.name}>
                <span><b>{h.name}</b><small>{[h.area, h.note].filter(Boolean).join(' · ')}</small></span>
                {!unpriced && h.nightly_pp !== null && h.nightly_pp > 0 ? <b>~{money(h.nightly_pp, cur)}/night pp</b> : <span />}
              </div>
            ))}
          </div>
          <Source from={['research']} />
        </RSec>
      ) : null}

      {report.comparables.length > 0 ? (
        <RSec id="What comparable trips charge" h="What comparable trips" em="charge." isNew={!unpriced && pricedComps.length > 0}>
          {!unpriced && pricedComps.length > 0 ? (
            <>
              <ScaleBars
                format={(n) => money(n, cur)}
                rows={[
                  { label: 'Your price', value: p.recommended_price_per_person, kind: 'me' as const },
                  ...pricedComps.map((c) => ({ label: [c.name, c.operator].filter(Boolean).join(' · '), value: c.price_pp as number, note: c.note || undefined })),
                ]}
              />
              <small style={{ color: '#7c7870' }}>Operators&rsquo; published prices, from live research. Land only; flights excluded.</small>
            </>
          ) : (
            <div className="lines">
              {report.comparables.map((c) => (
                <div key={c.name}><span><b>{c.name}</b><small>{[c.operator, c.note].filter(Boolean).join(' · ')}</small></span><span /></div>
              ))}
            </div>
          )}
        </RSec>
      ) : null}

      {!unpriced ? (
        p.ads_worth_it ? (
          <div className="rsec" style={{ paddingTop: 0 }} data-section="Filling the seats">
            <div className="adplan">
              <span className="rkick">Fill the rest with promo</span>
              <h3>Spend {money(p.recommended_ad_budget, cur)} → book ~{p.ad_bookings_low}–{p.ad_bookings_high} more seats → net ≈ {money(p.ad_extra_profit, cur)}.</h3>
              <div className="stats">
                <div><b>{money(p.recommended_ad_budget, cur)}</b><span>Promo budget</span></div>
                <div><b>{p.ad_bookings_low}–{p.ad_bookings_high}</b><span>Extra seats booked</span></div>
                <div><b>{money(p.cpc, cur)}</b><span>Per click, {p.cpc_source === 'researched' ? 'live research' : 'estimated'}</span></div>
              </div>
              <p>{p.read}</p>
            </div>
          </div>
        ) : (
          <RSec id="Filling the seats" h="Filling the" em="seats.">
            <div className="rcard"><div style={{ fontSize: 14.5 }}>{p.read}</div></div>
          </RSec>
        )
      ) : null}

      {!unpriced && p.ads_worth_it && p.scenarios.length > 0 ? <ScenarioLadder scenarios={p.scenarios} currency={cur} /> : null}

      {report.factors.length > 0 ? (
        <RSec id="What’s shaping this quote" h="What’s shaping this" em="quote.">
          <Factors items={report.factors} />
        </RSec>
      ) : null}

      {report.weather || report.demand_read ? (
        <section className="rsec" data-section={report.weather ? 'Weather' : 'Demand right now'}>
          <h2>{report.weather && report.demand_read ? <>Weather and <em>demand.</em></> : report.weather ? <>The <em>weather.</em></> : <>Demand right <em>now.</em></>}</h2>
          <div className="wx">
            {report.weather ? <WeatherCard weather={report.weather} /> : null}
            {report.demand_read ? (
              <div className="rcard" data-section={report.weather ? 'Demand right now' : undefined}>
                <b>Demand right now</b><div>{report.demand_read}</div><Source from={['research']} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {report.fixes.length > 0 ? (
        <RSec id="How to sell it out & lift margin" h="How to sell it out and" em="lift margin.">
          <Fixes items={report.fixes.map((fix, i) => ({
            title: fix.title,
            body: fix.change,
            why: fix.why,
            upside: unpriced ? undefined : fix.lift_note,
            tags: effortLabel(fix.effort) ? [{ label: effortLabel(fix.effort) as string, hot: i === 0 }] : [],
          }))} />
        </RSec>
      ) : null}

      <RSec id="Your trip as a bookable Mingla page" h="Your trip as a bookable" em="Mingla page." isNew={lp.included.length > 0 || lp.excluded.length > 0 || lp.why_go.length > 0 || lp.best_for.length > 0}>
        <div className="listing">
          <div className="cv" style={lp.cover_url ? { backgroundImage: `url(${JSON.stringify(lp.cover_url)})` } : undefined}>
            <div><b>{lp.title || t.title}</b><span style={{ fontSize: 13.5, opacity: 0.9 }}>{lp.tagline || 'A polished, ready-to-publish version of this trip.'}</span></div>
          </div>
          <div className="bd2">
            {lp.vibe_tags.length > 0 ? <div className="vibes">{lp.vibe_tags.map((x) => <span key={x}>{x}</span>)}</div> : null}
            {lp.included.length > 0 || lp.excluded.length > 0 ? (
              <div className="two2">
                {lp.included.length > 0 ? <div><b>Included</b><ul>{lp.included.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
                {lp.excluded.length > 0 ? <div><b>Not included</b><ul>{lp.excluded.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
              </div>
            ) : null}
            {lp.why_go.length > 0 || lp.best_for.length > 0 ? (
              <div className="two2">
                {lp.why_go.length > 0 ? <div><b>Why go</b><ul>{lp.why_go.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
                {lp.best_for.length > 0 ? <div><b>Best for</b><ul>{lp.best_for.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
              </div>
            ) : null}
            <Link href={`/trip-preview?run_id=${encodeURIComponent(runId)}`} target="_blank" className="tp-ghost" style={{ justifySelf: 'start' }}>
              See the full trip page preview →
            </Link>
          </div>
        </div>
      </RSec>
    </ReportFrame>
  )
}
