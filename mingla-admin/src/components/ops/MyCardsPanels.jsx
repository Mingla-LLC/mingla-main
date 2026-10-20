// Issue #3980 — My day: the open work cards I own (soonest first) and the
// ones I watch, each opening on the Work board.
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { useMyCards } from "../../hooks/useOpsWork";
import { WORK_STATUSES, dayLabel, dueOrder, opsErrorWords } from "../../lib/opsModel";
import { OpsChip } from "./OpsChip";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const LINK = `inline-flex min-h-11 items-center rounded-lg px-3 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`;

function statusChip(card) {
  if (card.blocked) return { label: "Blocked", tone: "error" };
  if (card.status === "person") return { label: "Needs a person", tone: "warning" };
  return { label: WORK_STATUSES.find((s) => s.value === card.status)?.label || card.status, tone: card.status === "doing" ? "brand" : "default" };
}

function CardRows({ cards, empty }) {
  if (cards.length === 0) return <p className="text-[13px] text-[var(--color-text-secondary)]">{empty}</p>;
  return (
    <ul className="flex min-w-0 flex-col gap-1">
      {cards.map((c) => {
        const chip = statusChip(c);
        return (
          <li key={c.id}>
            <a href={`#/work-board?card=${c.id}`} className={`flex min-h-11 min-w-0 items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--gray-50)] ${FOCUS}`}>
              <span className="min-w-0">
                <span className="block break-words text-[13px] font-medium text-[var(--color-text-primary)]">{c.title}</span>
                <span className={`block text-[12px] ${c.overdue ? "text-[var(--color-error-700)]" : "text-[var(--color-text-tertiary)]"}`}>{c.overdue ? "Overdue · " : "Due "}{dayLabel(c.due_on)}</span>
              </span>
              <OpsChip tone={chip.tone}>{chip.label}</OpsChip>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function MyCardsPanels() {
  const cards = useMyCards();
  if (cards.loading) {
    return (
      <div role="status" className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <span className="sr-only">Loading your cards…</span>
        <div className="h-24 animate-pulse rounded-xl bg-[var(--gray-100)]" />
        <div className="h-24 animate-pulse rounded-xl bg-[var(--gray-100)]" />
      </div>
    );
  }
  if (cards.error && !cards.data) {
    return (
      <SectionCard title="My cards" action={<Button variant="secondary" className="min-h-11" onClick={() => cards.refetch()}>Try again</Button>}>
        <p role="alert" className="text-[13px] text-[var(--color-error-700)]">{opsErrorWords(cards.error)}</p>
      </SectionCard>
    );
  }
  const mine = dueOrder(cards.data?.mine, 8);
  const watching = dueOrder(cards.data?.watching, 5);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <SectionCard title="My cards" action={<a href="#/work-board?who=mine" className={LINK}>Open Work board</a>}>
        <CardRows cards={mine} empty="No open cards are yours. Add one on the Work board, or ask your agent for your cards." />
      </SectionCard>
      <SectionCard title="Watching">
        <CardRows cards={watching} empty="You are not watching any open cards." />
      </SectionCard>
    </div>
  );
}
