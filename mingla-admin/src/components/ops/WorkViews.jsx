// Issue #4130 (Wave 1) — the Work page's Today, This week and This month
// views. Every number is counted on the server (ops_events_since,
// ops_period_summary, ops_work_list); this file only lays them out. A failed
// load shows LoadError with Retry, never a 0.
//
//   Today       standup per person (closed since yesterday 09:00, in
//               progress, blocked or waiting) and what changed in 24 hours
//   This week   closed, opened, overdue, carried; by person; closed per week
//               for 8 weeks; the review list (late, quiet, no owner)
//   This month  closed (vs the same days last month), opened, on time,
//               carried 2+; by person; closed per week by person; biggest
//               things shipped; kept slipping
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SectionCard } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { useAuth } from "../../context/AuthContext";
import { useOpsPoll } from "../../hooks/useOpsWork";
import * as ops from "../../services/opsService";
import { opsErrorWords } from "../../lib/opsModel";
import { loadToday } from "./workToday";
import { trendTone } from "../../lib/trendTone";
import {
  deltaWords,
  eventVerb,
  feedTime,
  monthName,
  monthRange,
  onTimePercent,
  percentDeltaWords,
  previousMonthRange,
  recentWeeksRange,
  shortDay,
  standupPeople,
  standupRows,
  viewerTimeZone,
  weekRange,
  weekStart,
} from "../../lib/workViews";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:anywhere]";
const SERIES = ["var(--color-brand-500)", "var(--color-info-500)", "var(--color-success-500)", "var(--color-warning-500)", "var(--color-error-500)", "var(--gray-500)"];
const TH = "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]";
const TD = "px-3 py-2 text-[13px] tabular-nums";

function Loading({ label }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-busy="true" aria-label={label}>
      <Skeleton height={140} /><Skeleton height={140} />
    </div>
  );
}

function Failed({ title, read }) {
  return <LoadError title={title} message={opsErrorWords(read.error)} onRetry={() => read.refetch()} />;
}

function Tile({ label, value, note, tone, alert = false }) {
  const t = trendTone(tone);
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 shadow-[var(--shadow-sm)]">
      <span className="text-[12px] text-[var(--color-text-tertiary)]">{label}</span>
      <span className={`text-[24px] font-bold tabular-nums ${alert ? "text-[var(--color-error-700)]" : "text-[var(--color-text-primary)]"}`}>{value}</span>
      {note ? <span className={`text-[12px] ${tone === undefined ? "text-[var(--color-text-tertiary)]" : t.className}`}>{note}</span> : null}
    </div>
  );
}

function CardLink({ card, onOpenCard, children }) {
  return (
    <button type="button" onClick={() => onOpenCard(card.id)} className={`min-h-11 shrink-0 rounded-lg border border-[var(--gray-300)] px-3 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>
      {children || "Open"}
    </button>
  );
}

function names(list) {
  return Array.isArray(list) && list.length ? list.join(", ") : "No owner";
}

// ── Today ────────────────────────────────────────────────────────────────

export function WorkToday({ owner, people, onOpenCard }) {
  const { access } = useAuth();
  const read = useOpsPoll(() => loadToday(owner), { key: `${access?.email || ""}|today|${owner || ""}`, intervalMs: 60_000 });
  if (read.loading) return <Loading label="Loading today" />;
  if (read.error && !read.data) return <Failed title="Couldn’t load today" read={read} />;
  const data = read.data;
  const rows = standupRows(standupPeople(people, owner), data.cards, data.standup?.by_person);
  const feed = Array.isArray(data.feed?.entries) ? data.feed.entries : [];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <SectionCard title="Standup" subtitle="since yesterday 09:00 · one line each">
        {rows.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Nobody to show yet. Teammates appear here once they are on the team.</p>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
            {rows.map((r) => (
              <li key={r.email} data-standup={r.email} className="flex min-w-0 flex-col gap-1 py-2.5">
                <b className="text-[13.5px] text-[var(--color-text-primary)]">{r.name}</b>
                <span className={`text-[12.5px] text-[var(--color-text-secondary)] ${WORDS}`}>
                  <b className="text-[var(--color-text-primary)]">Done:</b> {r.done} card{r.done === 1 ? "" : "s"} · <b className="text-[var(--color-text-primary)]">Today:</b> {r.doing[0]?.title || "nothing in progress"}{r.doing.length > 1 ? ` +${r.doing.length - 1}` : ""}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--color-text-secondary)]">
                  <b className="text-[var(--color-text-primary)]">Blocked or waiting:</b>
                  {r.blocked.length === 0 ? "none" : r.blocked.slice(0, 6).map((c) => (
                    <button key={c.id} type="button" onClick={() => onOpenCard(c.id)} className={`max-w-full truncate rounded-full border border-[var(--gray-300)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`}>{c.title}</button>
                  ))}
                  {r.blocked.length > 6 && <span>+{r.blocked.length - 6} more</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.truncated && <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">Only the first 300 open cards are read here. Pick a person to see all of theirs.</p>}
      </SectionCard>
      <SectionCard title="What changed" subtitle="last 24 hours">
        {feed.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing changed on any card in the last 24 hours. Changes appear here as people and agents work.</p>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
            {feed.map((e) => (
              <li key={e.id} className="grid min-w-0 grid-cols-[86px_minmax(0,1fr)] items-start gap-2 py-2 text-[13px]">
                <time dateTime={e.at} className="text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{feedTime(e.at)}</time>
                <span className={`min-w-0 ${WORDS}`}>
                  <b>{e.actor_name}</b>{e.via === "claude" ? "’s Claude" : e.via === "codex" ? "’s Codex" : ""} {eventVerb(e)}{" "}
                  <button type="button" onClick={() => onOpenCard(e.card.id)} className={`font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>{e.card.title}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {data.feed?.truncated && <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">Showing the newest {feed.length} of {data.feed.total} changes.</p>}
      </SectionCard>
    </div>
  );
}

// ── This week ────────────────────────────────────────────────────────────

function ReasonPills({ row }) {
  return (
    <span className="flex shrink-0 flex-wrap gap-1">
      {row.late_days ? <span className="rounded-full bg-[var(--color-error-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-error-700)]">{row.late_days}d late</span> : null}
      {row.quiet_days ? <span className="rounded-full bg-[var(--color-warning-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-warning-700)]">quiet {row.quiet_days}d</span> : null}
      {row.no_owner ? <span className="rounded-full bg-[var(--color-warning-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-warning-700)]">No owner</span> : null}
    </span>
  );
}

function PersonTable({ label, rows, columns }) {
  if (!rows.length) return <p className="text-[13px] text-[var(--color-text-secondary)]">No cards with an owner in this period yet. People appear here once they own a card.</p>;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[420px] text-left" aria-label={label}>
        <thead className="bg-[var(--gray-50)]"><tr><th scope="col" className={TH}>Person</th>{columns.map((c) => <th key={c.key} scope="col" className={`${TH} text-right`}>{c.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-[var(--gray-100)]">
          {rows.map((p) => (
            <tr key={p.email}>
              <th scope="row" className="px-3 py-2 text-[13px] font-medium text-[var(--color-text-primary)]">{p.name}</th>
              {columns.map((c) => <td key={c.key} className={`${TD} text-right`}>{c.value(p)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const dash = (n) => (Number(n) ? n : "–");

export function WorkWeek({ owner, onOpenCard }) {
  const { access } = useAuth();
  const tz = viewerTimeZone();
  const key = `${access?.email || ""}|week|${owner || ""}|${weekStart().toISOString()}`;
  const read = useOpsPoll(async () => {
    const now = new Date();
    const w = weekRange(now);
    const h = recentWeeksRange(now, 8);
    const [summary, history] = await Promise.all([
      ops.fetchPeriodSummary(w.from.toISOString(), w.to.toISOString(), owner, tz),
      ops.fetchPeriodSummary(h.from.toISOString(), h.to.toISOString(), owner, tz),
    ]);
    return { summary, history };
  }, { key, intervalMs: 120_000 });
  if (read.loading) return <Loading label="Loading this week" />;
  if (read.error && !read.data) return <Failed title="Couldn’t load this week" read={read} />;
  const { summary, history } = read.data;
  const t = summary?.totals || {};
  const weeks = Array.isArray(history?.weeks) ? history.weeks : [];
  const lastWeek = weeks.length >= 2 ? weeks[weeks.length - 2].closed : null;
  const delta = deltaWords(t.closed, lastWeek, "last week");
  const people = Array.isArray(summary?.by_person) ? summary.by_person : [];
  const review = Array.isArray(summary?.review) ? summary.review : [];
  const chart = weeks.map((w) => ({ week: shortDay(w.week), closed: Number(w.closed) || 0 }));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Closed this week" value={t.closed ?? 0} note={delta.text} tone={delta.up} />
        <Tile label="Opened this week" value={t.opened ?? 0} />
        <Tile label="Overdue now" value={t.overdue_now ?? 0} alert={Number(t.overdue_now) > 0} />
        <Tile label="Carried from last week" value={t.carried ?? 0} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="By person" subtitle={`week of ${shortDay(summary?.from)}`} noPadding>
          <PersonTable label="This week by person" rows={people} columns={[
            { key: "closed", label: "Closed", value: (p) => p.closed },
            { key: "open", label: "Open", value: (p) => p.open_now },
            { key: "late", label: "Late", value: (p) => dash(p.late_now) },
            { key: "quiet", label: "Quiet", value: (p) => dash(p.quiet_now) },
            { key: "carried", label: "Carried", value: (p) => dash(p.carried) },
          ]} />
        </SectionCard>
        <SectionCard title="Closed per week" subtitle="last 8 weeks">
          <div className="h-[220px] min-w-0" role="img" aria-label={`Cards closed per week: ${chart.map((c) => `${c.week} ${c.closed}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} stroke="var(--gray-200)" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: "var(--gray-100)" }} />
                <Bar dataKey="closed" name="Closed" fill="var(--color-brand-500)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>
      <SectionCard title="Review list" subtitle="talk about these in the weekly">
        {review.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing to review: no open card is late, quiet for a week or without an owner.</p>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
            {review.map((r) => (
              <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2">
                <ReasonPills row={r} />
                <span className={`min-w-0 flex-1 text-[13px] ${WORDS}`}>
                  <span className="font-medium text-[var(--color-text-primary)]">{r.title}</span>
                  <span className="block text-[12px] text-[var(--color-text-tertiary)]">{names(r.owners)} · due {shortDay(r.due_on)}</span>
                </span>
                <CardLink card={r} onOpenCard={onOpenCard} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

// ── This month ───────────────────────────────────────────────────────────

export function WorkMonth({ owner, onOpenCard }) {
  const { access } = useAuth();
  const tz = viewerTimeZone();
  const now = new Date();
  const key = `${access?.email || ""}|month|${owner || ""}|${monthRange(now).from.toISOString()}`;
  const read = useOpsPoll(async () => {
    const at = new Date();
    const m = monthRange(at);
    const p = previousMonthRange(at);
    const [summary, before] = await Promise.all([
      ops.fetchPeriodSummary(m.from.toISOString(), m.to.toISOString(), owner, tz),
      ops.fetchPeriodSummary(p.from.toISOString(), p.to.toISOString(), owner, tz),
    ]);
    return { summary, before };
  }, { key, intervalMs: 300_000 });
  if (read.loading) return <Loading label="Loading this month" />;
  if (read.error && !read.data) return <Failed title="Couldn’t load this month" read={read} />;
  const { summary, before } = read.data;
  const t = summary?.totals || {};
  const month = monthName(now);
  const delta = percentDeltaWords(t.closed, before?.totals?.closed, `the same days of ${monthName(now, -1)}`);
  const onTime = onTimePercent(t.closed, t.on_time);
  const people = Array.isArray(summary?.by_person) ? summary.by_person : [];
  const weeks = Array.isArray(summary?.weeks) ? summary.weeks : [];
  const chartPeople = people.slice(0, SERIES.length);
  const chart = weeks.map((w) => {
    const row = { week: shortDay(w.week) };
    for (const p of chartPeople) row[p.email] = Number(w.by_person?.[p.email]) || 0;
    return row;
  });
  const shipped = Array.isArray(summary?.shipped) ? summary.shipped : [];
  const slipping = Array.isArray(summary?.slipping) ? summary.slipping : [];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Closed in ${month}`} value={t.closed ?? 0} note={delta.text} tone={delta.up} />
        <Tile label={`Opened in ${month}`} value={t.opened ?? 0} />
        <Tile label="Closed on time" value={onTime === null ? "–" : `${onTime}%`} note={onTime === null ? "nothing closed yet" : "on or before the due date"} />
        <Tile label="Carried more than once" value={t.carried_twice ?? 0} alert={Number(t.carried_twice) > 0} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title={`${month} by person`} subtitle={`${shortDay(summary?.from)} to ${shortDay(new Date())}`} noPadding>
          <PersonTable label={`${month} by person`} rows={people} columns={[
            { key: "closed", label: "Closed", value: (p) => p.closed },
            { key: "opened", label: "Opened", value: (p) => p.opened },
            { key: "ontime", label: "On time", value: (p) => { const pct = onTimePercent(p.closed, p.on_time); return pct === null ? "–" : `${pct}%`; } },
            { key: "late", label: "Late now", value: (p) => dash(p.late_now) },
            { key: "carried", label: "Carried", value: (p) => dash(p.carried) },
          ]} />
        </SectionCard>
        <SectionCard title="Closed per week" subtitle="by person">
          {chartPeople.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No card with an owner closed this month yet. Each week’s closed cards appear here by person.</p>
          ) : (
            <>
              <ul className="mb-2 flex flex-wrap gap-3 text-[12px] text-[var(--color-text-secondary)]" aria-hidden="true">
                {chartPeople.map((p, i) => <li key={p.email} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} />{p.name}</li>)}
              </ul>
              <div className="h-[220px] min-w-0" role="img" aria-label={`Cards closed per week by person: ${chart.map((c) => `${c.week} ${chartPeople.map((p) => `${p.name} ${c[p.email]}`).join(", ")}`).join("; ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                    <CartesianGrid vertical={false} stroke="var(--gray-200)" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: "var(--gray-100)" }} />
                    {chartPeople.map((p, i) => <Bar key={p.email} dataKey={p.email} name={p.name} stackId="closed" fill={SERIES[i]} isAnimationActive={false} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </SectionCard>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Biggest things shipped" subtitle="closed by a person, linked GitHub work first">
          {shipped.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing closed yet this month. Cards people close appear here, the ones linked to GitHub first.</p>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
              {shipped.map((s) => (
                <li key={s.id} className="flex min-w-0 items-center gap-2 py-2">
                  <span className="rounded-full bg-[var(--color-success-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-success-700)]">Done</span>
                  <span className={`min-w-0 flex-1 text-[13px] ${WORDS}`}>
                    <span className="font-medium text-[var(--color-text-primary)]">{s.title}</span>
                    <span className="block text-[12px] text-[var(--color-text-tertiary)]">{names(s.owners)} · {shortDay(s.closed_at)}{s.github ? " · GitHub" : ""}</span>
                  </span>
                  <CardLink card={s} onOpenCard={onOpenCard} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Kept slipping" subtitle="carried into a new week 2+ times this month">
          {slipping.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing has slipped twice this month. Cards carried into a new week two or more times appear here.</p>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
              {slipping.map((s) => (
                <li key={s.id} className="flex min-w-0 items-center gap-2 py-2">
                  <span className="rounded-full bg-[var(--color-warning-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-warning-700)]">{s.times}x</span>
                  <span className={`min-w-0 flex-1 text-[13px] ${WORDS}`}>
                    <span className="font-medium text-[var(--color-text-primary)]">{s.title}</span>
                    <span className="block text-[12px] text-[var(--color-text-tertiary)]">{names(s.owners)} · carried since {shortDay(s.first_carried_at)}</span>
                  </span>
                  <CardLink card={s} onOpenCard={onOpenCard} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
