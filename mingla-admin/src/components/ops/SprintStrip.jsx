// Issue #3980 — this week's sprint: dates, goal, progress and the counts that
// matter, with the week arrows.
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OpsChip } from "./OpsChip";
import { sprintLabel } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function SprintStrip({ sprint, counts, overdue, canEditGoal, online, onGoal, onWeek, onThisWeek, isThisWeek }) {
  const [goal, setGoal] = useState(sprint?.goal || "");
  useEffect(() => setGoal(sprint?.goal || ""), [sprint?.goal, sprint?.starts_on]);
  const open = Number(counts?.todo || 0) + Number(counts?.doing || 0) + Number(counts?.person || 0);
  const done = Number(counts?.done || 0);
  const pct = open + done > 0 ? Math.round((done / (open + done)) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-sm)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-[var(--color-text-primary)]">{sprintLabel(sprint?.starts_on || "")}</h2>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous week" onClick={() => onWeek(-7)} className={`inline-grid min-h-11 min-w-11 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
          <button type="button" onClick={onThisWeek} disabled={isThisWeek} className={`min-h-11 rounded-lg px-3 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] disabled:opacity-50 ${FOCUS}`}>This week</button>
          <button type="button" aria-label="Next week" onClick={() => onWeek(7)} className={`inline-grid min-h-11 min-w-11 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      </div>
      {canEditGoal ? (
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">Sprint goal</span>
          <input
            value={goal}
            maxLength={200}
            disabled={!online}
            placeholder="No goal set"
            onChange={(e) => setGoal(e.target.value)}
            onBlur={() => { if ((goal || "").trim() !== (sprint?.goal || "")) onGoal(goal.trim()); }}
            className={`min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-[13px] text-[var(--color-text-primary)] ${FOCUS}`}
          />
        </label>
      ) : (
        <p className="break-words text-[13px] text-[var(--color-text-secondary)]">{sprint?.goal || "No goal set"}</p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-[var(--gray-100)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${done} of ${open + done} cards done`}>
          <div className="h-full rounded-full bg-[var(--color-success-600)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[12px] text-[var(--color-text-tertiary)]">{done} of {open + done} done</span>
        <OpsChip>{open} open</OpsChip>
        <OpsChip tone="warning">{Number(counts?.person || 0)} need a person</OpsChip>
        <OpsChip tone={overdue > 0 ? "error" : "default"}>{overdue} overdue</OpsChip>
      </div>
    </div>
  );
}
