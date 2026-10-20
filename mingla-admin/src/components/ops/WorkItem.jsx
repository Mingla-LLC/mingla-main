// Issue #3980 — one card in the Work board list.
import { forwardRef } from "react";
import { Avatars, OpsChip } from "./OpsChip";
import { PERSON_REASONS, agentName, closeKindLabel, dayLabel } from "../../lib/opsModel";

export const WorkItem = forwardRef(function WorkItem({ card, selected, onSelect }, ref) {
  const due = card.overdue ? `Overdue · ${dayLabel(card.due_on)}` : `Due ${dayLabel(card.due_on)}`;
  return (
    <button
      ref={ref}
      type="button"
      data-card-id={card.id}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(card)}
      className={[
        "flex w-full min-w-0 flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2",
        selected
          ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
          : "border-[var(--gray-200)] bg-[var(--color-background-primary)] hover:border-[var(--gray-300)] hover:bg-[var(--gray-50)]",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="min-w-0 break-words text-[13.5px] font-semibold leading-5 text-[var(--color-text-primary)]">{card.title}</span>
        <Avatars people={card.owners} />
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={`text-[12px] ${card.overdue ? "font-semibold text-[var(--color-error-700)]" : "text-[var(--color-text-tertiary)]"}`}>{card.status === "done" ? closeKindLabel(card.close_kind) : due}</span>
        {card.kind === "gate_live" && <OpsChip tone="info">Gate</OpsChip>}
        {card.blocked && <OpsChip tone="error">Blocked</OpsChip>}
        {card.status === "person" && <OpsChip tone="warning">{PERSON_REASONS[card.person_reason] || "Needs a person"}</OpsChip>}
        {card.anchor && <OpsChip dashed={card.anchor.kind === "expected"}>{card.anchor.title}</OpsChip>}
        {card.status === "done" && card.close_kind && card.close_kind !== "done" && <OpsChip>{closeKindLabel(card.close_kind)}</OpsChip>}
        {card.claim && <OpsChip tone="brand"><span aria-hidden="true">●</span> {agentName(card.claim.holder_name, card.claim.holder_via, card.claim.holder_chat_label)} is on it</OpsChip>}
      </span>
    </button>
  );
});
