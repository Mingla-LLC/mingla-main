// Issue #3980 (R7) — the Work board as columns side by side: Needs you,
// To do, In progress, Done this week. Each column counts its cards and says
// "Nothing here." when empty. Columns keep at least 220px; when the board is
// narrower they scroll sideways inside the board box only, never the page.
import { Avatars } from "./OpsChip";
import { WORK_COLUMNS, cardReasons, columnCards, dayLabel, groupCards, workStatusLabel } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

export function WorkColumnCard({ card, selected, onSelect, showStatus = false }) {
  const reasons = cardReasons(card);
  return (
    <button
      type="button"
      data-card-id={card.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(card)}
      className={`flex w-full min-w-0 flex-col gap-1.5 rounded-xl border bg-[var(--color-background-primary)] p-2.5 text-left hover:border-[var(--gray-300)] ${selected ? "border-[var(--color-brand-500)] shadow-[inset_0_0_0_1px_var(--color-brand-500)]" : "border-[var(--gray-200)]"} ${FOCUS}`}
    >
      <span className={`text-[13px] font-semibold leading-snug text-[var(--color-text-primary)] ${WORDS}`}>{card.title}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
        {/* Grouped by Person or Event there are no status columns, so each card says its status. */}
        {showStatus && workStatusLabel(card.status) && <span data-card-status={card.status} className="rounded-full border border-[var(--gray-300)] bg-[var(--gray-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-text-secondary)]">{workStatusLabel(card.status)}</span>}
        {(card.owners || []).length ? <Avatars people={card.owners} /> : <span aria-label="No owner" className="inline-grid h-6 w-6 place-items-center rounded-full border border-dashed border-[var(--gray-400)] text-[10px]">?</span>}
        {card.due_on && <span className="tabular-nums">{dayLabel(card.due_on)}</span>}
        {card.auto && <span>from the timeline</span>}
        {card.status === "done" && card.close_kind === "system" && <span>closed by itself</span>}
      </span>
      {/* working.name is already the agent's label: "Seth's Claude (Hosts sweep)". */}
      {card.working && card.status !== "done" && (
        <span className={`text-[11.5px] font-semibold text-[var(--color-brand-700)] ${WORDS}`}><span aria-hidden="true">● </span>{card.working.name || "An agent"} is on it</span>
      )}
      {reasons.length > 0 && (
        <span className="flex min-w-0 flex-wrap gap-1">
          {reasons.map((r) => <span key={r} className="rounded-full bg-[var(--color-error-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-error-700)]">{r}</span>)}
        </span>
      )}
    </button>
  );
}

export function WorkColumns({ cards = [], selectedId, onSelect, today }) {
  return (
    <div data-work-columns="" className="min-w-0 overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-[var(--gray-50)] p-2">
      <div className="grid min-w-0 gap-2" style={{ gridAutoFlow: "column", gridAutoColumns: "minmax(220px, 1fr)" }}>
        {WORK_COLUMNS.map((col) => {
          const list = columnCards(cards, col.key, today);
          return (
            <section key={col.key} aria-labelledby={`work-col-${col.key}`} className="flex min-w-0 flex-col gap-2">
              <h2 id={`work-col-${col.key}`} className="flex items-center justify-between px-1 pt-1 text-[12.5px] font-semibold text-[var(--color-text-primary)]">
                <span>{col.label}</span>
                <span className="rounded-full bg-[var(--color-background-primary)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-text-secondary)]">{list.length}</span>
              </h2>
              {list.length === 0
                ? <p className="px-1.5 pb-1 text-[12.5px] text-[var(--color-text-tertiary)]">Nothing here.</p>
                : <ul className="flex min-w-0 flex-col gap-1.5">{list.map((card) => <li key={card.id} className="min-w-0"><WorkColumnCard card={card} selected={card.id === selectedId} onSelect={onSelect} /></li>)}</ul>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Group by Person or Event: the same cards as a grouped list (each group's
 * name and count, its cards side by side as space allows). Never shown with
 * the column board.
 */
export function WorkGroups({ cards = [], group, selectedId, onSelect }) {
  const groups = groupCards(cards, group);
  return (
    <div data-work-groups={group} className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--gray-50)] p-2">
      {groups.length === 0 && <p className="px-1.5 py-1 text-[12.5px] text-[var(--color-text-tertiary)]">Nothing here.</p>}
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`work-group-${g.key}`} className="flex min-w-0 flex-col gap-2">
          <h2 id={`work-group-${g.key}`} className="flex items-center justify-between gap-2 px-1 pt-1 text-[12.5px] font-semibold text-[var(--color-text-primary)]">
            <span className={`min-w-0 ${WORDS}`}>{g.title}</span>
            <span className="rounded-full bg-[var(--color-background-primary)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-text-secondary)]">{g.cards.length}</span>
          </h2>
          <ul className="grid min-w-0 gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))" }}>
            {g.cards.map((card) => <li key={card.id} className="min-w-0"><WorkColumnCard card={card} selected={card.id === selectedId} onSelect={onSelect} showStatus /></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
