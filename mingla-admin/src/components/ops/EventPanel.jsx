// Issue #3980 — the Calendar's right column. With nothing selected: the
// Runway list of upcoming events by plain state. With an event (or a promised
// event) selected: its state, what just happened, the one sentence that says
// why, the eight steps made by themselves, the host and the cards linked to
// it. Two columns from 1180px, stacked below; no overlay.
import { forwardRef } from "react";
import { X } from "lucide-react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { OpsChip } from "./OpsChip";
import { StatePill } from "./StateDot";
import { EventSteps } from "./EventSteps";
import { JustHappened } from "./JustHappened";
import { useOpsAnchor, useOpsRunway } from "../../hooks/useOpsCalendar";
import { buildCrmHash } from "../../lib/crmUrl";
import { EVENT_TYPE_LABELS, WORK_STATUSES, dayLabel, dayLong, opsErrorWords } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const LINK = `inline-flex min-h-11 items-center rounded-full border border-[var(--gray-300)] px-3 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-50)] ${FOCUS}`;
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";
const GROUPS = [
  { k: "notlive", label: "Needs to go live" },
  { k: "short", label: "Promote now" },
  { k: "ready", label: "Ready to promote" },
  { k: "late", label: "Too late for promo" },
];

function Loading({ label }) {
  return (
    <SectionCard>
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">{label}</span>
        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--gray-100)]" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--gray-100)]" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--gray-100)]" />
      </div>
    </SectionCard>
  );
}

const RunwayList = forwardRef(function RunwayList({ onSelect }, headingRef) {
  const runway = useOpsRunway();
  if (runway.loading) return <Loading label="Loading the runway list…" />;
  if (runway.error && !runway.data) {
    return (
      <AlertCard variant="error" title="Couldn’t load the runway list" action={<Button variant="secondary" className="min-h-11" onClick={() => runway.refetch()}>Try again</Button>}>
        {opsErrorWords(runway.error)}
      </AlertCard>
    );
  }
  const rows = Array.isArray(runway.data?.rows) ? runway.data.rows : [];
  return (
    <SectionCard title={<span ref={headingRef} tabIndex={-1} className="focus-visible:outline-none">Runway</span>} subtitle="Next 90 days">
      {rows.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">No events in the next 90 days. Add the next event a host has promised on their host card.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          {GROUPS.map((g) => {
            const list = rows.filter((r) => r.state?.k === g.k);
            if (!list.length) return null;
            return (
              <section key={g.k} aria-label={g.label} className="min-w-0">
                <h3 className="mb-1 flex items-center justify-between text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"><span>{g.label}</span><span className="tabular-nums">{list.length}</span></h3>
                <ul className="flex min-w-0 flex-col gap-1">
                  {list.map((row) => (
                    <li key={`${row.anchor_kind}:${row.anchor_id}:${row.start_on}`}>
                      <button
                        type="button"
                        data-runway-row={`${row.anchor_kind}:${row.anchor_id}`}
                        onClick={() => onSelect({ kind: row.anchor_kind, id: row.anchor_id }, row.start_on)}
                        className={`flex min-h-11 w-full min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[13.5px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{row.title}</span>
                          <span className={`block text-[12px] text-[var(--color-text-tertiary)] ${WORDS}`}>{dayLong(row.start_on)}{row.host_name ? ` · ${row.host_name}` : ""}</span>
                        </span>
                        <StatePill state={row.state} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
});

const SelectedEvent = forwardRef(function SelectedEvent({ selection, onBack }, headingRef) {
  const detail = useOpsAnchor(selection);
  if (detail.loading) return <Loading label="Loading the event…" />;
  if (detail.error && !detail.data) {
    return (
      <AlertCard variant="error" title="That event isn’t on the Calendar" action={<Button variant="secondary" className="min-h-11" onClick={onBack}>Back to runway</Button>}>
        {opsErrorWords(detail.error)}
      </AlertCard>
    );
  }
  const data = detail.data || {};
  const a = data.anchor || {};
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const host = data.host;
  const type = EVENT_TYPE_LABELS[a.event_type] || "Event";
  return (
    <SectionCard>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap gap-1.5">
            <StatePill state={data.state} />
            {a.kind === "expected" && <OpsChip dashed>{type === "Promo moment" ? "Promo moment" : "Promised"}</OpsChip>}
          </span>
          <button type="button" aria-label="Close the event" onClick={onBack} className={`inline-grid h-11 w-11 place-items-center rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--gray-100)] ${FOCUS}`}>
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <JustHappened target={`${a.kind}:${a.id}`} items={data.changes} />
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className={`text-[17px] font-semibold text-[var(--color-text-primary)] focus-visible:outline-none ${WORDS}`}>{a.title}</h2>
          <p className={`mt-0.5 text-[13px] text-[var(--color-text-tertiary)] ${WORDS}`}>{host?.name || a.brand_name || "No host card yet"} · {dayLong(a.start_on)}</p>
        </div>
        {data.say && <p className={`rounded-xl bg-[var(--gray-100)] px-3 py-2.5 text-[13.5px] text-[var(--color-text-primary)] ${WORDS}`}>{data.say}</p>}
        <EventSteps steps={Array.isArray(data.steps) ? data.steps : []} doneCount={Number(data.done_count || 0)} />

        <section aria-labelledby="event-host-heading" className="flex min-w-0 flex-col gap-1 border-t border-[var(--gray-200)] pt-3">
          <h3 id="event-host-heading" className="text-[13px] font-semibold text-[var(--color-text-primary)]">Host</h3>
          {host ? (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className={`min-w-0 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>{host.name}{host.owners?.length ? ` · ${host.owners.join(", ")}` : " · No owner yet"}</span>
              <a href={buildCrmHash("hosts", { card: host.record_id })} className={LINK}>Open host</a>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No host card is linked to this brand yet.</p>
          )}
        </section>

        <section aria-labelledby="event-cards-heading" className="flex min-w-0 flex-col gap-1 border-t border-[var(--gray-200)] pt-3">
          <h3 id="event-cards-heading" className="text-[13px] font-semibold text-[var(--color-text-primary)]">Work cards</h3>
          {cards.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No work cards are linked to this event yet.</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-1">
              {cards.map((c) => (
                <li key={c.id}>
                  <a href={`#/work-board?card=${c.id}`} className={`flex min-h-11 min-w-0 flex-wrap items-start justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--gray-50)] ${FOCUS}`}>
                    <span className={`min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>Card {c.number}: {c.title}{c.due_on ? ` · due ${dayLabel(c.due_on)}` : ""}</span>
                    <OpsChip tone={c.status === "done" ? "success" : c.blocked ? "error" : "brand"} className="shrink-0 whitespace-nowrap">{c.blocked && c.status !== "done" ? "Blocked" : WORK_STATUSES.find((s) => s.value === c.status)?.label || c.status}</OpsChip>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SectionCard>
  );
});

export const EventPanel = forwardRef(function EventPanel({ selection, onSelect, onBack, online }, headingRef) {
  return selection
    ? <SelectedEvent key={`${selection.kind}:${selection.id}`} ref={headingRef} selection={selection} onBack={onBack} online={online} />
    : <RunwayList ref={headingRef} onSelect={onSelect} />;
});
