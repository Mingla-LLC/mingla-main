// Issue #3980 — one entry in the agent log feed.
import { OpsChip } from "./OpsChip";
import { agentName, dayLabel, logActionWords, logChip, timeLabel } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function LogRow({ entry }) {
  const chip = logChip(entry);
  return (
    <li className="flex min-w-0 flex-col gap-1 border-b border-[var(--gray-200)] px-4 py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className="tabular-nums text-[var(--color-text-tertiary)]" title={dayLabel(entry.at)}>{timeLabel(entry.at)}</span>
        <span className="min-w-0 break-words font-semibold text-[var(--color-text-primary)]">{agentName(entry.actor_name, entry.via)}</span>
        <span className="min-w-0 break-words text-[var(--color-text-secondary)]">{logActionWords(entry.action)}</span>
        <OpsChip tone={chip.tone}>{chip.label}</OpsChip>
      </div>
      <p className="break-words text-[13px] text-[var(--color-text-secondary)]">{entry.summary}</p>
      {entry.card && (
        <a href={`#/work-board?card=${entry.card.id}`} className={`self-start break-words rounded text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:underline ${FOCUS}`}>Card {entry.card.number}: {entry.card.title}</a>
      )}
    </li>
  );
}
