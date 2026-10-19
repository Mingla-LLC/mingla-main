// Issue #3980 — the Calendar's right column. With nothing selected: the
// Runway list of upcoming events. With an event (or an expected event)
// selected: its runway bar, the launch kit and each step's card, the host and
// the cards linked to it. Two columns, no overlay.
import { forwardRef } from "react";
import { ArrowLeft } from "lucide-react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { OpsChip } from "./OpsChip";
import { RunwayBar } from "./RunwayBar";
import { useOpsAnchor, useOpsRunway } from "../../hooks/useOpsCalendar";
import { buildCrmHash } from "../../lib/crmUrl";
import {
  EVENT_TYPE_LABELS,
  KIT_WHO,
  WORK_STATUSES,
  bandShort,
  bandTone,
  dayLabel,
  kitStateChip,
  opsErrorWords,
  runwayLabel,
  todayIso,
} from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const LINK = `inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`;

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

function RunwayList({ onSelect }) {
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
  const counts = runway.data?.counts || {};
  return (
    <SectionCard title="Runway" subtitle="Next 90 days">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <OpsChip tone="success">{counts.full || 0} full launch</OpsChip>
          <OpsChip tone="warning">{counts.tight || 0} tight</OpsChip>
          <OpsChip tone="error">{counts.organic || 0} organic only</OpsChip>
          <OpsChip tone="info">{counts.not_live || 0} not live yet</OpsChip>
          <OpsChip tone="error" dashed>{counts.missed || 0} missed</OpsChip>
        </div>
        {rows.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">No events in the next 90 days. Add the next event a host has promised on their host card.</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1">
            {rows.map((row) => (
              <li key={`${row.anchor_kind}:${row.anchor_id}`}>
                <button
                  type="button"
                  onClick={() => onSelect({ kind: row.anchor_kind, id: row.anchor_id }, row.start_on)}
                  className={`flex min-h-11 w-full min-w-0 items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--gray-50)] ${FOCUS}`}
                >
                  <span className="min-w-0">
                    <span className="block break-words text-[13.5px] font-semibold text-[var(--color-text-primary)]">{row.title}</span>
                    <span className="block break-words text-[12px] text-[var(--color-text-tertiary)]">{dayLabel(row.start_on)}{row.host_name ? ` · ${row.host_name}` : ""}</span>
                  </span>
                  <OpsChip tone={bandTone(row.band)} dashed={row.anchor_kind === "expected" || row.band === "missed"}>{bandShort(row)}</OpsChip>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

const SelectedEvent = forwardRef(function SelectedEvent({ selection, onBack }, headingRef) {
  const detail = useOpsAnchor(selection);
  if (detail.loading) return <Loading label="Loading the event…" />;
  if (detail.error && !detail.data) {
    return (
      <AlertCard variant="error" title="That event isn’t on the Calendar" action={<Button variant="secondary" icon={ArrowLeft} className="min-h-11" onClick={onBack}>Back to runway</Button>}>
        {opsErrorWords(detail.error)}
      </AlertCard>
    );
  }
  const data = detail.data || {};
  const a = data.anchor || {};
  const expected = a.kind === "expected";
  const kit = Array.isArray(data.kit) ? data.kit : [];
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const host = data.host;
  const type = EVENT_TYPE_LABELS[a.event_type] || "Event";
  const when = expected
    ? " · promised on the host card"
    : a.is_public
      ? ` · public since ${dayLabel(a.published_at)}`
      : " · not public yet";
  return (
    <SectionCard>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap gap-1.5">
            <OpsChip dashed={expected}>{type}{a.city ? ` · ${a.city}` : ""}</OpsChip>
            <OpsChip tone={bandTone(a.runway?.band)} dashed={expected || a.runway?.band === "missed"}>{bandShort(a.runway)}</OpsChip>
          </span>
          <Button variant="ghost" size="sm" icon={ArrowLeft} className="min-h-11" onClick={onBack}>Back to runway</Button>
        </div>
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="break-words text-[16px] font-semibold text-[var(--color-text-primary)] focus-visible:outline-none">{a.title}</h2>
          <p className="mt-0.5 break-words text-[13px] text-[var(--color-text-secondary)]">{a.brand_name || "No brand linked"} · {dayLabel(a.start_on)}{when}</p>
        </div>
        <RunwayBar anchor={a} today={todayIso()} />
        <p className="text-[13px] text-[var(--color-text-primary)]">{runwayLabel(a.runway)}</p>

        <section aria-labelledby="event-kit-heading" className="flex min-w-0 flex-col gap-1 border-t border-[var(--gray-200)] pt-3">
          <h3 id="event-kit-heading" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Launch kit</h3>
          <ul className="flex min-w-0 flex-col divide-y divide-[var(--gray-100)]">
            {kit.map((row) => {
              const chip = kitStateChip(row);
              const body = (
                <>
                  <span className="w-14 shrink-0 text-[12px] tabular-nums text-[var(--color-text-tertiary)]">{dayLabel(row.date) || `T${row.step > 0 ? "+" : ""}${row.step}`}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block break-words text-[13px] text-[var(--color-text-primary)] ${row.gate ? "font-semibold" : ""}`}>{row.title}</span>
                    <span className="block text-[12px] text-[var(--color-text-tertiary)]">{KIT_WHO[row.who] || row.who}</span>
                  </span>
                  <OpsChip tone={chip.tone}>{chip.label}</OpsChip>
                </>
              );
              return (
                <li key={row.step}>
                  {row.card ? (
                    <a href={`#/work-board?card=${row.card.id}`} className={`flex min-h-11 min-w-0 items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--gray-50)] ${FOCUS}`}>{body}</a>
                  ) : (
                    <div className="flex min-h-11 min-w-0 items-start gap-2 px-1 py-1.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="event-host-heading" className="flex min-w-0 flex-col gap-1 border-t border-[var(--gray-200)] pt-3">
          <h3 id="event-host-heading" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Host</h3>
          {host ? (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 break-words text-[13px] text-[var(--color-text-primary)]">{host.name}{host.owners?.length ? ` · owner ${host.owners.join(", ")}` : " · no owner yet"}</span>
              <a href={buildCrmHash("hosts", { card: host.record_id })} className={LINK}>Open host card</a>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No host card is linked to this brand yet.</p>
          )}
        </section>

        <section aria-labelledby="event-cards-heading" className="flex min-w-0 flex-col gap-1 border-t border-[var(--gray-200)] pt-3">
          <h3 id="event-cards-heading" className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Work cards</h3>
          {cards.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">No work cards are linked to this event yet.</p>
          ) : (
            <ul className="flex min-w-0 flex-col gap-1">
              {cards.map((c) => (
                <li key={c.id}>
                  <a href={`#/work-board?card=${c.id}`} className={`flex min-h-11 min-w-0 items-start justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-[var(--gray-50)] ${FOCUS}`}>
                    <span className="min-w-0 break-words text-[13px] text-[var(--color-text-primary)]">Card {c.number}: {c.title}</span>
                    <OpsChip tone={c.status === "done" ? "success" : c.blocked ? "error" : "brand"}>{c.blocked && c.status !== "done" ? "Blocked" : WORK_STATUSES.find((s) => s.value === c.status)?.label || c.status}</OpsChip>
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

export const EventPanel = forwardRef(function EventPanel({ selection, onSelect, onBack }, headingRef) {
  return selection
    ? <SelectedEvent key={`${selection.kind}:${selection.id}`} ref={headingRef} selection={selection} onBack={onBack} />
    : <RunwayList onSelect={onSelect} />;
});
