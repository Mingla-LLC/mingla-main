// Issue #3980 — the Work board's left column: cards grouped by status, by
// person or by event.
import { WorkItem } from "./WorkItem";
import { groupCards } from "../../lib/opsModel";

export function WorkList({ cards, group, selectedId, onSelect }) {
  const groups = groupCards(cards, group);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`work-group-${g.key}`} className="min-w-0">
          <h2 id={`work-group-${g.key}`} className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
            <span className="break-words">{g.title}</span>
            <span className="rounded-full bg-[var(--gray-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">{g.cards.length}</span>
          </h2>
          {g.cards.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--gray-300)] p-3 text-[13px] text-[var(--color-text-tertiary)]">Nothing here.</p>
          ) : (
            <ul className="grid min-w-0 grid-cols-1 gap-2">
              {g.cards.map((card) => (
                <li key={`${g.key}-${card.id}`} className="min-w-0">
                  <WorkItem card={card} selected={card.id === selectedId} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
