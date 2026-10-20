// Issue #3980 — this week's sprint: dates, goal, progress and the counts that
// matter, with the week arrows.
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OpsChip } from "./OpsChip";
import { sprintLabel } from "../../lib/opsModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

export function SprintStrip({ sprint, counts, overdue, canEditGoal, online, onGoal, onWeek, onThisWeek, isThisWeek }) {
  // The typed goal belongs to one week and one saved goal; a new week or a
  // newly saved goal shows the saved text again.
  const goalKey = `${sprint?.starts_on || ""}|${sprint?.goal || ""}`;
  const [draft, setDraft] = useState({ key: goalKey, value: sprint?.goal || "" });
  const goal = draft.key === goalKey ? draft.value : sprint?.goal || "";
  const setGoal = (value) => setDraft({ key: goalKey, value });
  const open = Number(counts?.todo || 0) + Number(counts?.doing || 0) + Number(counts?.person || 0);
  const done = Number(counts?.done || 0);
  const pct = open + done > 0 ? Math.round((done / (open + done)) * 100) : 0;
  // Compact, as in the design: one strip with the week, its goal, progress
  // and the counts; it wraps onto a second line only on narrow screens.
  return (
    <div data-sprint-strip="" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2.5 py-1.5">
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label="Previous week" onClick={() => onWeek(-7)} className={`inline-grid min-h-11 min-w-11 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
        <h2 className="whitespace-nowrap text-[13px] font-semibold text-[var(--color-text-primary)]">{sprintLabel(sprint?.starts_on || "")}</h2>
        <button type="button" aria-label="Next week" onClick={() => onWeek(7)} className={`inline-grid min-h-11 min-w-11 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        {!isThisWeek && <button type="button" onClick={onThisWeek} className={`min-h-11 rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-100)] ${FOCUS}`}>This week</button>}
      </div>
      {canEditGoal ? (
        <label className="flex min-w-[12rem] flex-1 items-center gap-2">
          <span className="sr-only">Sprint goal</span>
          <input
            value={goal}
            maxLength={200}
            disabled={!online}
            placeholder="Sprint goal: none set"
            aria-label="Sprint goal"
            onChange={(e) => setGoal(e.target.value)}
            onBlur={() => { if ((goal || "").trim() !== (sprint?.goal || "")) onGoal(goal.trim()); }}
            className={`min-h-11 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[13px] text-[var(--color-text-primary)] hover:border-[var(--gray-300)] focus:border-[var(--gray-300)] ${FOCUS}`}
          />
        </label>
      ) : (
        <p className="min-w-[10rem] flex-1 break-words text-[13px] text-[var(--color-text-secondary)]">{sprint?.goal || "No goal set"}</p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--gray-100)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${done} of ${open + done} cards done`}>
          <div className="h-full rounded-full bg-[var(--color-success-600)]" style={{ width: `${pct}%` }} />
        </div>
        <span className="whitespace-nowrap text-[12px] text-[var(--color-text-tertiary)]">{done} of {open + done} done</span>
        <OpsChip>{open} open</OpsChip>
        <OpsChip tone="warning">{Number(counts?.person || 0)} need a person</OpsChip>
        <OpsChip tone={overdue > 0 ? "error" : "default"}>{overdue} overdue</OpsChip>
      </div>
    </div>
  );
}
