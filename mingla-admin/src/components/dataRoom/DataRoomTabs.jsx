// Issue #4130 (Wave 5) — Data room › Explorers, Hosts, Funnels, Retention,
// Page usage. Every number comes from the gated admin_data_room_* reads.
import { useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, Cell,
} from "recharts";
import { SectionCard, AlertCard } from "../ui/Card";
import { formatMoneyMinor } from "../../lib/moneyFormat";
import {
  FUNNELS, funnelSteps, share, countChange, retentionCell, monthLabel, PAGE_USAGE_NEEDS,
  CHART_TICK, fmtInt, fmtPct, fmtWeek,
} from "../../lib/dataRoomAnalytics";
import { SectionGate, Tile, Segmented, Source, AsOf } from "./shared";

const MARKET_COLORS = ["var(--color-brand-500)", "var(--color-success-500)", "var(--color-warning-500)", "var(--color-info-500)", "var(--gray-400)"];

function Explorers({ load }) {
  const d = load.data;
  const onboardedPct = share(d.onboarded_30d, d.signups_30d);
  const onboardedPrevPct = share(d.onboarded_prev_30d, d.signups_prev_30d);
  const savedPct = share(d.saved_week1?.saved, d.saved_week1?.eligible);
  const byWeek = {};
  const markets = [];
  for (const r of d.signups_by_week || []) {
    byWeek[r.week_start] = byWeek[r.week_start] || { week: r.week_start };
    byWeek[r.week_start][r.market] = r.count;
    if (!markets.includes(r.market)) markets.push(r.market);
  }
  markets.sort((a, b) => (a === "Other" || a === "Unknown") - (b === "Other" || b === "Unknown") || a.localeCompare(b));
  const weekRows = Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week));
  const a = d.actions_30d || {};
  const actions = [
    { label: "Looked at the deck", n: a.saw_deck },
    { label: "Opened a card", n: a.opened_card },
    { label: "Saved a card", n: a.saved_card },
    { label: "Got a ticket", n: a.got_ticket },
    { label: "Followed a host", n: a.followed_host },
  ].map((x) => ({ ...x, pct: share(x.n, a.active) ?? 0 }));
  const pctChange = onboardedPct != null && onboardedPrevPct != null
    ? { text: `${onboardedPct - onboardedPrevPct >= 0 ? "+" : "−"}${Math.abs(Math.round((onboardedPct - onboardedPrevPct) * 10) / 10)} pts`, up: onboardedPct === onboardedPrevPct ? null : onboardedPct > onboardedPrevPct }
    : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Sign-ups, last 30 days" value={fmtInt(d.signups_30d)} trend={countChange(d.signups_30d, d.signups_prev_30d)} />
        <Tile label="Finished onboarding" value={fmtPct(onboardedPct)} note="of last 30 days' sign-ups" trend={pctChange} />
        <Tile label="Saved a card in week 1" value={fmtPct(savedPct)} note={`of ${fmtInt(d.saved_week1?.eligible)} who joined 7 to 97 days ago`} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Sign-ups per week" subtitle="by country, last 12 weeks">
          {weekRows.length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No sign-ups in the last 12 weeks. Weekly sign-ups appear here.</p>
          ) : (
            <div className="h-60 w-full" role="img" aria-label="Sign-ups per week by country">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                  <XAxis dataKey="week" tick={CHART_TICK} tickFormatter={fmtWeek} />
                  <YAxis tick={CHART_TICK} width={40} allowDecimals={false} />
                  <Tooltip labelFormatter={(v) => `Week of ${fmtWeek(v)}`} />
                  <Legend />
                  {markets.map((m, i) => (
                    <Bar key={m} dataKey={m} name={m} stackId="s" fill={MARKET_COLORS[i % MARKET_COLORS.length]} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <Source>Country is the one on the person&apos;s profile; the three biggest are named, the rest are Other.</Source>
        </SectionCard>
        <SectionCard title="What explorers do" subtitle={`share of ${fmtInt(a.active)} active explorers, last 30 days`}>
          {!a.active ? (
            <p className="text-sm text-[var(--color-text-secondary)]">No explorer was active in the last 30 days. What they do appears here.</p>
          ) : (
            <div className="h-60 w-full" role="img" aria-label="Share of active explorers who did each thing">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={actions} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={CHART_TICK} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="label" tick={CHART_TICK} width={120} />
                  <Tooltip formatter={(v, _n, p) => [`${fmtPct(v)} (${fmtInt(p?.payload?.n)})`, "Active explorers"]} />
                  <Bar dataKey="pct" fill="var(--color-brand-500)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <Source>Source: deck views, saves, orders and follows. Staff and test accounts left out.</Source>
        </SectionCard>
      </div>
    </div>
  );
}

const EVENT_STATES = [
  { key: "draft", label: "Draft", color: "var(--gray-400)" },
  { key: "on_sale", label: "On sale", color: "var(--color-success-500)" },
  { key: "ended", label: "Ended", color: "var(--color-brand-500)" },
  { key: "cancelled", label: "Cancelled", color: "var(--color-error-500)" },
];

function Hosts({ load }) {
  const d = load.data;
  const states = EVENT_STATES.map((s) => ({ ...s, n: Number(d.events_by_state?.[s.key]) || 0 }));
  const top = d.top_hosts_30d || [];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Brands created, last 30 days" value={fmtInt(d.brands_created_30d)} trend={countChange(d.brands_created_30d, d.brands_created_prev_30d)} />
        <Tile label="Brands with a first paid sale" value={fmtInt(d.hosts_with_first_sale)} note="since launch" />
        <Tile label="Median days, sign-up to first sale" value={d.median_days_to_first_sale == null ? "–" : fmtInt(d.median_days_to_first_sale)} note="from the host's business account" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Events by state" subtitle="all time">
          <div className="h-60 w-full" role="img" aria-label="Events by state">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={states} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                <XAxis dataKey="label" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} width={40} allowDecimals={false} />
                <Tooltip formatter={(v) => [fmtInt(v), "Events"]} />
                <Bar dataKey="n" isAnimationActive={false}>
                  {states.map((s) => <Cell key={s.key} fill={s.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Source>Deleted events and brands run by staff or test accounts left out. On sale = published and not yet over.</Source>
        </SectionCard>
        <SectionCard title="Top hosts by tickets" subtitle="last 30 days" noPadding>
          {top.length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-text-secondary)]">No tickets in the last 30 days. The busiest hosts appear here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--gray-200)] text-left text-xs text-[var(--color-text-tertiary)]">
                    <th className="px-4 py-2 font-medium">Host</th>
                    <th className="px-4 py-2 text-right font-medium">Tickets</th>
                    <th className="px-4 py-2 text-right font-medium">Paid by buyers</th>
                    <th className="px-4 py-2 text-right font-medium">Check-in rate</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {top.map((h) => (
                    <tr key={h.brand_id} className="border-b border-[var(--gray-100)] last:border-0">
                      <td className="px-4 py-2 text-[var(--color-text-primary)]">{h.name}</td>
                      <td className="px-4 py-2 text-right">{fmtInt(h.tickets)}</td>
                      <td className="px-4 py-2 text-right">
                        {(h.paid_by_buyers || []).length === 0 ? "Free" : h.paid_by_buyers.map((m) => formatMoneyMinor(m.cents, m.currency)).join(" + ")}
                      </td>
                      <td className="px-4 py-2 text-right">{h.check_in_rate == null ? "–" : fmtPct(h.check_in_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 pb-4"><Source>Check-in rate counts only events that have started. Brands run by staff or test accounts left out.</Source></div>
        </SectionCard>
      </div>
    </div>
  );
}

function Funnels({ load }) {
  const [which, setWhich] = useState("explorer");
  const def = FUNNELS.find((f) => f.id === which);
  const steps = funnelSteps(load.data, which);
  const top = steps[0]?.count || 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Funnel" options={FUNNELS.map((f) => ({ id: f.id, label: f.label }))} value={which} onChange={setWhich} />
        <span className="text-xs text-[var(--color-text-tertiary)]">Since launch. Each step counts {def.unit} who reached it and every step before it.</span>
      </div>
      <SectionCard title={`${def.label} funnel`}>
        {top === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Nobody has started this funnel yet. Each step appears here as people move through it.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {steps.map((s, i) => {
              const width = Math.max(2, (s.count / top) * 100);
              const lost = s.kept == null ? null : Math.round((100 - s.kept) * 10) / 10;
              return (
                <li key={s.key} className="grid grid-cols-1 gap-1 sm:grid-cols-[200px_1fr_140px] sm:items-center sm:gap-3">
                  <span className="text-sm text-[var(--color-text-primary)]">{s.label}</span>
                  <div className="h-3 w-full rounded-full bg-[var(--gray-100)]" aria-hidden="true">
                    <div className={`h-3 rounded-full ${lost != null && lost >= 50 ? "bg-[var(--color-error-500)]" : "bg-[var(--color-brand-500)]"}`} style={{ width: `${width}%` }} />
                  </div>
                  <span className="text-sm tabular-nums text-[var(--color-text-secondary)] sm:text-right">
                    {fmtInt(s.count)}{i > 0 && lost != null ? <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">−{lost}%</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <Source>{def.source}</Source>
      </SectionCard>
    </div>
  );
}

function Retention({ load }) {
  const [side, setSide] = useState("explorer");
  const overall = load.data.overall?.[side] || {};
  const cohorts = load.data.cohorts?.[side] || [];
  return (
    <div className="flex flex-col gap-4">
      <Segmented label="Side" options={[{ id: "explorer", label: "Explorers" }, { id: "host", label: "Hosts" }]} value={side} onChange={setSide} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {["d7", "d30", "d90"].map((k) => (
          <Tile
            key={k}
            label={`${k.toUpperCase()} retention`}
            value={overall[k]?.pct == null ? "too new" : fmtPct(overall[k].pct)}
            note={`${fmtInt(overall[k]?.eligible)} people old enough to measure`}
          />
        ))}
      </div>
      <SectionCard title="Cohorts by sign-up month" subtitle="share still active" noPadding>
        {cohorts.length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-text-secondary)]">No sign-ups yet. Each month&apos;s cohort appears here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-[var(--gray-200)] text-left text-xs text-[var(--color-text-tertiary)]">
                  <th className="px-4 py-2 font-medium">Cohort</th>
                  <th className="px-4 py-2 text-right font-medium">People</th>
                  <th className="px-4 py-2 text-center font-medium">D7</th>
                  <th className="px-4 py-2 text-center font-medium">D30</th>
                  <th className="px-4 py-2 text-center font-medium">D90</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.month} className="border-b border-[var(--gray-100)] last:border-0">
                    <td className="px-4 py-2 text-[var(--color-text-primary)]">{monthLabel(c.month)}</td>
                    <td className="px-4 py-2 text-right">{fmtInt(c.people)}</td>
                    {["d7", "d30", "d90"].map((k) => {
                      const cell = retentionCell(c[k]);
                      return (
                        <td
                          key={k}
                          className={`px-4 py-2 text-center ${cell.tooNew ? "text-xs text-[var(--color-text-tertiary)]" : "text-[var(--color-text-primary)]"}`}
                          style={cell.tooNew ? undefined : { background: `color-mix(in srgb, var(--color-brand-500) ${Math.round(Math.min(100, cell.value) * 0.6)}%, transparent)` }}
                        >
                          {cell.text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-4">
          <Source>Dn = the share of a month&apos;s sign-ups who were active on any of days n to n+6 after signing up. A cell shows &quot;too new&quot; until every person in that month has reached that point. Explorer active = looked at the deck, opened, saved or scheduled a card, followed a host or got a ticket. Host active = created a brand, created, published or edited an event, scanned a ticket or made a sale. Staff and test accounts left out.</Source>
        </div>
      </SectionCard>
    </div>
  );
}

function PageUsage() {
  return (
    <AlertCard variant="info" title="Needs app tagging and a PostHog read key">
      <p>This tab will show the most used screens and pages and where people leave. It stays empty until two things exist:</p>
      <ul className="mt-2 list-disc pl-5">
        {PAGE_USAGE_NEEDS.map((n) => <li key={n}>{n}</li>)}
      </ul>
      <p className="mt-2">No numbers are shown until then, so nothing here is estimated.</p>
    </AlertCard>
  );
}

export function DataRoomTab({ tab, loads }) {
  if (tab === "explorers") {
    return (
      <SectionGate loads={[loads.explorers]} title="Couldn't load Explorers" height={320}>
        {loads.explorers.data ? <><p className="text-xs text-[var(--color-text-tertiary)]"><AsOf load={loads.explorers} /></p><Explorers load={loads.explorers} /></> : null}
      </SectionGate>
    );
  }
  if (tab === "hosts") {
    return (
      <SectionGate loads={[loads.hosts]} title="Couldn't load Hosts" height={320}>
        {loads.hosts.data ? <><p className="text-xs text-[var(--color-text-tertiary)]"><AsOf load={loads.hosts} /></p><Hosts load={loads.hosts} /></> : null}
      </SectionGate>
    );
  }
  if (tab === "funnels") {
    return (
      <SectionGate loads={[loads.funnels]} title="Couldn't load the funnels" height={260}>
        {loads.funnels.data ? <><p className="text-xs text-[var(--color-text-tertiary)]"><AsOf load={loads.funnels} /></p><Funnels load={loads.funnels} /></> : null}
      </SectionGate>
    );
  }
  if (tab === "retention") {
    return (
      <SectionGate loads={[loads.retention]} title="Couldn't load retention" height={320}>
        {loads.retention.data ? <><p className="text-xs text-[var(--color-text-tertiary)]"><AsOf load={loads.retention} /></p><Retention load={loads.retention} /></> : null}
      </SectionGate>
    );
  }
  if (tab === "usage") return <PageUsage />;
  return null;
}
