// Issue #4255 (W2, rev2) — the sprint bar, one line under the header
// (replaces SprintStrip): week arrows and dates, Day n of 7, each sprint goal
// as a checkable pill (state dot, title, cards done of its cards) that
// filters the board to its cards, then cards done of planned, hours planned
// against the team's hours (red over 100%), the late count and Plan sprint.
// The goals scroll inside the bar; the numbers and Plan sprint never move off
// screen. On a phone the whole bar scrolls sideways instead of wrapping.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { sprintLabel } from "../../lib/opsModel";
import { goalStateLabel, sprintDay, sprintProgress, teamCapacity } from "../../lib/workBoardModel";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

const STATE_DOT = {
  on_track: "bg-[var(--color-success-600)]",
  at_risk: "bg-[var(--color-warning-500,var(--color-warning-600))]",
  done: "bg-[var(--color-info-500)]",
  missed: "bg-[var(--color-error-500)]",
};

export function SprintBar({ sprint, plan = null, today, late = 0, goalId = null, onGoal, onWeek, onThisWeek, isThisWeek, onPlan, online = true }) {
  const goals = Array.isArray(plan?.goals) ? plan.goals : Array.isArray(sprint?.goals) ? sprint.goals : [];
  const day = sprintDay(sprint?.starts_on, today);
  const prog = sprintProgress(plan?.in_sprint);
  const cap = teamCapacity(plan?.capacity);
  return (
    <div data-sprint-bar="" className="flex h-11 min-w-0 flex-nowrap items-center gap-2 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-1.5 max-sm:overflow-x-auto">
      <div className="flex shrink-0 items-center">
        <button type="button" aria-label="Previous week" onClick={() => onWeek(-7)} className={`inline-grid h-9 w-8 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
        <h2 className="whitespace-nowrap text-[13px] font-semibold text-[var(--color-text-primary)]">{sprintLabel(sprint?.starts_on || "")}</h2>
        <button type="button" aria-label="Next week" onClick={() => onWeek(7)} className={`inline-grid h-9 w-8 place-items-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] ${FOCUS}`}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        {!isThisWeek && <button type="button" onClick={onThisWeek} className={`h-9 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-100)] ${FOCUS}`}>This week</button>}
        {day >= 1 && day <= 7 && <span className="hidden whitespace-nowrap pl-1 text-[12px] text-[var(--color-text-tertiary)] sm:inline">Day {day} of 7</span>}
      </div>
      <div data-sprint-goals="" role="group" aria-label="Sprint goals" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 max-sm:min-w-max max-sm:overflow-visible">
        {goals.length === 0 ? (
          <span className="whitespace-nowrap px-1 text-[12.5px] text-[var(--color-text-tertiary)]">No sprint goals yet</span>
        ) : goals.map((g) => {
          const on = goalId === g.id;
          return (
            <button key={g.id} type="button" data-goal-pill={g.id} aria-pressed={on ? "true" : "false"}
              title={`${g.title} · ${goalStateLabel(g.state)}${g.owner_name ? ` · ${g.owner_name}` : ""}`}
              onClick={() => onGoal(on ? null : g.id)}
              className={`inline-flex h-8 max-w-[15rem] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] ${on ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"} ${FOCUS}`}>
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[g.state] || STATE_DOT.on_track}`} />
              <span className="truncate font-semibold text-[var(--color-text-primary)]">{g.title}</span>
              <span className="shrink-0 tabular-nums">{Number(g.done) || 0}/{Number(g.cards) || 0}</span>
              <span className="sr-only">{goalStateLabel(g.state)}</span>
            </button>
          );
        })}
      </div>
      <div data-sprint-numbers="" className="flex shrink-0 items-center gap-2 pl-1">
        <span className="hidden items-center gap-1.5 whitespace-nowrap text-[12px] text-[var(--color-text-secondary)] md:inline-flex">
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--gray-100)]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct} aria-label={`${prog.done} of ${prog.planned} cards done`}>
            <span className="block h-full rounded-full bg-[var(--color-success-600)]" style={{ width: `${prog.pct}%` }} />
          </span>
          <span className="tabular-nums">{prog.done} of {prog.planned} done</span>
        </span>
        <span data-sprint-capacity="" className={`hidden whitespace-nowrap text-[12px] tabular-nums lg:inline ${cap.over ? "font-semibold text-[var(--color-error-700)]" : "text-[var(--color-text-secondary)]"}`}>
          {cap.set ? `${cap.plannedHours} of ${cap.capHours} h planned` : `${cap.plannedHours} h planned · set hours`}
        </span>
        {late > 0 && <span className="whitespace-nowrap rounded-full bg-[var(--color-error-50)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-error-700)]">{late} late</span>}
        <button type="button" data-plan-sprint="" disabled={!online} onClick={onPlan} className={`h-8 whitespace-nowrap rounded-lg border border-[var(--gray-200)] px-2.5 text-[12.5px] font-semibold text-[var(--color-text-primary)] hover:bg-[var(--gray-100)] disabled:opacity-50 ${FOCUS}`}>Plan sprint</button>
      </div>
    </div>
  );
}
