// Issue #4130 (Wave 5) — Data room › Overview.
//
// All users first (totals, growth and new people each month by segment, staff
// and test left out), then the headline numbers, Working / Not working from
// the funnels (rules shown on screen), weekly active people, tickets and money.
import { useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";
import { SectionCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { formatMoneyMinor, joinMoneyAmounts } from "../../lib/moneyFormat";
import {
  SEGMENTS, cumulativeMonths, lastMonthNew, monthLabel, monthName, countChange, funnelVerdicts,
  verdictRulesText, verdictSentence, weeklyMoney, moneyCurrencies, last30,
  CHART_TICK, fmtInt, fmtPct, fmtWeek, ticketBuyerTiles, hostContactTiles,
} from "../../lib/dataRoomAnalytics";
import { SectionGate, Tile, Segmented, Source, AsOf } from "./shared";

function AllUsers({ users }) {
  const data = users.data;
  const months = data.months || [];
  const latest = lastMonthNew(months);
  const latestName = latest ? monthName(latest.month) : "";
  const growth = cumulativeMonths(months);
  const newRows = months.map((m) => ({ ...m }));
  const plus = (n) => (latest ? `+${fmtInt(n)} in ${latestName}` : null);
  return (
    <SectionCard
      title="All users"
      subtitle={<>Staff and test accounts left out ({fmtInt(data.internal_left_out)}) · <AsOf load={users} /></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Total users" value={fmtInt(data.total)} note={plus(latest?.total)} />
        {SEGMENTS.map((s) => (
          <Tile key={s.key} label={s.label} value={fmtInt(data.segments?.[s.key])} note={plus(latest?.[s.key])} />
        ))}
      </div>
      {months.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">No sign-ups yet. Growth by month appears here once people join.</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">Total growth</h4>
            <div className="mt-2 h-60 w-full" role="img" aria-label="Total users by month, stacked by explorers, hosts, both and didn't finish">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growth} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                  <XAxis dataKey="month" tick={CHART_TICK} tickFormatter={monthLabel} />
                  <YAxis tick={CHART_TICK} width={40} allowDecimals={false} />
                  <Tooltip labelFormatter={monthLabel} />
                  <Legend />
                  {SEGMENTS.map((s) => (
                    <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId="u" stroke={s.color} fill={s.color} fillOpacity={0.5} isAnimationActive={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">New users each month</h4>
            <div className="mt-2 h-60 w-full" role="img" aria-label="New users each month by explorers, hosts, both and didn't finish">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={newRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
                  <XAxis dataKey="month" tick={CHART_TICK} tickFormatter={monthLabel} />
                  <YAxis tick={CHART_TICK} width={40} allowDecimals={false} />
                  <Tooltip labelFormatter={monthLabel} />
                  <Legend />
                  {SEGMENTS.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} stackId="n" fill={s.color} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
      <Source>Explorer = finished Explorer onboarding. Host = has a business account or a role on a brand. Both = both. Didn&apos;t finish = signed up but is neither yet. The same split as the People page. Source: accounts, business accounts and brand teams.</Source>
    </SectionCard>
  );
}

// #4226: people who got a ticket, with or without a Mingla account.
function TicketBuyers({ users }) {
  const tiles = ticketBuyerTiles(users.data.ticket_buyers);
  return (
    <SectionCard
      title="Ticket buyers"
      subtitle={<>Everyone who bought or was given a paid ticket, staff and test left out · <AsOf load={users} /></>}
    >
      {tiles ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {tiles.map((t) => <Tile key={t.key} label={t.label} value={t.value} note={t.note} />)}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">Ticket buyer numbers start with snapshots taken after this release. Pick today to see them live.</p>
      )}
      <Source>A ticket buyer bought, was comp&apos;d or holds a paid ticket from any host, matched to an account by email. No app = hasn&apos;t finished Explorer onboarding (the People page&apos;s &quot;Ticket buyers, no app&quot; tab). Conversion = of the people who bought before they had an account, how many now have the Explorer or Host app. Source: orders, tickets and accounts.</Source>
    </SectionCard>
  );
}

// #4226: people hosts imported or added to their contact book.
function HostContacts({ users }) {
  const tiles = hostContactTiles(users.data.host_contacts);
  return (
    <SectionCard
      title="Host contacts"
      subtitle={<>People hosts imported or added to their contact book, staff and test left out · <AsOf load={users} /></>}
    >
      {tiles ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {tiles.map((t) => <Tile key={t.key} label={t.label} value={t.value} note={t.note} />)}
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">Host contact numbers start with snapshots taken after this release. Pick today to see them live.</p>
      )}
      <Source>A host contact is an email a host imported (with the host&apos;s permission attestation) or added by hand to their brand contact book, matched to an account or ticket by email. No app = no Explorer or Host app. Later got an app = a host added them before they had an account, and they now have the Explorer or Host app. Source: brand contact books, accounts and tickets.</Source>
    </SectionCard>
  );
}

function Headlines({ overview, retention, money }) {
  const k = overview.data.kpis || {};
  const d30 = retention.data.overall?.explorer?.d30;
  const profit = last30(money.data, "profit");
  const profitUsd = money.data.last_30d_usd?.profit;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile label="Explorers signed up" value={fmtInt(k.explorers_signed_up)} note={`incl. ${fmtInt(k.explorers_also_hosting)} who also host`} />
      <Tile label="Active explorers, last 7 days" value={fmtInt(k.active_explorers_7d)} trend={countChange(k.active_explorers_7d, k.active_explorers_prev_7d)} />
      <Tile label="Hosts with a live event" value={fmtInt(k.hosts_with_live_event)} note="on sale and public now" />
      <Tile label="Tickets, last 30 days" value={fmtInt(k.tickets_30d)} note={`${fmtInt(k.paid_tickets_30d)} paid`} trend={countChange(k.tickets_30d, k.tickets_prev_30d)} />
      <Tile label="D30 explorer retention" value={d30?.pct == null ? "too new" : fmtPct(d30.pct)} note={`${fmtInt(d30?.eligible)} people old enough`} />
      <Tile
        label="Mingla profit, last 30 days"
        value={profitUsd == null ? (profit.length ? "not converted" : formatMoneyMinor(0, "USD")) : formatMoneyMinor(profitUsd, "USD")}
        note={profit.length ? joinMoneyAmounts(profit) + " · see Mingla money" : "see Mingla money"}
      />
    </div>
  );
}

function Verdicts({ funnels }) {
  const { working, notWorking } = funnelVerdicts(funnels.data);
  const list = (items, variant, empty) => items.length === 0 ? (
    <p className="text-sm text-[var(--color-text-secondary)]">{empty}</p>
  ) : (
    <ul className="flex flex-col gap-3">
      {items.map((x) => (
        <li key={`${x.funnel}-${x.to}`} className="flex items-start gap-3">
          <Badge variant={variant}>{variant === "success" ? "+" : "−"}</Badge>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">{x.funnel}: {x.to}</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{verdictSentence(x)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Working" subtitle="strongest funnel steps">
          {list(working, "success", "No funnel step keeps enough people yet to count as working.")}
        </SectionCard>
        <SectionCard title="Not working" subtitle="biggest leaks">
          {list(notWorking, "error", "No funnel step loses enough people to flag.")}
        </SectionCard>
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)]">{verdictRulesText()} Computed from the Funnels tab (since launch).</p>
    </div>
  );
}

function Weekly({ overview }) {
  const weekly = overview.data.weekly || [];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard title="Weekly active people" subtitle="last 12 weeks">
        <div className="h-60 w-full" role="img" aria-label="Active explorers and active hosts each week">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
              <XAxis dataKey="week_start" tick={CHART_TICK} tickFormatter={fmtWeek} />
              <YAxis tick={CHART_TICK} width={40} allowDecimals={false} />
              <Tooltip labelFormatter={(v) => `Week of ${fmtWeek(v)}`} />
              <Legend />
              <Line type="monotone" dataKey="active_explorers" name="Explorers" stroke="var(--color-brand-500)" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="active_hosts" name="Hosts" stroke="var(--color-success-500)" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <Source>Active explorer = looked at the deck, opened, saved or scheduled a card, followed a host or got a ticket. Active host = created a brand, created, published or edited an event, scanned a ticket or made a sale. Source: Mingla&apos;s own records (app analytics are not used here).</Source>
      </SectionCard>
      <SectionCard title="Tickets per week" subtitle="last 12 weeks">
        <div className="h-60 w-full" role="img" aria-label="Paid and free tickets each week">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
              <XAxis dataKey="week_start" tick={CHART_TICK} tickFormatter={fmtWeek} />
              <YAxis tick={CHART_TICK} width={40} allowDecimals={false} />
              <Tooltip labelFormatter={(v) => `Week of ${fmtWeek(v)}`} />
              <Legend />
              <Bar dataKey="paid_tickets" name="Paid" stackId="t" fill="var(--color-brand-500)" isAnimationActive={false} />
              <Bar dataKey="free_tickets" name="Free" stackId="t" fill="var(--color-warning-500)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Source>Source: orders and tickets. Tickets bought by staff and test accounts left out.</Source>
      </SectionCard>
    </div>
  );
}

function MoneyWeekly({ money }) {
  const currencies = moneyCurrencies(money.data);
  const [picked, setPicked] = useState(null);
  const currency = picked && currencies.includes(picked) ? picked : currencies[0];
  const rows = weeklyMoney(money.data, currency);
  return (
    <SectionCard
      title="Paid by buyers per week"
      subtitle={currency ? `${currency}, with the Mingla fee · same figures as Mingla money` : "same figures as Mingla money"}
      action={currencies.length > 1 ? (
        <Segmented label="Currency" options={currencies.map((c) => ({ id: c, label: c }))} value={currency} onChange={setPicked} />
      ) : null}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">No paid sales in the last 26 weeks. Each week&apos;s sales appear here.</p>
      ) : (
        <div className="h-60 w-full" role="img" aria-label={`Paid by buyers and Mingla fee per week in ${currency}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" vertical={false} />
              <XAxis dataKey="week" tick={CHART_TICK} tickFormatter={fmtWeek} />
              <YAxis tick={CHART_TICK} width={80} tickFormatter={(v) => formatMoneyMinor(Math.round(v * 100), currency)} />
              <Tooltip formatter={(v, name) => [formatMoneyMinor(Math.round(Number(v) * 100), currency), name]} labelFormatter={(v) => `Week of ${fmtWeek(v)}`} />
              <Legend />
              <Bar dataKey="paid" name="Paid by buyers" fill="var(--color-brand-500)" isAnimationActive={false} />
              <Bar dataKey="fee" name="Mingla fee" fill="var(--color-success-500)" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <Source>Each currency is shown on its own; currencies are never added together. Source: orders and the payout ledger, as on Mingla money.</Source>
    </SectionCard>
  );
}

export function DataRoomOverview({ loads }) {
  const { users, overview, funnels, retention, money } = loads;
  return (
    <div className="flex flex-col gap-5">
      <SectionGate loads={[users]} title="Couldn't load All users" height={320}>
        {users.data ? <AllUsers users={users} /> : null}
      </SectionGate>
      <SectionGate loads={[users]} title="Couldn't load Ticket buyers" height={120}>
        {users.data ? <TicketBuyers users={users} /> : null}
        {users.data ? <HostContacts users={users} /> : null}
      </SectionGate>
      <SectionGate loads={[overview, retention, money]} title="Couldn't load the headline numbers" height={100}>
        {overview.data && retention.data && money.data ? <Headlines overview={overview} retention={retention} money={money} /> : null}
      </SectionGate>
      <SectionGate loads={[funnels]} title="Couldn't load Working / Not working">
        {funnels.data ? <Verdicts funnels={funnels} /> : null}
      </SectionGate>
      <SectionGate loads={[overview]} title="Couldn't load the weekly charts" height={260}>
        {overview.data ? <Weekly overview={overview} /> : null}
      </SectionGate>
      <SectionGate loads={[money]} title="Couldn't load money per week" height={260}>
        {money.data ? <MoneyWeekly money={money} /> : null}
      </SectionGate>
    </div>
  );
}
