// Issue #3980 — what happened to a card, newest first.
import { useState } from "react";
import { agentName, dayLabel, eventWords, timeLabel } from "../../lib/opsModel";

export function CardHistory({ events = [] }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(0, 10);
  if (events.length === 0) return <p className="text-[13px] text-[var(--color-text-tertiary)]">Nothing yet.</p>;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ol className="flex min-w-0 flex-col gap-1.5">
        {shown.map((e) => (
          <li key={e.id} className="min-w-0 text-[13px]">
            <span className="text-[var(--color-text-tertiary)]">{dayLabel(e.at)} {timeLabel(e.at)} · </span>
            <span className="font-medium text-[var(--color-text-primary)]">{agentName(e.actor_name, e.via)}</span>{" "}
            <span className="text-[var(--color-text-secondary)]">{eventWords(e.action)}{e.undone ? " (undone)" : ""}</span>
            {e.body && <span className="mt-0.5 block whitespace-pre-wrap break-words text-[var(--color-text-secondary)]">{e.body}</span>}
          </li>
        ))}
      </ol>
      {events.length > 10 && !all && (
        <button type="button" onClick={() => setAll(true)} className="min-h-11 self-start rounded-lg px-2 text-[13px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]">Show all</button>
      )}
    </div>
  );
}
