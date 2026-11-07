// Issue #4255 — Work's Today, This week and This month: one layout (the
// approved PeriodView). Per person, four lists: Done (closed inside the
// window), Doing, Blocked and Needs your OK (#4270: tagged cards due by the
// window's end, overdue or undated). Each list shows three; "+N more" is a
// button that shows every card. The page's one filter bar has already
// filtered the cards (lib/workViews.js workFilter).
//
// Today ends with what changed in the last 24 hours and the agents' activity
// (D9: Activity moved from its own tab to the foot of Today).
//
// Replaces #4130's WorkToday (standup), WorkWeek and WorkMonth (charts and
// tables). A failed load shows LoadError with Retry, never a 0.
import { useState } from "react";
import { SectionCard } from "../ui/Card";
import { Skeleton } from "../ui/Skeleton";
import { LoadError } from "../ui/LoadError";
import { AgentActivity } from "./AgentActivity";
import { opsErrorWords } from "../../lib/opsModel";
import { PERIOD_BUCKETS, eventVerb, feedTime, periodRows, periodShown } from "../../lib/workViews";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:anywhere]";
const TONE = {
  done: "text-[var(--color-success-700)]",
  doing: "text-[var(--color-brand-700)]",
  blocked: "text-[var(--color-error-700)]",
  waiting: "text-[var(--color-warning-700)]",
};

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** One list of one person: three cards, then "+N more" to show the rest. */
export function PeriodList({ bucket, cards, expanded, onToggle, onOpenCard }) {
  const { shown, more } = periodShown(cards, expanded);
  return (
    <div data-period-bucket={bucket.key} className="flex min-w-0 flex-col gap-1">
      <h4 className={`flex items-center justify-between gap-2 text-[12px] font-semibold uppercase tracking-wide ${TONE[bucket.key]}`}>
        <span>{bucket.label}</span>
        <span className="tabular-nums" aria-label={`${cards.length} ${cards.length === 1 ? "card" : "cards"}`}>{cards.length}</span>
      </h4>
      {cards.length === 0 ? (
        <span className="text-[12.5px] text-[var(--color-text-tertiary)]">None</span>
      ) : (
        <ul className="flex min-w-0 flex-col gap-0.5">
          {shown.map((c) => (
            <li key={c.id} className="min-w-0">
              <button type="button" data-card-id={c.id} onClick={() => onOpenCard(c.id)} className={`min-h-9 w-full rounded-md px-1.5 py-1 text-left text-[12.5px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${WORDS} ${FOCUS}`}>
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(more > 0 || (expanded && cards.length > 3)) && (
        <button type="button" data-period-more={bucket.key} aria-expanded={expanded ? "true" : "false"} onClick={onToggle} className={`min-h-9 self-start rounded-md px-1.5 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>
          {expanded ? "Show less" : `+${more} more`}
        </button>
      )}
    </div>
  );
}

/** The four lists per person, with the window's totals on top. */
export function PeriodBody({ win, cards, people, onOpenCard, truncated = false }) {
  const [open, setOpen] = useState({});
  const { totals, rows } = periodRows(cards, win, people);
  return (
    <SectionCard noPadding>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--gray-200)] px-4 py-2.5 text-[12.5px] text-[var(--color-text-secondary)]">
        <span>{win.note}</span>
        <span data-period-totals="" className="tabular-nums">
          {PERIOD_BUCKETS.map((b, i) => <span key={b.key}>{i ? " · " : ""}{b.label} <b className="text-[var(--color-text-primary)]">{totals[b.key]}</b></span>)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-[var(--color-text-secondary)]">Nothing done, in progress, blocked or needing your OK in this window for these filters.</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
          {rows.map((r) => (
            <li key={r.email || "none"} data-period-person={r.email || "none"} className="grid min-w-0 grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[160px_repeat(4,minmax(0,1fr))]">
              <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold text-[var(--color-text-primary)]">
                <span aria-hidden="true" className="inline-grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--gray-100)] text-[11px] font-bold text-[var(--color-text-secondary)]">{initials(r.name)}</span>
                <span className={`min-w-0 ${WORDS}`}>{r.name}</span>
              </span>
              {PERIOD_BUCKETS.map((b) => {
                const key = `${r.email}|${b.key}`;
                return (
                  <PeriodList key={b.key} bucket={b} cards={r[b.key]} expanded={!!open[key]} onToggle={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} onOpenCard={onOpenCard} />
                );
              })}
            </li>
          ))}
        </ul>
      )}
      {truncated && <p className="border-t border-[var(--gray-200)] px-4 py-2 text-[12px] text-[var(--color-text-tertiary)]">More than 6,000 cards match. Pick a person or search to see all of them.</p>}
    </SectionCard>
  );
}

function WhatChanged({ feed, onOpenCard }) {
  const entries = Array.isArray(feed?.entries) ? feed.entries : [];
  return (
    <SectionCard title="What changed" subtitle="last 24 hours">
      {entries.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Nothing changed on any card in the last 24 hours. Changes appear here as people and agents work.</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
          {entries.map((e) => (
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
      {feed?.truncated && <p className="mt-2 text-[12px] text-[var(--color-text-tertiary)]">Showing the newest {entries.length} of {feed.total} changes.</p>}
    </SectionCard>
  );
}

/**
 * One period tab. `read` is the page's useOpsPoll of loadPeriod; `cards` the
 * same cards after the page's filter.
 */
export function PeriodView({ win, read, cards, people, onOpenCard }) {
  if (read.loading) {
    return (
      <div className="flex min-w-0 flex-col gap-3" aria-busy="true" aria-label={`Loading ${win.view === "today" ? "today" : win.view === "week" ? "this week" : "this month"}`}>
        <Skeleton height={44} /><Skeleton height={140} /><Skeleton height={140} />
      </div>
    );
  }
  if (read.error && !read.data) return <LoadError title="Couldn’t load these cards" message={opsErrorWords(read.error)} onRetry={() => read.refetch()} />;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PeriodBody win={win} cards={cards} people={people} onOpenCard={onOpenCard} truncated={!!read.data?.truncated} />
      {win.view === "today" && (
        <>
          <WhatChanged feed={read.data?.feed} onOpenCard={onOpenCard} />
          <AgentActivity />
        </>
      )}
    </div>
  );
}
