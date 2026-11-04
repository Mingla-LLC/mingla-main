// Issue #3980 (R7) — the Work board as columns side by side. Each column
// counts its cards and says "Nothing here." when empty.
//
// Issue #4270 (Wave 1) — three columns: To do, In progress, Done. To do and
// In progress list the latest-late card first, then by due date; Done lists
// this week's cards, latest due first. From 768px the three columns share the
// width (narrow columns wrap their text; nothing scrolls sideways). Below
// 768px one column shows at a time behind tabs with their counts. A card
// that needs a person carries its Send, Spend or Publish tag in any column.
import { useState } from "react";
import { Avatars } from "./OpsChip";
import { WORK_COLUMNS, cardReasons, columnCards, dayLabel, isTagged, personReasonLabel } from "../../lib/opsModel";
import { draftItemTitle } from "../../lib/workViews";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

export function WorkColumnCard({ card, selected, onSelect, draftsReady = 0 }) {
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
      {/* #4270: the Send, Spend or Publish tag, and whether its message draft is ready. */}
      {isTagged(card) && (
        <span className="flex min-w-0 flex-wrap gap-1">
          <span className="rounded-full bg-[var(--color-brand-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-brand-700)]">{personReasonLabel(card)}</span>
          {draftsReady > 0 && <span data-draft-ready="" className="rounded-full bg-[var(--color-info-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-info-700)]">Draft ready</span>}
        </span>
      )}
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-text-tertiary)]">
        {(card.owners || []).length ? <Avatars people={card.owners} /> : <span aria-label="No owner" className="inline-grid h-6 w-6 place-items-center rounded-full border border-dashed border-[var(--color-error-500)] text-[10px] text-[var(--color-error-700)]">?</span>}
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

// #4130: a waiting message draft that no open card carries, listed on its own
// at the top of To do (#4270). It opens the draft in the drawer.
export function DraftItem({ draft, selected, onOpen }) {
  return (
    <button
      type="button"
      data-draft-item={draft.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onOpen(draft)}
      className={`flex w-full min-w-0 flex-col gap-1.5 rounded-xl border bg-[var(--color-background-primary)] p-2.5 text-left hover:border-[var(--gray-300)] ${selected ? "border-[var(--color-brand-500)] shadow-[inset_0_0_0_1px_var(--color-brand-500)]" : "border-[var(--gray-200)]"} ${FOCUS}`}
    >
      <span className={`text-[13px] font-semibold leading-snug text-[var(--color-text-primary)] ${WORDS}`}>{draftItemTitle(draft)}</span>
      <span className="flex min-w-0 flex-wrap gap-1">
        <span className="rounded-full bg-[var(--color-brand-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-brand-700)]">You send</span>
        <span className="rounded-full bg-[var(--color-info-50)] px-2 py-px text-[11px] font-semibold text-[var(--color-info-700)]">Draft ready</span>
      </span>
      <span className="text-[11.5px] text-[var(--color-text-tertiary)]">Your draft · written by {draft.created_via === "claude" ? "Claude" : "Codex"}</span>
    </button>
  );
}

export function WorkColumns({ cards = [], selectedId, onSelect, today, drafts = [], draftsByCard = null, selectedDraftId = null, onOpenDraft, allDraftsHref = null }) {
  // Phones: one column at a time. The choice is the viewer's, for this visit.
  const [active, setActive] = useState("todo");
  const columns = WORK_COLUMNS.map((col) => {
    const list = columnCards(cards, col.key, today);
    // Loose message drafts (no open card carries them) sit at the top of To do.
    const extra = col.key === "todo" && onOpenDraft ? drafts : [];
    return { ...col, list, extra, count: list.length };
  });
  return (
    <div data-work-columns="" className="min-w-0 rounded-xl border border-[var(--gray-200)] bg-[var(--gray-50)] p-2">
      <div role="tablist" aria-label="Column" data-column-tabs="" className="mb-2 grid grid-cols-3 gap-1 md:hidden">
        {columns.map((col) => (
          <button
            key={col.key}
            type="button"
            role="tab"
            id={`work-col-tab-${col.key}`}
            aria-selected={active === col.key}
            aria-controls={`work-col-panel-${col.key}`}
            onClick={() => setActive(col.key)}
            className={`min-h-11 min-w-0 rounded-lg px-1 text-[12.5px] font-semibold ${active === col.key ? "bg-[var(--color-background-primary)] text-[var(--color-brand-700)] shadow-sm" : "text-[var(--color-text-secondary)]"} ${FOCUS}`}
          >
            <span className={WORDS}>{col.label}</span> <span className="tabular-nums">{col.count}</span>
          </button>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
        {columns.map((col) => {
          const empty = col.list.length + col.extra.length === 0;
          return (
            <section
              key={col.key}
              id={`work-col-panel-${col.key}`}
              data-column={col.key}
              aria-labelledby={`work-col-${col.key}`}
              className={`min-w-0 flex-col gap-2 ${active === col.key ? "flex" : "hidden md:flex"}`}
            >
              <h2 id={`work-col-${col.key}`} className="flex items-center justify-between gap-1 px-1 pt-1 text-[12.5px] font-semibold text-[var(--color-text-primary)]">
                <span className={`min-w-0 ${WORDS}`}>{col.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="rounded-full bg-[var(--color-background-primary)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-text-secondary)]" aria-label={`${col.count} ${col.count === 1 ? "card" : "cards"}`}>{col.count}</span>
                  {col.extra.length > 0 && <span className="rounded-full bg-[var(--color-info-50)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-info-700)]">+{col.extra.length} {col.extra.length === 1 ? "draft" : "drafts"}</span>}
                </span>
              </h2>
              <p data-sort-note="" className="px-1 text-[11px] text-[var(--color-text-tertiary)]">{col.note}</p>
              {empty
                ? <p className="px-1.5 pb-1 text-[12.5px] text-[var(--color-text-tertiary)]">Nothing here.</p>
                : <ul className="flex min-w-0 flex-col gap-1.5">
                    {col.extra.map((draft) => <li key={`draft-${draft.id}`} className="min-w-0"><DraftItem draft={draft} selected={draft.id === selectedDraftId} onOpen={onOpenDraft} /></li>)}
                    {col.list.map((card) => <li key={card.id} className="min-w-0"><WorkColumnCard card={card} selected={card.id === selectedId} onSelect={onSelect} draftsReady={draftsByCard?.get?.(card.id) || 0} /></li>)}
                  </ul>}
              {col.key === "todo" && allDraftsHref && (
                <a href={allDraftsHref} className={`mt-auto rounded-lg px-1.5 py-1 text-[12px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>All my message drafts, sent and discarded</a>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
